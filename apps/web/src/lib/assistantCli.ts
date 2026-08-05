import type { AssistantEvent, AssistantMcpServerStatus } from "@/lib/assistantProtocol";

/**
 * Pure helpers for driving the locally installed Claude Code CLI in headless
 * print mode (`claude -p`), which is what powers the in-editor assistant dock.
 *
 * Nothing here touches `node:child_process` — the route owns the process, this
 * module owns the argv, the MCP config, and the stream-json parsing, so all of
 * that is unit-testable without spawning anything.
 *
 * Two CLI behaviours drove the design and are easy to trip over again:
 *   1. `--mcp-config`, `--allowedTools` and `--tools` are *variadic* options, so
 *      a prompt passed as a positional argument after any of them is swallowed
 *      ("Input must be provided either through stdin or as a prompt argument").
 *      The prompt therefore always goes over stdin, and every remaining argument
 *      is a flag, a file path, or a bare token — never free text.
 *   2. Long text (system prompt, MCP config) goes through *files*, not argv:
 *      on Windows `claude` is an npm `.cmd` shim, which Node can only spawn with
 *      `shell: true`, and shell quoting a JSON blob is a bug farm.
 */

export const ASSISTANT_MCP_SERVER_NAME = "sketchforge";

/** Whole-server form plus the wildcard form, so either CLI vintage allows the bridge tools. */
export const ASSISTANT_ALLOWED_TOOLS = [
  `mcp__${ASSISTANT_MCP_SERVER_NAME}`,
  `mcp__${ASSISTANT_MCP_SERVER_NAME}__*`,
];

export const CLAUDE_CLI_MISSING_MESSAGE =
  "The Claude Code CLI was not found on this machine, so the assistant dock has nothing to talk to.";

export const CLAUDE_CLI_MISSING_HINT =
  "Install it with `npm install -g @anthropic-ai/claude-code`, run `claude` once to sign in with your subscription, then reopen the dock. Set SKETCHFORGE_CLAUDE_BIN in deploy/docker/.env if it lives somewhere off PATH.";

export type AssistantMcpConfig = {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  >;
};

/**
 * MCP config handed to the spawned CLI: the repo's own bridge server, pointed at
 * the dev server that is serving this request. Same tool layer the desktop
 * bridge uses — the dock does not hand-write a second copy of the tools.
 */
export function assistantMcpConfig({
  serverScriptPath,
  baseUrl,
  nodePath = "node",
}: {
  serverScriptPath: string;
  baseUrl: string;
  nodePath?: string;
}): AssistantMcpConfig {
  return {
    mcpServers: {
      [ASSISTANT_MCP_SERVER_NAME]: {
        command: nodePath,
        args: [serverScriptPath],
        env: { SKETCHFORGE_URL: baseUrl },
      },
    },
  };
}

export type AssistantCliArgsOptions = {
  mcpConfigPath: string;
  /** File holding the scene/system context; omitted when there is nothing to add. */
  systemPromptPath?: string | null;
  /** Session id from the previous turn's result event, for conversation continuity. */
  resumeSessionId?: string | null;
  model?: string | null;
  allowedTools?: string[];
};

export function buildAssistantCliArgs({
  mcpConfigPath,
  systemPromptPath = null,
  resumeSessionId = null,
  model = null,
  allowedTools = ASSISTANT_ALLOWED_TOOLS,
}: AssistantCliArgsOptions): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    // stream-json in print mode only emits the event stream with --verbose.
    "--verbose",
    // Token-level text deltas; without this the dock waits for whole blocks.
    "--include-partial-messages",
    // The dock's Claude edits the live scene and nothing else: no repo file
    // access, no Bash, and no permission prompt that could hang a headless run.
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfigPath,
  ];

  if (model) {
    args.push("--model", model);
  }
  if (systemPromptPath) {
    args.push("--append-system-prompt-file", systemPromptPath);
  }
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  // Variadic, so it stays last — nothing may follow it that is not a flag.
  args.push("--allowedTools", ...allowedTools);
  return args;
}

/**
 * Windows ships `claude` as an npm `.cmd` shim, which Node refuses to spawn
 * without a shell. Everywhere else the bare binary spawns directly.
 */
export function resolveAssistantCliCommand({
  platform = process.platform,
  override,
}: { platform?: string; override?: string | null } = {}) {
  const trimmed = override?.trim();
  if (trimmed) {
    return { command: trimmed, useShell: platform === "win32" && /\.(cmd|bat)$/i.test(trimmed) };
  }
  return platform === "win32"
    ? { command: "claude.cmd", useShell: true }
    : { command: "claude", useShell: false };
}

/** Quote an argument for a `shell: true` spawn. Only needed on the Windows path. */
export function quoteCliArg(arg: string) {
  if (arg === "") return '""';
  return /[\s"^&|<>()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function shortValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value.length > 40 ? `${value.slice(0, 39)}…` : value;
  if (Array.isArray(value)) return `[${value.length}]`;
  return null;
}

const TOOL_SUMMARY_SKIPPED_KEYS = new Set(["editorNumber", "editorId", "timeoutMs"]);
const TOOL_SUMMARY_MAX_LENGTH = 140;

const MCP_TOOL_PREFIX = `mcp__${ASSISTANT_MCP_SERVER_NAME}__`;
const SKETCHFORGE_TOOL_PREFIX = `${ASSISTANT_MCP_SERVER_NAME}_`;

/** `mcp__sketchforge__sketchforge_create_shape` → `create_shape`. */
export function assistantToolLabel(name: string) {
  const withoutServer = name.startsWith(MCP_TOOL_PREFIX)
    ? name.slice(MCP_TOOL_PREFIX.length)
    : name.replace(/^mcp__[A-Za-z0-9.-]+__/, "");
  return withoutServer.startsWith(SKETCHFORGE_TOOL_PREFIX)
    ? withoutServer.slice(SKETCHFORGE_TOOL_PREFIX.length)
    : withoutServer;
}

/** One transcript line for a tool call: `create_shape (kind: box, width: 20)`. */
export function describeAssistantToolUse(name: string, input: unknown) {
  const label = assistantToolLabel(name);
  if (!input || typeof input !== "object" || Array.isArray(input)) return label;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (TOOL_SUMMARY_SKIPPED_KEYS.has(key)) continue;
    const rendered = shortValue(value);
    if (rendered === null) continue;
    parts.push(`${key}: ${rendered}`);
  }
  if (parts.length === 0) return label;

  const joined = parts.join(", ");
  const clipped = joined.length > TOOL_SUMMARY_MAX_LENGTH ? `${joined.slice(0, TOOL_SUMMARY_MAX_LENGTH - 1)}…` : joined;
  return `${label} (${clipped})`;
}

const TOOL_RESULT_MAX_LENGTH = 160;

export function summarizeAssistantToolResult(content: unknown): string {
  const text = (() => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (typeof block === "string") return block;
          if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
            return (block as { text: string }).text;
          }
          if (block && typeof block === "object" && (block as { type?: unknown }).type === "image") return "[image]";
          return "";
        })
        .filter(Boolean)
        .join(" ");
    }
    if (content && typeof content === "object") return JSON.stringify(content);
    return "";
  })();

  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= TOOL_RESULT_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, TOOL_RESULT_MAX_LENGTH - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readMcpServers(value: unknown): AssistantMcpServerStatus[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const name = stringOrNull(entry.name);
    if (!name) return [];
    return [{ name, status: stringOrNull(entry.status) ?? "unknown" }];
  });
}

/**
 * Turns the CLI's newline-delimited stream-json into dock events.
 *
 * Stateful on purpose. With `--include-partial-messages` the same assistant text
 * arrives twice — once as `stream_event` text deltas and again in the complete
 * `assistant` message — so the parser remembers which message ids already
 * streamed and drops their duplicate blocks. It also remembers tool_use ids so a
 * later `tool_result` can be labelled with the tool that produced it.
 */
export function createAssistantStreamParser() {
  const streamedMessageIds = new Set<string>();
  const toolNamesById = new Map<string, string>();

  function fromAssistantMessage(payload: Record<string, unknown>): AssistantEvent[] {
    const message = isRecord(payload.message) ? payload.message : null;
    if (!message || !Array.isArray(message.content)) return [];
    const messageId = stringOrNull(message.id);
    const alreadyStreamed = messageId !== null && streamedMessageIds.has(messageId);

    return message.content.flatMap((block): AssistantEvent[] => {
      if (!isRecord(block)) return [];
      if (block.type === "text") {
        const text = typeof block.text === "string" ? block.text : "";
        return !alreadyStreamed && text ? [{ type: "text", text }] : [];
      }
      if (block.type === "tool_use") {
        const name = stringOrNull(block.name) ?? "tool";
        const toolId = stringOrNull(block.id) ?? name;
        toolNamesById.set(toolId, name);
        return [{ type: "tool", toolId, name: assistantToolLabel(name), summary: describeAssistantToolUse(name, block.input) }];
      }
      return [];
    });
  }

  function fromUserMessage(payload: Record<string, unknown>): AssistantEvent[] {
    const message = isRecord(payload.message) ? payload.message : null;
    if (!message || !Array.isArray(message.content)) return [];

    return message.content.flatMap((block): AssistantEvent[] => {
      if (!isRecord(block) || block.type !== "tool_result") return [];
      const toolId = stringOrNull(block.tool_use_id) ?? "";
      const name = assistantToolLabel(toolNamesById.get(toolId) ?? "tool");
      return [
        {
          type: "tool-result",
          toolId,
          name,
          ok: block.is_error !== true,
          summary: summarizeAssistantToolResult(block.content),
        },
      ];
    });
  }

  function fromStreamEvent(payload: Record<string, unknown>): AssistantEvent[] {
    const event = isRecord(payload.event) ? payload.event : null;
    if (!event) return [];

    if (event.type === "message_start") {
      const messageId = isRecord(event.message) ? stringOrNull(event.message.id) : null;
      if (messageId) streamedMessageIds.add(messageId);
      return [];
    }
    if (event.type === "content_block_delta") {
      const delta = isRecord(event.delta) ? event.delta : null;
      // Thinking and partial tool-input deltas are noise in a chat transcript.
      if (!delta || delta.type !== "text_delta" || typeof delta.text !== "string" || !delta.text) return [];
      return [{ type: "text", text: delta.text }];
    }
    return [];
  }

  return {
    /** Parse one stream-json line. Non-JSON and uninteresting lines yield nothing. */
    push(line: string): AssistantEvent[] {
      const trimmed = line.trim();
      if (!trimmed) return [];

      let payload: unknown;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        return [];
      }
      if (!isRecord(payload)) return [];

      switch (payload.type) {
        case "system":
          if (payload.subtype !== "init") return [];
          return [
            {
              type: "session",
              sessionId: stringOrNull(payload.session_id) ?? "",
              model: stringOrNull(payload.model) ?? "",
              toolNames: Array.isArray(payload.tools) ? payload.tools.filter((tool): tool is string => typeof tool === "string") : [],
              mcpServers: readMcpServers(payload.mcp_servers),
            },
          ];
        case "stream_event":
          return fromStreamEvent(payload);
        case "assistant":
          return fromAssistantMessage(payload);
        case "user":
          return fromUserMessage(payload);
        case "result":
          return [
            {
              type: "result",
              sessionId: stringOrNull(payload.session_id),
              text: typeof payload.result === "string" ? payload.result : "",
              isError: payload.is_error === true || payload.subtype !== "success",
              durationMs: typeof payload.duration_ms === "number" ? payload.duration_ms : null,
            },
          ];
        default:
          return [];
      }
    },
  };
}

/**
 * Splits a stdout chunk stream into whole lines. The CLI writes one JSON object
 * per line but chunk boundaries fall anywhere, and a 500k-triangle mesh result
 * easily spans several chunks.
 */
export function createLineSplitter() {
  let buffer = "";
  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      return lines;
    },
    flush(): string[] {
      const trailing = buffer;
      buffer = "";
      return trailing ? [trailing] : [];
    },
  };
}
