import { describe, expect, it } from "vitest";
import {
  assistantDockReducer,
  initialAssistantDockState,
  isAssistantReplyPending,
  type AssistantDockAction,
  type AssistantDockState,
  type AssistantReplyMessage,
} from "@/lib/assistantDockState";

function run(actions: AssistantDockAction[], from: AssistantDockState = initialAssistantDockState) {
  return actions.reduce(assistantDockReducer, from);
}

const submit: AssistantDockAction = { type: "submit", userId: "u1", replyId: "a1", text: "add a 20mm box" };

function reply(state: AssistantDockState) {
  const message = state.messages.find((entry): entry is AssistantReplyMessage => entry.role === "assistant");
  if (!message) throw new Error("expected an assistant message");
  return message;
}

describe("assistantDockReducer", () => {
  it("adds the user message and an empty streaming reply on submit", () => {
    const state = run([submit]);
    expect(state.busy).toBe(true);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual({ role: "user", id: "u1", text: "add a 20mm box" });
    expect(reply(state)).toMatchObject({ id: "a1", text: "", status: "streaming", tools: [] });
    expect(isAssistantReplyPending(state.messages[1])).toBe(true);
  });

  it("appends streamed text deltas in order", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "text", text: "Adding " } },
      { type: "event", event: { type: "text", text: "a box." } },
    ]);
    expect(reply(state).text).toBe("Adding a box.");
  });

  it("records the session id so the next turn resumes", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "session", sessionId: "s-1", model: "claude-opus-5", toolNames: [], mcpServers: [] } },
    ]);
    expect(state.sessionId).toBe("s-1");
  });

  it("keeps the previous session id when an event carries none", () => {
    const withSession = run([
      submit,
      { type: "event", event: { type: "session", sessionId: "s-1", model: "", toolNames: [], mcpServers: [] } },
      { type: "event", event: { type: "result", sessionId: null, text: "ok", isError: false, durationMs: 10 } },
    ]);
    expect(withSession.sessionId).toBe("s-1");
  });

  it("tracks a tool call from running to done", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "tool", toolId: "t1", name: "create_shape", summary: "create_shape (kind: box)" } },
    ]);
    expect(reply(state).tools).toEqual([
      { toolId: "t1", name: "create_shape", summary: "create_shape (kind: box)", status: "running", result: "" },
    ]);

    const settled = run([{ type: "event", event: { type: "tool-result", toolId: "t1", name: "create_shape", ok: true, summary: '{"id":"shape-7"}' } }], state);
    expect(reply(settled).tools).toEqual([
      { toolId: "t1", name: "create_shape", summary: "create_shape (kind: box)", status: "ok", result: '{"id":"shape-7"}' },
    ]);
  });

  it("marks a failed tool result without losing the call summary", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "tool", toolId: "t1", name: "boolean_cut", summary: "boolean_cut (solidIds: [1])" } },
      { type: "event", event: { type: "tool-result", toolId: "t1", name: "boolean_cut", ok: false, summary: "Object not found" } },
    ]);
    expect(reply(state).tools[0]).toMatchObject({ status: "failed", summary: "boolean_cut (solidIds: [1])", result: "Object not found" });
  });

  it("keeps an orphan tool result rather than dropping it", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "tool-result", toolId: "t9", name: "read_scene", ok: true, summary: "{}" } },
    ]);
    expect(reply(state).tools).toHaveLength(1);
    expect(reply(state).tools[0]).toMatchObject({ toolId: "t9", name: "read_scene", status: "ok" });
  });

  it("closes the turn on result and clears busy", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "text", text: "Added it." } },
      { type: "event", event: { type: "result", sessionId: "s-2", text: "Added it.", isError: false, durationMs: 4200 } },
    ]);
    expect(state.busy).toBe(false);
    expect(state.sessionId).toBe("s-2");
    expect(reply(state)).toMatchObject({ status: "done", text: "Added it.", durationMs: 4200 });
  });

  it("falls back to the result text when nothing streamed", () => {
    const state = run([submit, { type: "event", event: { type: "result", sessionId: "s-3", text: "pong", isError: false, durationMs: 1 } }]);
    expect(reply(state).text).toBe("pong");
  });

  it("does not duplicate text that already streamed", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "text", text: "pong" } },
      { type: "event", event: { type: "result", sessionId: "s-3", text: "pong", isError: false, durationMs: 1 } },
    ]);
    expect(reply(state).text).toBe("pong");
  });

  it("fails a tool that never reported back when the turn ends", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "tool", toolId: "t1", name: "group_objects", summary: "group_objects" } },
      { type: "event", event: { type: "result", sessionId: "s-4", text: "", isError: true, durationMs: 900 } },
    ]);
    expect(reply(state).tools[0].status).toBe("failed");
    expect(reply(state).status).toBe("error");
    expect(state.busy).toBe(false);
  });

  it("surfaces a setup error with its hint", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "error", message: "The Claude Code CLI was not found", hint: "npm install -g @anthropic-ai/claude-code" } },
    ]);
    expect(reply(state)).toMatchObject({
      status: "error",
      error: "The Claude Code CLI was not found",
      hint: "npm install -g @anthropic-ai/claude-code",
    });
    expect(state.busy).toBe(false);
  });

  it("treats a dropped connection like an error event", () => {
    const state = run([submit, { type: "transport-error", message: "The assistant connection dropped." }]);
    expect(reply(state)).toMatchObject({ status: "error", error: "The assistant connection dropped." });
    expect(state.busy).toBe(false);
  });

  it("marks a stopped turn as done and stops pretending tools are running", () => {
    const state = run([
      submit,
      { type: "event", event: { type: "text", text: "Working on it" } },
      { type: "event", event: { type: "tool", toolId: "t1", name: "create_shape", summary: "create_shape" } },
      { type: "stopped" },
    ]);
    expect(reply(state)).toMatchObject({ status: "done", text: "Working on it\n\n(stopped)" });
    expect(reply(state).tools[0].status).toBe("failed");
    expect(state.busy).toBe(false);
  });

  it("leaves an already finished reply alone when a stop arrives late", () => {
    const finished = run([submit, { type: "event", event: { type: "result", sessionId: "s-5", text: "done", isError: false, durationMs: 5 } }]);
    const stopped = assistantDockReducer(finished, { type: "stopped" });
    expect(reply(stopped).text).toBe("done");
    expect(reply(stopped).status).toBe("done");
  });

  it("only ever updates the newest reply", () => {
    const first = run([submit, { type: "event", event: { type: "result", sessionId: "s-1", text: "first", isError: false, durationMs: 1 } }]);
    const second = run(
      [
        { type: "submit", userId: "u2", replyId: "a2", text: "and a cylinder" },
        { type: "event", event: { type: "text", text: "second" } },
      ],
      first,
    );
    const replies = second.messages.filter((message): message is AssistantReplyMessage => message.role === "assistant");
    expect(replies.map((message) => message.text)).toEqual(["first", "second"]);
  });

  it("drops the session id when the transcript is cleared", () => {
    const state = run([submit, { type: "event", event: { type: "result", sessionId: "s-6", text: "ok", isError: false, durationMs: 1 } }]);
    expect(assistantDockReducer(state, { type: "clear" })).toEqual(initialAssistantDockState);
  });

  it("ignores events that arrive before any reply exists", () => {
    expect(assistantDockReducer(initialAssistantDockState, { type: "event", event: { type: "text", text: "stray" } })).toEqual(
      initialAssistantDockState,
    );
  });
});
