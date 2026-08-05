import { describe, expect, it } from "vitest";
import { createAssistantEventDecoder, encodeAssistantEvent, type AssistantEvent } from "@/lib/assistantProtocol";

describe("assistant SSE round trip", () => {
  it("encodes one frame per event", () => {
    const event: AssistantEvent = { type: "text", text: "Adding a box." };
    expect(encodeAssistantEvent(event)).toBe('data: {"type":"text","text":"Adding a box."}\n\n');
  });

  it("survives newlines inside the payload", () => {
    const decoder = createAssistantEventDecoder();
    const event: AssistantEvent = { type: "text", text: "line one\nline two" };
    expect(decoder.push(encodeAssistantEvent(event))).toEqual([event]);
  });

  it("reassembles a frame split across chunks", () => {
    const decoder = createAssistantEventDecoder();
    const encoded = encodeAssistantEvent({ type: "text", text: "streamed" });
    const cut = Math.floor(encoded.length / 2);
    expect(decoder.push(encoded.slice(0, cut))).toEqual([]);
    expect(decoder.push(encoded.slice(cut))).toEqual([{ type: "text", text: "streamed" }]);
  });

  it("decodes several frames arriving in one chunk", () => {
    const decoder = createAssistantEventDecoder();
    const chunk = [
      encodeAssistantEvent({ type: "text", text: "a" }),
      encodeAssistantEvent({ type: "tool", toolId: "toolu_1", name: "create_shape", summary: "create_shape (kind: box)" }),
      encodeAssistantEvent({ type: "result", sessionId: "s-1", text: "done", isError: false, durationMs: 12 }),
    ].join("");
    expect(decoder.push(chunk).map((event) => event.type)).toEqual(["text", "tool", "result"]);
  });

  it("ignores malformed frames instead of throwing at the dock", () => {
    const decoder = createAssistantEventDecoder();
    expect(decoder.push("data: {not json}\n\n")).toEqual([]);
    expect(decoder.push(": keep-alive comment\n\n")).toEqual([]);
    expect(decoder.push("data: 42\n\n")).toEqual([]);
  });

  it("flushes a trailing frame when the stream is cut short", () => {
    const decoder = createAssistantEventDecoder();
    expect(decoder.push('data: {"type":"text","text":"partial"}')).toEqual([]);
    expect(decoder.flush()).toEqual([{ type: "text", text: "partial" }]);
    expect(decoder.flush()).toEqual([]);
  });
});
