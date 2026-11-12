/**
 * MCP Apps in a chat (Settings › Experimental › MCP Apps; src/mcp-apps): a tool call whose tool
 * declares a `ui://` resource keeps what its app needs on its step, and `apps.get` gives the Mac
 * the frame to draw it in. Browser-safe: types only.
 */

/** What a step of a UI tool keeps for its app (beside the step's own input and output). */
export interface StepApp {
  /** The MCP server's name, as Claude Code knows it. */
  readonly server: string;
  /** The tool's own name on that server. */
  readonly tool: string;
  /** The `ui://` resource that draws it. */
  readonly resourceUri: string;
  /** The result's `structuredContent`, when it had some that fit (see mcp-apps/domain/result.ts). */
  readonly structuredContent?: unknown;
}

/** `apps.get`: an app to draw, or why there is none. */
export type McpAppView =
  | {
      readonly ok: true;
      /** The frame's address on this computer's app host (loopback, an id nobody can guess). */
      readonly url: string;
      readonly server: string;
      readonly tool: string;
      readonly resourceUri: string;
      /** The tool call's arguments (bounded, secrets redacted). */
      readonly input: Readonly<Record<string, unknown>>;
      /** The tool's result: its text (as the step keeps it) and its structured content. Absent while it runs. */
      readonly result?: { readonly text?: string; readonly structuredContent?: unknown; readonly isError?: boolean };
      readonly prefersBorder?: boolean;
    }
  | { readonly ok: false; readonly reason: 'off' | 'missing' | 'unavailable'; readonly message: string };
