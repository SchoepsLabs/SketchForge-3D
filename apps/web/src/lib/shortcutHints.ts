/**
 * One table of the keys the editor binds, so a toolbar tooltip and
 * `docs/SHORTCUTS.md` can never disagree about them.
 *
 * Only actions that a toolbar button *also* offers live here — the full key
 * inventory (camera, placement, sketch mode) is in the doc. A test asserts every
 * entry below appears in that doc, which is what stops the two from drifting.
 *
 * Keys are written the way the doc writes them, with `Ctrl` standing for
 * Ctrl-or-Cmd: every binding tests `event.ctrlKey || event.metaKey`.
 */

export type ShortcutHintId =
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "delete"
  | "undo"
  | "redo"
  | "group"
  | "ungroup"
  | "align"
  | "mirror"
  | "hole"
  | "solid"
  | "lock"
  | "hide"
  | "dropToWorkplane";

export const SHORTCUT_HINTS: Record<ShortcutHintId, string> = {
  copy: "Ctrl+C",
  cut: "Ctrl+X",
  paste: "Ctrl+V",
  duplicate: "Ctrl+D",
  delete: "Delete",
  undo: "Ctrl+Z",
  redo: "Ctrl+Shift+Z",
  group: "Ctrl+G",
  ungroup: "Ctrl+Shift+G",
  align: "L",
  mirror: "M",
  hole: "H",
  solid: "S",
  lock: "Ctrl+L",
  hide: "Ctrl+H",
  dropToWorkplane: "D",
};

/** macOS shows its own glyphs; every binding already accepts Cmd for Ctrl. */
export function formatShortcutKeys(keys: string, { mac = false }: { mac?: boolean } = {}) {
  if (!mac) return keys;
  return keys.replace(/Ctrl\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Delete/g, "⌫");
}

/** `Duplicate` + `duplicate` → `Duplicate (Ctrl+D)`. Unbound actions keep the bare label. */
export function toolbarTooltip(label: string, id?: ShortcutHintId | null, options: { mac?: boolean } = {}) {
  const keys = id ? SHORTCUT_HINTS[id] : undefined;
  return keys ? `${label} (${formatShortcutKeys(keys, options)})` : label;
}

export function isMacPlatform(platform: string | undefined | null) {
  return Boolean(platform && /mac|iphone|ipad|ipod/i.test(platform));
}
