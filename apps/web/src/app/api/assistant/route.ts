import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  assistantMcpConfig,
  buildAssistantCliArgs,
  createAssistantStreamParser,
  createLineSplitter,
  quoteCliArg,
  resolveAssistantCliCommand,
  CLAUDE_CLI_MISSING_HINT,
  CLAUDE_CLI_MISSING_MESSAGE,
} from "@/lib/assistantCli";
import { loadDesignProfile } from "@/lib/assistantDesignProfile";
import type { AssistantEvent, AssistantRequest } from "@/lib/assistantProtocol";
import { encodeAssistantEvent } from "@/lib/assistantProtocol";
import { appendSessionLogTurn, sessionTurnFromEvents } from "@/lib/assistantSessionLog";
import { buildAssistantSystemPrompt } from "@/lib/assistantSystemPrompt";
import { rejectNonLocalRequest } from "@/lib/localRequestGuard";

/**
 * Backend for the in-editor assistant dock.
 *
 * It spawns the locally installed Claude Code CLI in print mode, so the turn
 * runs on the user's own Claude subscription — no API key, no per-token billing
 * here — and hands it the repo's own MCP bridge server as its only tool source.
 * stdout stream-json is translated into the dock's SSE event shape.
 *
 * Local development only, same gate as /api/sketchforge-mcp: this route starts
 * a process on the host.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 20000;
const MCP_SERVER_RELATIVE_PATH = path.join("scripts", "sketchforge-mcp-server.mjs");

function timeoutMs() {
  const configured = Number(process.env.SKETCHFORGE_ASSISTANT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function resolveMcpServerScript() {
  const configured = process.env.SKETCHFORGE_MCP_SERVER_PATH?.trim();
  if (configured) return path.resolve(configured);
  // `next dev apps/web` runs from the repo root, so the script sits under cwd.
  return path.resolve(process.cwd(), MCP_SERVER_RELATIVE_PATH);
}

function eventStreamResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Next's dev proxy and any reverse proxy must not buffer the turn.
      "X-Accel-Buffering": "no",
    },
  });
}

function singleEventStream(event: AssistantEvent) {
  const encoder = new TextEncoder();
  return eventStreamResponse(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(encodeAssistantEvent(event)));
        controller.close();
      },
    }),
  );
}

export async function POST(request: Request) {
  const rejection = rejectNonLocalRequest(request, "The SketchForge assistant");
  if (rejection) {
    return NextResponse.json({ error: rejection.error }, { status: rejection.status });
  }

  let body: AssistantRequest;
  try {
    body = (await request.json()) as AssistantRequest;
  } catch {
    return NextResponse.json({ error: "Invalid assistant request." }, { status: 400 });
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "An assistant message is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Assistant messages are limited to ${MAX_MESSAGE_LENGTH} characters.` }, { status: 400 });
  }

  const serverScriptPath = resolveMcpServerScript();
  if (!existsSync(serverScriptPath)) {
    return singleEventStream({
      type: "error",
      message: "The SketchForge MCP server script was not found, so the assistant would have no scene tools.",
      hint: `Expected it at ${serverScriptPath}. Set SKETCHFORGE_MCP_SERVER_PATH if the repo lives elsewhere.`,
    });
  }

  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;
  const editorNumber = typeof body.editorNumber === "number" ? body.editorNumber : null;
  const sceneContext = typeof body.sceneContext === "string" ? body.sceneContext : null;
  const baseUrl = new URL(request.url).origin;

  const workDir = await mkdtemp(path.join(tmpdir(), "sketchforge-assistant-"));
  const mcpConfigPath = path.join(workDir, "mcp-config.json");
  const systemPromptPath = path.join(workDir, "system-prompt.txt");
  await writeFile(mcpConfigPath, JSON.stringify(assistantMcpConfig({ serverScriptPath, baseUrl }), null, 2), "utf8");
  // Reloaded per request, so editing the profile markdown changes the next reply.
  const designProfile = loadDesignProfile();
  await writeFile(systemPromptPath, buildAssistantSystemPrompt({ editorNumber, sceneContext, designProfile }), "utf8");

  const cli = resolveAssistantCliCommand({ override: process.env.SKETCHFORGE_CLAUDE_BIN });
  const args = buildAssistantCliArgs({
    mcpConfigPath,
    systemPromptPath,
    resumeSessionId: sessionId,
    model: process.env.SKETCHFORGE_ASSISTANT_MODEL?.trim() || null,
  });

  const encoder = new TextEncoder();
  const parser = createAssistantStreamParser();
  const stdoutLines = createLineSplitter();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let settled = false;
      let sawResult = false;
      let stderrText = "";
      const startedAt = Date.now();
      // Kept so the turn can be written to docs/assistant/SESSIONS.md when it ends.
      const loggedEvents: AssistantEvent[] = [];

      const emit = (event: AssistantEvent) => {
        if (settled) return;
        loggedEvents.push(event);
        controller.enqueue(encoder.encode(encodeAssistantEvent(event)));
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
        void rm(workDir, { recursive: true, force: true }).catch(() => undefined);
        // Best-effort and after the fact: logging never blocks or breaks a turn.
        void appendSessionLogTurn(
          sessionTurnFromEvents({
            events: loggedEvents,
            prompt: message,
            startedAt,
            finishedAt: Date.now(),
            editorNumber,
            sessionId,
          }),
        );
        controller.close();
      };

      const child = spawn(cli.command, cli.useShell ? args.map(quoteCliArg) : args, {
        cwd: process.cwd(),
        shell: cli.useShell,
        windowsHide: true,
        env: {
          ...process.env,
          // The bridge server talks back to this dev server.
          SKETCHFORGE_URL: baseUrl,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        emit({
          type: "error",
          message: `The assistant turn ran past ${Math.round(timeoutMs() / 1000)}s and was stopped.`,
          hint: "Ask for a smaller step, or raise SKETCHFORGE_ASSISTANT_TIMEOUT_MS.",
        });
        child.kill();
        finish();
      }, timeoutMs());

      const onAbort = () => {
        child.kill();
        finish();
      };
      request.signal.addEventListener("abort", onAbort);

      // The prompt goes over stdin: --mcp-config/--allowedTools/--tools are
      // variadic, so a positional prompt after them is swallowed by the CLI.
      child.stdin.on("error", () => undefined);
      child.stdin.end(message, "utf8");

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        for (const line of stdoutLines.push(chunk)) {
          for (const event of parser.push(line)) {
            if (event.type === "result") sawResult = true;
            emit(event);
          }
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrText = `${stderrText}${chunk}`.slice(-4000);
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          emit({ type: "error", message: CLAUDE_CLI_MISSING_MESSAGE, hint: CLAUDE_CLI_MISSING_HINT });
        } else {
          emit({ type: "error", message: `Could not start the Claude Code CLI: ${error.message}`, hint: CLAUDE_CLI_MISSING_HINT });
        }
        finish();
      });

      child.on("close", (code) => {
        for (const line of stdoutLines.flush()) {
          for (const event of parser.push(line)) {
            if (event.type === "result") sawResult = true;
            emit(event);
          }
        }
        if (!sawResult) {
          const detail = stderrText.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
          // A shell-spawned .cmd that is missing reports exit 1 with a shell
          // message rather than ENOENT, so treat "no output at all" the same way.
          const looksMissing = !detail || /not recognized|command not found|no such file/i.test(detail);
          emit({
            type: "error",
            message: looksMissing ? CLAUDE_CLI_MISSING_MESSAGE : `The assistant turn ended without a reply (exit ${code ?? "unknown"}).`,
            hint: looksMissing ? CLAUDE_CLI_MISSING_HINT : detail || undefined,
          });
        }
        finish();
      });
    },
  });

  return eventStreamResponse(stream);
}
