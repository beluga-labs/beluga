/**
 * A computer's dev server forwarded to this Mac (BLG-802): its port there, and where it listens
 * here (the same one when it was free). Browser-safe.
 */
export interface PortForward {
  readonly machineId: string;
  readonly machineName: string;
  readonly workspaceId: string;
  /** Its port on the computer. */
  readonly port: number;
  /** Where it opens on this Mac: localhost:<local>. */
  readonly local: number;
  /** What it is: vite, next, node… */
  readonly name: string;
}
