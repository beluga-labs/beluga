/**
 * One person's line in a call (BLG-706): a WebRTC connection between your window and theirs, set
 * up with "perfect negotiation" (either side may change what it sends at any time; when both offer
 * at once, the polite side gives way). Setup travels through the daemons (`calls.signal`), the
 * media straight between the two Macs, encrypted (DTLS-SRTP).
 *
 * It carries your voice, the screen share when the tree says this person gets it from you
 * (`setVideo`), and a data channel for the stage (ink, the laser), negotiated up front so it costs
 * no extra round trip.
 */

/** Public STUN only finds each Mac's address; the call itself never goes through it. */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

/** Voice: Opus with in-band error correction, at a rate that sounds like being in the room. */
const VOICE_BITRATE = 64_000;
/** A screen of text: up to this, keeping its resolution before its frame rate (degradationPreference). */
const SCREEN_BITRATE = 3_000_000;
const SCREEN_FPS = 30;

type Signal = { readonly desc: RTCSessionDescriptionInit } | { readonly cand: RTCIceCandidateInit | null };

export type LineState = 'connecting' | 'connected' | 'failed';

export interface PeerHost {
  readonly polite: boolean;
  readonly send: (data: string) => void;
  readonly onAudio: (stream: MediaStream) => void;
  readonly onVideo: (track: MediaStreamTrack | undefined) => void;
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
  private video: RTCRtpSender | undefined;
  /** What `setVideo` last asked for (unchanged: nothing to do). */
  private videoWanted: MediaStreamTrack | undefined;
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
    // Voice both ways from the start, even before your microphone opens (it's put in when it does).
    const stream = new MediaStream(mic ? [mic] : []);
    this.voice = this.pc.addTransceiver(mic ?? 'audio', { direction: 'sendrecv', streams: [stream] }).sender;
    void this.voice.setParameters({ ...this.voice.getParameters(), encodings: [{ maxBitrate: VOICE_BITRATE, priority: 'high', networkPriority: 'high' }] }).catch(() => undefined);
    this.pc.onnegotiationneeded = () => void this.offer();
    this.pc.onicecandidate = (e) => this.send({ cand: e.candidate ? e.candidate.toJSON() : null });
    this.pc.ontrack = (e) => {
      if (e.track.kind === 'audio') host.onAudio(e.streams[0] ?? new MediaStream([e.track]));
      if (e.track.kind === 'video') {
        host.onVideo(e.track);
        e.track.onunmute = () => host.onVideo(e.track);
        e.track.onended = () => host.onVideo(undefined);
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
  setVideo(track: MediaStreamTrack | undefined): Promise<void> {
    if (this.closed || track === this.videoWanted) return Promise.resolve();
    this.videoWanted = track;
    this.queue = this.queue.then(() => this.applyVideo(track)).catch(() => undefined);
    return this.queue;
  }

  private async applyVideo(track: MediaStreamTrack | undefined): Promise<void> {
    if (this.closed || track !== this.videoWanted) return;
    if (!this.video) {
      if (!track) return;
      this.video = this.pc.addTrack(track, new MediaStream([track]));
      const t = this.pc.getTransceivers().find((x) => x.sender === this.video);
      if (t) preferH264(t);
    } else if (this.video.track !== track) await this.video.replaceTrack(track ?? null);
    if (track) {
      const p = this.video.getParameters();
      const encodings = (p.encodings?.length ? p.encodings : [{}]).map((e) => ({ ...e, maxBitrate: SCREEN_BITRATE, maxFramerate: SCREEN_FPS }));
      await this.video.setParameters({ ...p, encodings, degradationPreference: 'maintain-resolution' } as RTCRtpSendParameters).catch(() => undefined);
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
