import type { ShareMode } from '@beluga/shared/calls.js';

/**
 * One person's line in a call (BLG-706): a WebRTC connection between your window and theirs, set
 * up with "perfect negotiation" (either side may change what it sends at any time; when both offer
 * at once, the polite side gives way). Setup travels through the daemons (`calls.signal`), the
 * media straight between the two Macs, encrypted (DTLS-SRTP).
 *
 * It carries your voice, your camera, the screen share when the tree says this person gets it
 * from you (`setVideo`), and a data channel for the stage (pointers, marks, ink), negotiated up
 * front so it costs no extra round trip. WebRTC only says which stream a picture belongs to, so
 * each line says once which of its streams is the camera and which the screen (`streams`).
 */

/** Public STUN only finds each Mac's address; the call itself never goes through it. */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

/** Voice: Opus with in-band error correction, at a rate that sounds like being in the room. */
const VOICE_BITRATE = 64_000;
/** How a screen is sent, by the sharer's choice: text keeps its pixels, motion keeps its frames. */
const SCREEN: Record<ShareMode, { readonly maxBitrate: number; readonly maxFramerate: number; readonly degradation: RTCDegradationPreference }> = {
  sharp: { maxBitrate: 3_500_000, maxFramerate: 24, degradation: 'maintain-resolution' },
  smooth: { maxBitrate: 4_500_000, maxFramerate: 60, degradation: 'maintain-framerate' },
};

/** A camera, smaller as the call grows (everyone sends theirs to everyone). */
export function cameraEncoding(people: number): { readonly maxBitrate: number; readonly scaleResolutionDownBy: number } {
  if (people <= 2) return { maxBitrate: 1_500_000, scaleResolutionDownBy: 1 };
  if (people <= 4) return { maxBitrate: 700_000, scaleResolutionDownBy: 1.5 };
  return { maxBitrate: 320_000, scaleResolutionDownBy: 2.5 };
}

type Slot = 'screen' | 'cam';

type Signal = { readonly desc: RTCSessionDescriptionInit } | { readonly cand: RTCIceCandidateInit | null };

export type LineState = 'connecting' | 'connected' | 'failed';

export interface PeerHost {
  /** Your peer id (it signs what this line says on the stage). */
  readonly me: string;
  readonly polite: boolean;
  readonly send: (data: string) => void;
  readonly onAudio: (stream: MediaStream) => void;
  /** A picture from them (or one ended): the stream id says whether it's their camera or a screen. */
  readonly onVideo: (track: MediaStreamTrack, streamId: string, live: boolean) => void;
  readonly onStage: (text: string) => void;
  readonly onState: (state: LineState) => void;
}

/** H.264 first: the Mac encodes and decodes it in hardware, so a share costs almost no CPU. */
function preferH264(t: RTCRtpTransceiver): void {
  const caps = typeof RTCRtpReceiver !== 'undefined' ? RTCRtpReceiver.getCapabilities?.('video') : null;
  if (!caps || !t.setCodecPreferences) return;
  const rank = (c: RTCRtpCodec): number => (c.mimeType === 'video/H264' ? 0 : c.mimeType === 'video/H265' ? 1 : c.mimeType === 'video/VP9' ? 2 : 3);
  try {
    t.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b)));
  } catch {
    // Some engines refuse a reordered list: their default is fine.
  }
}

export class Peer {
  readonly pc: RTCPeerConnection;
  private readonly stage: RTCDataChannel;
  private making = false;
  private ignoring = false;
  /** The screen and the camera this line sends: a sender once there's been something to send, and what's wanted now. */
  private readonly slots: Record<Slot, { sender?: RTCRtpSender; wanted?: MediaStreamTrack; params: string; readonly stream: MediaStream }> = {
    screen: { params: '', stream: new MediaStream() },
    cam: { params: '', stream: new MediaStream() },
  };
  private readonly voice: RTCRtpSender;
  private closed = false;
  /** Setup is handled one message at a time, in the order it came. */
  private queue: Promise<void> = Promise.resolve();
  /** Candidates that came before their offer or answer: added once it's set. */
  private early: RTCIceCandidateInit[] = [];

  constructor(private readonly host: PeerHost, mic: MediaStreamTrack | undefined) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
    // Reliable and in order: a stroke's end, Clear and an ask must arrive (they're tiny).
    this.stage = this.pc.createDataChannel('stage', { negotiated: true, id: 0 });
    this.stage.onmessage = (e) => typeof e.data === 'string' && e.data.length <= 64_000 && host.onStage(e.data);
    this.stage.onopen = () => this.stage.send(JSON.stringify({ k: 'streams', by: host.me, cam: this.slots.cam.stream.id, screen: this.slots.screen.stream.id }));
    // Voice both ways from the start, even before your microphone opens (it's put in when it does).
    const stream = new MediaStream(mic ? [mic] : []);
    this.voice = this.pc.addTransceiver(mic ?? 'audio', { direction: 'sendrecv', streams: [stream] }).sender;
    void this.voice.setParameters({ ...this.voice.getParameters(), encodings: [{ maxBitrate: VOICE_BITRATE, priority: 'high', networkPriority: 'high' }] }).catch(() => undefined);
    this.pc.onnegotiationneeded = () => void this.offer();
    this.pc.onicecandidate = (e) => this.send({ cand: e.candidate ? e.candidate.toJSON() : null });
    this.pc.ontrack = (e) => {
      if (e.track.kind === 'audio') host.onAudio(e.streams[0] ?? new MediaStream([e.track]));
      if (e.track.kind === 'video') {
        const id = e.streams[0]?.id ?? '';
        const track = e.track;
        host.onVideo(track, id, !track.muted);
        track.onunmute = () => host.onVideo(track, id, true);
        track.onmute = () => host.onVideo(track, id, false);
        track.onended = () => host.onVideo(track, id, false);
      }
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      host.onState(s === 'connected' ? 'connected' : s === 'failed' ? 'failed' : 'connecting');
      // A network change (Wi-Fi to Ethernet, a VPN): try new paths without ending the call.
      if (s === 'failed') this.pc.restartIce();
    };
  }

  private send(s: Signal): void {
    if (!this.closed) this.host.send(JSON.stringify(s));
  }

  private async offer(): Promise<void> {
    try {
      this.making = true;
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) this.send({ desc: this.pc.localDescription.toJSON() });
    } catch {
      // The next negotiationneeded tries again.
    } finally {
      this.making = false;
    }
  }

  /** Your microphone, once it's open (it goes on the line without asking again). */
  async setMic(track: MediaStreamTrack | undefined): Promise<void> {
    if (!this.closed && this.voice.track !== (track ?? null)) await this.voice.replaceTrack(track ?? null).catch(() => undefined);
  }

  /** Setup from their window (an offer, an answer or a candidate), handled in order. */
  receive(data: string): Promise<void> {
    this.queue = this.queue.then(() => this.handle(data));
    return this.queue;
  }

  private async handle(data: string): Promise<void> {
    let s: Signal;
    try {
      s = JSON.parse(data) as Signal;
    } catch {
      return;
    }
    try {
      if ('desc' in s) {
        const collision = s.desc.type === 'offer' && (this.making || this.pc.signalingState !== 'stable');
        this.ignoring = !this.host.polite && collision;
        if (this.ignoring) return;
        await this.pc.setRemoteDescription(s.desc);
        for (const c of this.early.splice(0)) await this.pc.addIceCandidate(c).catch(() => undefined);
        if (s.desc.type === 'offer') {
          await this.pc.setLocalDescription();
          if (this.pc.localDescription) this.send({ desc: this.pc.localDescription.toJSON() });
        }
      } else if ('cand' in s) {
        if (!this.pc.remoteDescription) {
          if (s.cand && this.early.length < 64) this.early.push(s.cand);
          return;
        }
        try {
          await this.pc.addIceCandidate(s.cand ?? undefined);
        } catch (err) {
          if (!this.ignoring) throw err;
        }
      }
    } catch {
      // A bad or stale message: negotiation goes on with the next one.
    }
  }

  /** The screen this person should get from you now (yours, or one you pass on), or none. */
  setVideo(track: MediaStreamTrack | undefined, mode: ShareMode = 'sharp'): Promise<void> {
    const m = SCREEN[mode];
    return this.setSlot('screen', track, { maxBitrate: m.maxBitrate, maxFramerate: m.maxFramerate }, m.degradation);
  }

  /** Your camera for this person (or none), sized for a call of `people`. */
  setCamera(track: MediaStreamTrack | undefined, people: number): Promise<void> {
    return this.setSlot('cam', track, { ...cameraEncoding(people), maxFramerate: 30 }, 'balanced');
  }

  private setSlot(slot: Slot, track: MediaStreamTrack | undefined, encoding: RTCRtpEncodingParameters, degradation: RTCDegradationPreference): Promise<void> {
    const s = this.slots[slot];
    const params = JSON.stringify([encoding, degradation]);
    if (this.closed || (track === s.wanted && params === s.params)) return Promise.resolve();
    s.wanted = track;
    s.params = params;
    this.queue = this.queue.then(() => this.applySlot(slot, track, encoding, degradation)).catch(() => undefined);
    return this.queue;
  }

  private async applySlot(slot: Slot, track: MediaStreamTrack | undefined, encoding: RTCRtpEncodingParameters, degradation: RTCDegradationPreference): Promise<void> {
    const s = this.slots[slot];
    if (this.closed || track !== s.wanted) return;
    if (!s.sender) {
      if (!track) return;
      s.sender = this.pc.addTrack(track, s.stream);
      const t = this.pc.getTransceivers().find((x) => x.sender === s.sender);
      if (t) preferH264(t);
    } else if (s.sender.track !== track) await s.sender.replaceTrack(track ?? null);
    if (track) {
      const p = s.sender.getParameters();
      const encodings = (p.encodings?.length ? p.encodings : [{}]).map((e) => ({ ...e, ...encoding }));
      await s.sender.setParameters({ ...p, encodings, degradationPreference: degradation } as RTCRtpSendParameters).catch(() => undefined);
    }
  }

  /** Something for the stage (ink, the laser): dropped while the channel isn't open yet. */
  sendStage(text: string): void {
    if (this.stage.readyState === 'open') this.stage.send(text);
  }

  /** How long a round trip to them takes, if known (ms). */
  async rtt(): Promise<number | undefined> {
    const stats = await this.pc.getStats().catch(() => undefined);
    let rtt: number | undefined;
    stats?.forEach((r: { type?: string; state?: string; nominated?: boolean; currentRoundTripTime?: number }) => {
      if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated && r.currentRoundTripTime !== undefined) rtt = Math.round(r.currentRoundTripTime * 1000);
    });
    return rtt;
  }

  close(): void {
    this.closed = true;
    this.pc.close();
  }
}
