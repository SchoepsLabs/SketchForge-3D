import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ALLOWED_TOOLS,
  assistantMcpConfig,
  assistantToolLabel,
  buildAssistantCliArgs,
  createAssistantStreamParser,
  createLineSplitter,
  describeAssistantToolUse,
  quoteCliArg,
  resolveAssistantCliCommand,
  summarizeAssistantToolResult,
} from "@/lib/assistantCli";

/**
 * Fixtures below are trimmed copies of real `claude -p --output-format stream-json
 * --verbose --include-partial-messages` output captured from CLI 2.1.222, not
 * invented shapes.
 */

function flagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

describe("buildAssistantCliArgs", () => {
  it("asks for streamed json in print mode", () => {
    const args = buildAssistantCliArgs({ mcpConfigPath: "/tmp/mcp.json" });
    expect(args).toContain("-p");
    expect(flagValue(args, "--output-format")).toBe("stream-json");
    // stream-json in print mode only emits events with --verbose.
    expect(args).toContain("--verbose");
    expect(args).toContain("--include-partial-messages");
  });

  it("points the CLI at the sketchforge MCP config and nothing else", () => {
    const args = buildAssistantCliArgs({ mcpConfigPath: "/tmp/mcp.json" });
    expect(flagValue(args, "--mcp-config")).toBe("/tmp/mcp.json");
    expect(args).toContain("--strict-mcp-config");
    expect(flagValue(args, "--tools")).toBe("");
  });

  it("keeps the variadic --allowedTools last so nothing is swallowed", () => {
    const args = buildAssistantCliArgs({ mcpConfigPath: "/tmp/mcp.json" });
    const allowedIndex = args.indexOf("--allowedTools");
    expect(allowedIndex).toBeGreaterThan(-1);
    expect(args.slice(allowedIndex + 1)).toEqual(ASSISTANT_ALLOWED_TOOLS);
  });

  it("never passes the prompt as an argument", () => {
    const args = buildAssistantCliArgs({ mcpConfigPath: "/tmp/mcp.json", systemPromptPath: "/tmp/sys.txt" });
    // Every token is a flag or a value that belongs to the flag before it.
    expect(args.some((arg) => arg.includes("Reply with"))).toBe(false);
    expect(flagValue(args, "--append-system-prompt-file")).toBe("/tmp/sys.txt");
  });

  it("resumes the previous session when one is supplied", () => {
    const withResume = buildAssistantCliArgs({ mcpConfigPath: "/tmp/mcp.json", resumeSessionId: "abc-123" });
    expect(flagValue(withResume, "--resume")).toBe("abc-123");

    const firstTurn = buildAssistantCliArgs({ mcpConfigPath: "/tmp/mcp.json" });
    expect(firstTurn).not.toContain("--resume");
  });

  it("omits optional flags rather than passing empty values", () => {
    const args = buildAssistantCliArgs({ mcpConfigPath: "/tmp/mcp.json", systemPromptPath: null, model: null });
    expect(args).not.toContain("--append-system-prompt-file");
    expect(args).not.toContain("--model");
  });
});

describe("assistantMcpConfig", () => {
  it("runs the repo's own bridge server against the calling dev server", () => {
    const config = assistantMcpConfig({ serverScriptPath: "D:/repo/scripts/sketchforge-mcp-server.mjs", baseUrl: "http://localhost:3001" });
    expect(config.mcpServers.sketchforge).toEqual({
      command: "node",
      args: ["D:/repo/scripts/sketchforge-mcp-server.mjs"],
      env: { SKETCHFORGE_URL: "http://localhost:3001" },
    });
  });
});

describe("resolveAssistantCliCommand", () => {
  it("spawns the npm .cmd shim through a shell on Windows", () => {
    expect(resolveAssistantCliCommand({ platform: "win32" })).toEqual({ command: "claude.cmd", useShell: true });
  });

  it("spawns the bare binary directly elsewhere", () => {
    expect(resolveAssistantCliCommand({ platform: "linux" })).toEqual({ command: "claude", useShell: false });
  });

  it("honours an explicit binary path", () => {
    expect(resolveAssistantCliCommand({ platform: "linux", override: "/opt/claude/claude" })).toEqual({
      command: "/opt/claude/claude",
      useShell: false,
    });
    expect(resolveAssistantCliCommand({ platform: "win32", override: "C:/tools/claude.exe" })).toEqual({
      command: "C:/tools/claude.exe",
      useShell: false,
    });
    expect(resolveAssistantCliCommand({ platform: "win32", override: "  " })).toEqual({ command: "claude.cmd", useShell: true });
  });
});

describe("quoteCliArg", () => {
  it("quotes paths with spaces and keeps plain tokens bare", () => {
    expect(quoteCliArg("C:/Users/marty/App Data/mcp.json")).toBe('"C:/Users/marty/App Data/mcp.json"');
    expect(quoteCliArg("--verbose")).toBe("--verbose");
  });

  it("keeps an empty argument visible to the shell", () => {
    // `--tools ""` disables the built-in tools; an unquoted empty string vanishes.
    expect(quoteCliArg("")).toBe('""');
  });
});

describe("assistantToolLabel", () => {
  it("strips both the MCP server prefix and the tool namespace", () => {
    expect(assistantToolLabel("mcp__sketchforge__sketchforge_create_shape")).toBe("create_shape");
    expect(assistantToolLabel("mcp__other-server__do_thing")).toBe("do_thing");
    expect(assistantToolLabel("Read")).toBe("Read");
  });
});

describe("describeAssistantToolUse", () => {
  it("summarises the parameters that matter", () => {
    const summary = describeAssistantToolUse("mcp__sketchforge__sketchforge_create_shape", {
      editorNumber: 41234,
      kind: "box",
      width: 20,
      height: 10,
      hole: false,
    });
    expect(summary).toBe("create_shape (kind: box, width: 20, height: 10, hole: false)");
  });

  it("collapses bulk arrays instead of printing a mesh", () => {
    const summary = describeAssistantToolUse("mcp__sketchforge__sketchforge_import_mesh", {
      name: "bracket",
      positions: new Array(1152).fill(0),
    });
    expect(summary).toBe("import_mesh (name: bracket, positions: [1152])");
  });

  it("falls back to the bare label when there is nothing to show", () => {
    expect(describeAssistantToolUse("mcp__sketchforge__sketchforge_list_editors", {})).toBe("list_editors");
    expect(describeAssistantToolUse("mcp__sketchforge__sketchforge_read_scene", { editorNumber: 41234 })).toBe("read_scene");
    expect(describeAssistantToolUse("mcp__sketchforge__sketchforge_read_scene", undefined)).toBe("read_scene");
  });

  it("clips a runaway parameter list to one transcript line", () => {
    const summary = describeAssistantToolUse("mcp__sketchforge__sketchforge_update_object", {
      name: "a".repeat(200),
      note: "b".repeat(200),
    });
    expect(summary.length).toBeLessThanOrEqual("update_object ()".length + 140);
    expect(summary.endsWith("…)")).toBe(true);
  });
});

describe("summarizeAssistantToolResult", () => {
  it("flattens the content blocks a tool result carries", () => {
    expect(summarizeAssistantToolResult([{ type: "text", text: "{\n  \"id\": \"shape-1\"\n}" }])).toBe('{ "id": "shape-1" }');
    expect(summarizeAssistantToolResult("plain text")).toBe("plain text");
    expect(summarizeAssistantToolResult([{ type: "image", data: "…" }])).toBe("[image]");
  });

  it("truncates a long payload", () => {
    const summary = summarizeAssistantToolResult("x".repeat(500));
    expect(summary).toHaveLength(160);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("createLineSplitter", () => {
  it("reassembles json objects split across chunk boundaries", () => {
    const splitter = createLineSplitter();
    expect(splitter.push('{"type":"a"}\n{"type":')).toEqual(['{"type":"a"}']);
    expect(splitter.push('"b"}\n')).toEqual(['{"type":"b"}']);
    expect(splitter.flush()).toEqual([]);
  });

  it("flushes a trailing line that never got its newline", () => {
    const splitter = createLineSplitter();
    expect(splitter.push('{"type":"a"}')).toEqual([]);
    expect(splitter.flush()).toEqual(['{"type":"a"}']);
  });
});

describe("createAssistantStreamParser", () => {
  it("reports the session, model and MCP server status from the init line", () => {
    const parser = createAssistantStreamParser();
    const events = parser.push(
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "00416715-052f-45c1-b08a-2cb7084fe774",
        model: "claude-opus-5",
        tools: ["mcp__sketchforge__sketchforge_create_shape"],
        mcp_servers: [{ name: "sketchforge", status: "connected" }],
      }),
    );
    expect(events).toEqual([
      {
        type: "session",
        sessionId: "00416715-052f-45c1-b08a-2cb7084fe774",
        model: "claude-opus-5",
        toolNames: ["mcp__sketchforge__sketchforge_create_shape"],
        mcpServers: [{ name: "sketchforge", status: "connected" }],
      },
    ]);
  });

  it("streams text deltas and does not repeat them from the completed message", () => {
    const parser = createAssistantStreamParser();
    parser.push(JSON.stringify({ type: "stream_event", event: { type: "message_start", message: { id: "msg_1" } } }));
    const first = parser.push(
      JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Adding " } } }),
    );
    const second = parser.push(
      JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "a box." } } }),
    );
    const complete = parser.push(
      JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "Adding a box." }] } }),
    );

    expect(first).toEqual([{ type: "text", text: "Adding " }]);
    expect(second).toEqual([{ type: "text", text: "a box." }]);
    // The duplicate is the whole point of tracking message ids.
    expect(complete).toEqual([]);
  });

  it("emits text from a completed message that never streamed", () => {
    const parser = createAssistantStreamParser();
    const events = parser.push(
      JSON.stringify({ type: "assistant", message: { id: "msg_2", content: [{ type: "text", text: "pong" }] } }),
    );
    expect(events).toEqual([{ type: "text", text: "pong" }]);
  });

  it("ignores thinking deltas", () => {
    const parser = createAssistantStreamParser();
    expect(
      parser.push(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } } })),
    ).toEqual([]);
  });

  it("pairs a tool call with its result", () => {
    const parser = createAssistantStreamParser();
    const call = parser.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_3",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "mcp__sketchforge__sketchforge_create_shape",
              input: { editorNumber: 41234, kind: "box", width: 20 },
            },
          ],
        },
      }),
    );
    const result = parser.push(
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: '{"id":"shape-7"}' }] }] },
      }),
    );

    expect(call).toEqual([{ type: "tool", toolId: "toolu_1", name: "create_shape", summary: "create_shape (kind: box, width: 20)" }]);
    expect(result).toEqual([{ type: "tool-result", toolId: "toolu_1", name: "create_shape", ok: true, summary: '{"id":"shape-7"}' }]);
  });

  it("marks a failed tool result", () => {
    const parser = createAssistantStreamParser();
    const events = parser.push(
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", is_error: true, content: "No open SketchForge editors found" }] },
      }),
    );
    expect(events).toEqual([
      { type: "tool-result", toolId: "toolu_9", name: "tool", ok: false, summary: "No open SketchForge editors found" },
    ]);
  });

  it("closes the turn with the session id the next message resumes from", () => {
    const parser = createAssistantStreamParser();
    const events = parser.push(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Added a 20 mm box.",
        session_id: "00416715-052f-45c1-b08a-2cb7084fe774",
        duration_ms: 3321,
      }),
    );
    expect(events).toEqual([
      {
        type: "result",
        sessionId: "00416715-052f-45c1-b08a-2cb7084fe774",
        text: "Added a 20 mm box.",
        isError: false,
        durationMs: 3321,
      },
    ]);
  });

  it("treats a non-success result subtype as an error turn", () => {
    const parser = createAssistantStreamParser();
    const [event] = parser.push(
      JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: false, result: "", session_id: "s-1" }),
    );
    expect(event).toMatchObject({ type: "result", isError: true, sessionId: "s-1" });
  });

  it("skips noise: blank lines, non-json, and event types the dock ignores", () => {
    const parser = createAssistantStreamParser();
    expect(parser.push("")).toEqual([]);
    expect(parser.push("Warning: something on stdout")).toEqual([]);
    expect(parser.push(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }))).toEqual([]);
    expect(parser.push(JSON.stringify({ type: "system", subtype: "compact_boundary" }))).toEqual([]);
    expect(parser.push(JSON.stringify(["not", "an", "object"]))).toEqual([]);
  });
});
