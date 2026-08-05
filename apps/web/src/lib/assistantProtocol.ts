/**
 * Wire format shared by the in-editor assistant dock and `/api/assistant`.
 *
 * The route streams one Server-Sent-Events `data:` line per event; the dock
 * decodes them back into this union. Keeping the union here (rather than in the
 * route) means the dock, the stream parser, and the tests all agree on one shape.
 */

export const ASSISTANT_ROUTE = "/api/assistant";

export type AssistantMcpServerStatus = {
  name: string;
  status: string;
};

export type AssistantEvent =
  /** Emitted once per turn from the CLI's `system/init` line. */
  | {
      type: "session";
      sessionId: string;
      model: string;
      toolNames: string[];
      mcpServers: AssistantMcpServerStatus[];
    }
  /** Assistant prose, either a streamed delta or a whole block. */
  | { type: "text"; text: string }
  /** A tool the assistant invoked, summarised for the transcript. */
  | { type: "tool"; toolId: string; name: string; summary: string }
  /** The matching tool result. `summary` is trimmed for one transcript line. */
  | { type: "tool-result"; toolId: string; name: string; ok: boolean; summary: string }
  /** End of turn. `sessionId` is what the next message must `--resume`. */
  | {
      type: "result";
      sessionId: string | null;
      text: string;
      isError: boolean;
      durationMs: number | null;
    }
  /** Anything that stopped the turn before it produced a result. */
  | { type: "error"; message: string; hint?: string };

export type AssistantRequest = {
  message: string;
  /** Session id returned by the previous turn's `result` event. */
  sessionId?: string | null;
  /** Editor tab the assistant should act on, from the MCP bridge identity. */
  editorNumber?: number | null;
  /** Pre-built scene summary appended to the system prompt (Block 6 task 5). */
  sceneContext?: string | null;
};

export function encodeAssistantEvent(event: AssistantEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Incremental SSE reader. `fetch` hands back arbitrary chunk boundaries, so the
 * decoder buffers until it has seen a blank-line frame terminator.
 */
export function createAssistantEventDecoder() {
  let buffer = "";

  const parseFrame = (frame: string): AssistantEvent | null => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) return null;
    try {
      const parsed = JSON.parse(data) as AssistantEvent;
      return parsed && typeof parsed === "object" && typeof parsed.type === "string" ? parsed : null;
    } catch {
      return null;
    }
  };

  return {
    push(chunk: string): AssistantEvent[] {
      buffer += chunk;
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      return frames.map(parseFrame).filter((event): event is AssistantEvent => event !== null);
    },
    /** Flush a trailing frame that never got its blank line (stream cut short). */
    flush(): AssistantEvent[] {
      const trailing = buffer;
      buffer = "";
      const event = trailing.trim() ? parseFrame(trailing) : null;
      return event ? [event] : [];
    },
  };
}
