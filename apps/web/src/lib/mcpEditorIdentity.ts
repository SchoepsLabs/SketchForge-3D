/**
 * Per-tab identity used by the MCP bridge heartbeat.
 *
 * The editor creates it; the assistant dock needs to *read* it so the CLI turn
 * it spawns acts on this tab and not another open editor. Both go through this
 * module so the storage key cannot drift between writer and reader.
 */

export const MCP_EDITOR_IDENTITY_STORAGE_KEY = "sketchforge.mcp.editorIdentity";

export type McpEditorIdentity = {
  editorId: string;
  editorNumber: number;
};

function storedIdentity(): McpEditorIdentity | null {
  try {
    const existing = JSON.parse(window.sessionStorage.getItem(MCP_EDITOR_IDENTITY_STORAGE_KEY) ?? "null") as
      | { editorId?: unknown; editorNumber?: unknown }
      | null;
    if (typeof existing?.editorId === "string" && typeof existing.editorNumber === "number") {
      return { editorId: existing.editorId, editorNumber: existing.editorNumber };
    }
  } catch {
    // Session identity is best-effort; the caller decides what to do without one.
  }
  return null;
}

/** Read the identity for this tab, creating and persisting one if needed. */
export function readMcpEditorIdentity(): McpEditorIdentity {
  const existing = storedIdentity();
  if (existing) return existing;

  const randomValues = new Uint32Array(1);
  window.crypto?.getRandomValues?.(randomValues);
  const editorNumber = 10000 + ((randomValues[0] || Math.floor(Math.random() * 90000)) % 90000);
  const editorId = window.crypto?.randomUUID?.() ?? `sketchforge-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const identity = { editorId, editorNumber };
  try {
    window.sessionStorage.setItem(MCP_EDITOR_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private browsing can block sessionStorage; the in-memory identity is enough for this tab.
  }
  return identity;
}

/**
 * Read-only view for consumers that must not mint an identity — the editor owns
 * creation, and an id nothing is heartbeating for would point at no editor.
 */
export function readMcpEditorNumber(): number | null {
  if (typeof window === "undefined") return null;
  return storedIdentity()?.editorNumber ?? null;
}
