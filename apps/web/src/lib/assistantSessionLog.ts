import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AssistantEvent } from "@/lib/assistantProtocol";

/**
 * Durable record of what was designed in the dock and why.
 *
 * The dock's conversations otherwise live only in the CLI's own session files,
 * where neither an overnight run nor the desktop Claude will find them. This
 * appends a readable entry per turn to `docs/assistant/SESSIONS.md`, grouped
 * under a heading per conversation so the turns of one design session read
 * together.
 *
 * Chronological (appended), unlike NIGHTLOG's newest-first — this file is read
 * by tools as much as by people, and appending keeps writes cheap and atomic.
 */

export const DEFAULT_SESSION_LOG_RELATIVE_PATH = path.join("docs", "assistant", "SESSIONS.md");

const LOG_HEADER = `# Dock sessions

Auto-appended by \`/api/assistant\`: one entry per dock turn, grouped by conversation.
Newest at the bottom. Nothing here is hand-edited — it is a record of what the
in-editor assistant actually did.
`;

export type SessionLogTurn = {
  sessionId: string | null;
  startedAt: number;
  finishedAt: number;
  prompt: string;
  editorNumber: number | null;
  toolCalls: { name: string; summary: string; ok: boolean | null }[];
  resultText: string;
  isError: boolean;
};

function timestamp(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shortSession(sessionId: string | null) {
  return sessionId ? sessionId.slice(0, 8) : "no-session";
}

/** Indent a block so a multi-line prompt or reply cannot break the list structure. */
function quote(text: string, limit = 1200) {
  const trimmed = text.trim();
  if (!trimmed) return "_(empty)_";
  const clipped = trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
  return clipped
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function formatSessionLogEntry(turn: SessionLogTurn) {
  const seconds = Math.max(0, Math.round((turn.finishedAt - turn.startedAt) / 1000));
  const lines: string[] = [];
  lines.push(`### ${timestamp(turn.startedAt)} · ${seconds}s${turn.isError ? " · failed" : ""}`);
  lines.push("");
  lines.push("**Prompt**");
  lines.push(quote(turn.prompt));
  lines.push("");
  if (turn.toolCalls.length) {
    lines.push(`**Actions** (${turn.toolCalls.length})`);
    for (const call of turn.toolCalls) {
      const mark = call.ok === false ? " — failed" : "";
      lines.push(`- \`${call.summary || call.name}\`${mark}`);
    }
  } else {
    lines.push("**Actions** — none (nothing was changed)");
  }
  lines.push("");
  lines.push("**Result**");
  lines.push(quote(turn.resultText));
  lines.push("");
  return lines.join("\n");
}

export function formatSessionHeading(turn: SessionLogTurn) {
  const editor = typeof turn.editorNumber === "number" ? ` · editor ${turn.editorNumber}` : "";
  return `\n## ${timestamp(turn.startedAt)} — dock conversation \`${shortSession(turn.sessionId)}\`${editor}\n`;
}

/** Collects the events of one turn into the shape the log wants. */
export function sessionTurnFromEvents({
  events,
  prompt,
  startedAt,
  finishedAt,
  editorNumber,
  sessionId,
}: {
  events: AssistantEvent[];
  prompt: string;
  startedAt: number;
  finishedAt: number;
  editorNumber: number | null;
  sessionId: string | null;
}): SessionLogTurn {
  const results = new Map<string, boolean>();
  for (const event of events) {
    if (event.type === "tool-result") results.set(event.toolId, event.ok);
  }
  const toolCalls = events.flatMap((event) =>
    event.type === "tool" ? [{ name: event.name, summary: event.summary, ok: results.get(event.toolId) ?? null }] : [],
  );
  const resultEvent = events.find((event) => event.type === "result");
  const errorEvent = events.find((event) => event.type === "error");
  const sessionFromEvents = events.reduce<string | null>(
    (found, event) => (event.type === "session" && event.sessionId ? event.sessionId : event.type === "result" && event.sessionId ? event.sessionId : found),
    null,
  );

  return {
    sessionId: sessionId ?? sessionFromEvents,
    startedAt,
    finishedAt,
    prompt,
    editorNumber,
    toolCalls,
    resultText: resultEvent && resultEvent.type === "result" ? resultEvent.text : errorEvent && errorEvent.type === "error" ? errorEvent.message : "",
    isError: Boolean(errorEvent) || (resultEvent?.type === "result" && resultEvent.isError),
  };
}

export function resolveSessionLogPath({ configuredPath, cwd }: { configuredPath?: string | null; cwd: string }) {
  const trimmed = configuredPath?.trim();
  return trimmed ? path.resolve(trimmed) : path.resolve(cwd, DEFAULT_SESSION_LOG_RELATIVE_PATH);
}

/**
 * Appends the turn. Best-effort by design: a logging failure must never take
 * down a design conversation, so every error is swallowed.
 */
export async function appendSessionLogTurn(
  turn: SessionLogTurn,
  { configuredPath = process.env.SKETCHFORGE_ASSISTANT_LOG, cwd = process.cwd() }: { configuredPath?: string | null; cwd?: string } = {},
) {
  try {
    const file = resolveSessionLogPath({ configuredPath, cwd });
    await mkdir(path.dirname(file), { recursive: true });
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch {
      existing = "";
    }
    const parts: string[] = [];
    if (!existing) parts.push(LOG_HEADER);
    // One heading per conversation: later turns of the same session slot in under it.
    if (!existing.includes(`\`${shortSession(turn.sessionId)}\``)) parts.push(formatSessionHeading(turn));
    parts.push(formatSessionLogEntry(turn));
    await appendFile(file, parts.join("\n"), "utf8");
    return true;
  } catch {
    return false;
  }
}
