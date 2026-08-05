import type { AssistantEvent } from "@/lib/assistantProtocol";

/**
 * Transcript state for the in-editor assistant dock.
 *
 * Pure on purpose: the component owns the fetch and the ids, this owns what the
 * transcript looks like after each streamed event, so the whole streaming
 * lifecycle (deltas, tool calls, failures, cancellation) is unit testable in a
 * node environment with no DOM.
 */

export type AssistantToolStatus = "running" | "ok" | "failed";

export type AssistantToolEntry = {
  toolId: string;
  name: string;
  summary: string;
  status: AssistantToolStatus;
  result: string;
};

export type AssistantUserMessage = {
  role: "user";
  id: string;
  text: string;
};

export type AssistantReplyStatus = "streaming" | "done" | "error";

export type AssistantReplyMessage = {
  role: "assistant";
  id: string;
  text: string;
  tools: AssistantToolEntry[];
  status: AssistantReplyStatus;
  error: string | null;
  hint: string | null;
  durationMs: number | null;
};

export type AssistantMessage = AssistantUserMessage | AssistantReplyMessage;

export type AssistantDockState = {
  messages: AssistantMessage[];
  /** Session to `--resume` on the next turn; null until the first result. */
  sessionId: string | null;
  busy: boolean;
};

export type AssistantDockAction =
  | { type: "submit"; userId: string; replyId: string; text: string }
  | { type: "event"; event: AssistantEvent }
  | { type: "stopped" }
  | { type: "transport-error"; message: string; hint?: string }
  | { type: "clear" };

export const initialAssistantDockState: AssistantDockState = {
  messages: [],
  sessionId: null,
  busy: false,
};

function mapLastReply(
  state: AssistantDockState,
  update: (reply: AssistantReplyMessage) => AssistantReplyMessage,
): AssistantDockState {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.role !== "assistant") continue;
    const next = update(message);
    if (next === message) return state;
    const messages = state.messages.slice();
    messages[index] = next;
    return { ...state, messages };
  }
  return state;
}

function applyEvent(state: AssistantDockState, event: AssistantEvent): AssistantDockState {
  switch (event.type) {
    case "session":
      return event.sessionId ? { ...state, sessionId: event.sessionId } : state;

    case "text":
      return mapLastReply(state, (reply) => ({ ...reply, text: `${reply.text}${event.text}` }));

    case "tool":
      return mapLastReply(state, (reply) => ({
        ...reply,
        tools: [...reply.tools, { toolId: event.toolId, name: event.name, summary: event.summary, status: "running", result: "" }],
      }));

    case "tool-result":
      return mapLastReply(state, (reply) => {
        const index = reply.tools.findIndex((tool) => tool.toolId === event.toolId);
        const entry: AssistantToolEntry = {
          toolId: event.toolId,
          // A result without a matching call means the call arrived before the
          // dock connected (a resumed turn); keep it rather than dropping it.
          name: index === -1 ? event.name : reply.tools[index].name,
          summary: index === -1 ? event.summary : reply.tools[index].summary,
          status: event.ok ? "ok" : "failed",
          result: event.summary,
        };
        const tools = index === -1 ? [...reply.tools, entry] : reply.tools.slice();
        if (index !== -1) tools[index] = entry;
        return { ...reply, tools };
      });

    case "result": {
      const withSession = event.sessionId ? { ...state, sessionId: event.sessionId } : state;
      return {
        ...mapLastReply(withSession, (reply) => ({
          ...reply,
          // The result carries the whole reply; fall back to it when nothing streamed.
          text: reply.text || event.text,
          status: event.isError ? "error" : "done",
          error: event.isError ? reply.error ?? "The assistant turn ended with an error." : reply.error,
          durationMs: event.durationMs,
          // A tool the CLI never reported back on cannot still be running.
          tools: reply.tools.map((tool) => (tool.status === "running" ? { ...tool, status: "failed" } : tool)),
        })),
        busy: false,
      };
    }

    case "error":
      return {
        ...mapLastReply(state, (reply) => ({
          ...reply,
          status: "error",
          error: event.message,
          hint: event.hint ?? null,
          tools: reply.tools.map((tool) => (tool.status === "running" ? { ...tool, status: "failed" } : tool)),
        })),
        busy: false,
      };

    default:
      return state;
  }
}

export function assistantDockReducer(state: AssistantDockState, action: AssistantDockAction): AssistantDockState {
  switch (action.type) {
    case "submit":
      return {
        ...state,
        busy: true,
        messages: [
          ...state.messages,
          { role: "user", id: action.userId, text: action.text },
          { role: "assistant", id: action.replyId, text: "", tools: [], status: "streaming", error: null, hint: null, durationMs: null },
        ],
      };

    case "event":
      return applyEvent(state, action.event);

    case "stopped":
      return {
        ...mapLastReply(state, (reply) =>
          reply.status === "streaming"
            ? {
                ...reply,
                status: "done",
                text: reply.text ? `${reply.text}\n\n(stopped)` : "(stopped)",
                tools: reply.tools.map((tool) => (tool.status === "running" ? { ...tool, status: "failed" } : tool)),
              }
            : reply,
        ),
        busy: false,
      };

    case "transport-error":
      return applyEvent(state, { type: "error", message: action.message, hint: action.hint });

    case "clear":
      // Keeping sessionId would resume a conversation the user can no longer see.
      return initialAssistantDockState;

    default:
      return state;
  }
}

/** True when the reply is still expected to grow, used for the busy indicator. */
export function isAssistantReplyPending(message: AssistantMessage) {
  return message.role === "assistant" && message.status === "streaming";
}
