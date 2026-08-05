"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  assistantDockReducer,
  initialAssistantDockState,
  type AssistantReplyMessage,
  type AssistantToolEntry,
} from "@/lib/assistantDockState";
import { ASSISTANT_ROUTE, createAssistantEventDecoder } from "@/lib/assistantProtocol";
import { readMcpEditorNumber } from "@/lib/mcpEditorIdentity";

/**
 * Collapsible chat dock on the right edge of the editor body.
 *
 * It is a flex sibling of the viewport rather than an overlay, so it can never
 * cover the shape inspector (which is absolutely positioned inside the viewport
 * stage). The viewport only resizes on window resize, so expanding or
 * collapsing the dock dispatches one.
 */

const COLLAPSED_STORAGE_KEY = "sketchforge.assistant.collapsed";

function messageId(prefix: string) {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${unique}`;
}

function toolStatusLabel(tool: AssistantToolEntry) {
  if (tool.status === "running") return "running";
  return tool.status === "ok" ? "done" : "failed";
}

function ToolLine({ tool }: { tool: AssistantToolEntry }) {
  return (
    <li className={`assistant-tool assistant-tool-${tool.status}`}>
      <div className="assistant-tool-line">
        <span className="assistant-tool-dot" aria-hidden />
        <span className="assistant-tool-summary" title={tool.result || tool.summary}>
          {tool.summary}
        </span>
        <span className="assistant-tool-status">{toolStatusLabel(tool)}</span>
      </div>
      {/* A failed call is the one result worth reading without hovering. */}
      {tool.status === "failed" && tool.result ? <p className="assistant-tool-failure">{tool.result}</p> : null}
    </li>
  );
}

function ReplyBody({ message }: { message: AssistantReplyMessage }) {
  const showThinking = message.status === "streaming" && !message.text && message.tools.length === 0;
  return (
    <>
      {message.tools.length ? (
        <ul className="assistant-tool-list">
          {message.tools.map((tool) => (
            <ToolLine key={tool.toolId} tool={tool} />
          ))}
        </ul>
      ) : null}
      {showThinking ? <p className="assistant-thinking">Working…</p> : null}
      {message.text ? <p className="assistant-text">{message.text}</p> : null}
      {message.error ? (
        <p className="assistant-error">
          {message.error}
          {message.hint ? <span className="assistant-error-hint">{message.hint}</span> : null}
        </p>
      ) : null}
    </>
  );
}

export function AssistantDock() {
  const [state, dispatch] = useReducer(assistantDockReducer, initialAssistantDockState);
  const [collapsed, setCollapsed] = useState(true);
  const [available, setAvailable] = useState(false);
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    sessionIdRef.current = state.sessionId;
  }, [state.sessionId]);

  // The backend route is dev-and-localhost only, so the dock hides everywhere
  // else instead of offering a button that always fails.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    if (!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) return;
    setAvailable(true);
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_STORAGE_KEY) !== "false");
    } catch {
      // Blocked storage just means the dock starts collapsed.
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
    } catch {
      // Persisting the dock state is best-effort.
    }
    // The three.js viewport sizes itself from its host element on window resize
    // only, so tell it the flex row just changed width.
    window.dispatchEvent(new Event("resize"));
  }, [available, collapsed]);

  useEffect(() => {
    if (collapsed) return;
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [collapsed, state.messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || abortRef.current) return;

    setDraft("");
    dispatch({ type: "submit", userId: messageId("user"), replyId: messageId("reply"), text });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(ASSISTANT_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          sessionId: sessionIdRef.current,
          editorNumber: readMcpEditorNumber(),
        }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        dispatch({ type: "transport-error", message: payload?.error ?? `The assistant backend returned HTTP ${response.status}.` });
        return;
      }

      const reader = response.body.getReader();
      const bytes = new TextDecoder();
      const events = createAssistantEventDecoder();
      let closed = false;
      const consume = (chunk: string) => {
        for (const event of events.push(chunk)) {
          if (event.type === "result" || event.type === "error") closed = true;
          dispatch({ type: "event", event });
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        consume(bytes.decode(value, { stream: true }));
      }
      for (const event of events.flush()) {
        if (event.type === "result" || event.type === "error") closed = true;
        dispatch({ type: "event", event });
      }
      if (!closed) {
        // The route always ends with a result or an error event, so a clean EOF
        // without one means the dev server restarted mid-turn.
        dispatch({ type: "transport-error", message: "The assistant connection closed before the turn finished." });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        dispatch({ type: "stopped" });
      } else {
        dispatch({ type: "transport-error", message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      abortRef.current = null;
    }
  }, [draft]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  if (!available) return null;

  if (collapsed) {
    return (
      <div className="assistant-dock collapsed">
        <button
          type="button"
          className="assistant-dock-tab"
          title="Open the Claude chat dock"
          aria-label="Open the Claude chat dock"
          onClick={() => setCollapsed(false)}
        >
          <span className="assistant-dock-tab-label">Claude</span>
        </button>
      </div>
    );
  }

  return (
    <aside className="assistant-dock" aria-label="Claude chat dock">
      <header className="assistant-dock-header">
        <strong>Claude</strong>
        <div className="assistant-dock-header-actions">
          <button type="button" className="assistant-dock-button" onClick={() => dispatch({ type: "clear" })} disabled={state.busy || state.messages.length === 0}>
            New chat
          </button>
          <button type="button" className="assistant-dock-button" onClick={() => setCollapsed(true)} aria-label="Collapse the chat dock" title="Collapse (Esc)">
            ×
          </button>
        </div>
      </header>

      <div className="assistant-transcript" ref={transcriptRef}>
        {state.messages.length === 0 ? (
          <p className="assistant-empty">
            Ask for a change to the scene — &ldquo;add a 20 mm box at the origin and fillet the top edges&rdquo;. Runs on the Claude Code CLI
            installed on this machine.
          </p>
        ) : null}
        {state.messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="assistant-message assistant-message-user">
              <p className="assistant-text">{message.text}</p>
            </div>
          ) : (
            <div key={message.id} className={`assistant-message assistant-message-reply assistant-message-${message.status}`}>
              <ReplyBody message={message} />
            </div>
          ),
        )}
      </div>

      <div className="assistant-composer">
        <textarea
          ref={inputRef}
          className="assistant-input"
          rows={3}
          value={draft}
          placeholder="Describe the change…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              // The editor ignores keys from textareas, but be explicit: Esc
              // here means "collapse the dock", not "cancel the placement".
              event.stopPropagation();
              setCollapsed(true);
            }
          }}
        />
        <div className="assistant-composer-actions">
          <span className="assistant-hint">Enter sends · Shift+Enter newline</span>
          {state.busy ? (
            <button type="button" className="assistant-dock-button" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" className="assistant-send" onClick={() => void send()} disabled={!draft.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
