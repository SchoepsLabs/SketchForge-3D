/**
 * Typing an exact value during a move, rotate, or scale drag.
 *
 * The parsing and the little state machine live here so the tested part sits
 * outside `WorkplaneViewport.tsx`. The viewport owns the drag; this owns what a
 * keystroke means, what the overlay should show, and what value comes out.
 *
 * Accepted while dragging: digits, `.`, a leading `-`, `Tab` to move to the next
 * axis, `Enter` to commit, `Esc` to cancel, `Backspace` to correct. An
 * `X=10` / `x 10` form is accepted too, because people type it out of habit from
 * other CAD tools — it targets that axis directly rather than the current one.
 */

export type NumericTransformAxis = { key: string; label: string; value: number };

export type NumericTransformEntry = {
  axes: NumericTransformAxis[];
  /** Index into `axes` that keystrokes currently apply to. */
  activeIndex: number;
  /** Raw text typed for the active axis, before parsing. */
  buffer: string;
  /** Values committed to other axes by tabbing away from them. */
  entered: Record<string, number>;
};

export type NumericTransformAction =
  | { kind: "none" }
  | { kind: "update"; entry: NumericTransformEntry }
  | { kind: "commit"; values: Record<string, number> }
  | { kind: "cancel" };

const NUMERIC_KEY = /^[0-9]$/;

export function createNumericTransformEntry(axes: NumericTransformAxis[]): NumericTransformEntry {
  return { axes, activeIndex: 0, buffer: "", entered: {} };
}

/**
 * Parses one axis buffer. Returns null for anything that is not a finished
 * number, so a half-typed `-` or `.` simply leaves the axis untouched.
 */
export function parseNumericTransformValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // `X=10`, `x=10`, `x 10` — the axis prefix is handled by the caller; here we
  // only need the numeric tail.
  const withoutAxis = trimmed.replace(/^[a-zA-Z]\s*=?\s*/, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(withoutAxis)) return null;
  const value = Number(withoutAxis);
  return Number.isFinite(value) ? value : null;
}

/** The axis an `X=` style prefix names, or null when the text has no prefix. */
export function axisFromPrefix(raw: string, axes: NumericTransformAxis[]) {
  const match = raw.trim().match(/^([a-zA-Z])\s*=?\s*/);
  if (!match) return null;
  const key = match[1].toLowerCase();
  const index = axes.findIndex((axis) => axis.key.toLowerCase() === key);
  return index === -1 ? null : index;
}

/** True when a keystroke should be captured by numeric entry rather than the app. */
export function isNumericTransformKey(key: string) {
  return (
    NUMERIC_KEY.test(key) ||
    key === "." ||
    key === "-" ||
    key === "Backspace" ||
    key === "Tab" ||
    key === "Enter" ||
    key === "Escape" ||
    /^[a-zA-Z]$/.test(key)
  );
}

function committedValues(entry: NumericTransformEntry): Record<string, number> {
  const values = { ...entry.entered };
  const parsed = parseNumericTransformValue(entry.buffer);
  if (parsed !== null) values[entry.axes[entry.activeIndex].key] = parsed;
  return values;
}

/**
 * Feeds one keystroke into the entry.
 *
 * Returns `none` for keys that mean nothing here, so the caller can let them
 * through to their normal handler instead of swallowing every keystroke during a
 * drag.
 */
export function applyKeyToNumericEntry(
  entry: NumericTransformEntry,
  key: string,
  { shiftKey = false }: { shiftKey?: boolean } = {},
): NumericTransformAction {
  if (key === "Escape") return { kind: "cancel" };
  if (key === "Enter") return { kind: "commit", values: committedValues(entry) };

  if (key === "Tab") {
    const step = shiftKey ? -1 : 1;
    const nextIndex = (entry.activeIndex + step + entry.axes.length) % entry.axes.length;
    // Tabbing away banks whatever was typed, so each axis keeps its own value.
    const entered = { ...entry.entered };
    const parsed = parseNumericTransformValue(entry.buffer);
    if (parsed !== null) entered[entry.axes[entry.activeIndex].key] = parsed;
    return { kind: "update", entry: { ...entry, activeIndex: nextIndex, buffer: "", entered } };
  }

  if (key === "Backspace") {
    if (!entry.buffer) return { kind: "none" };
    return { kind: "update", entry: { ...entry, buffer: entry.buffer.slice(0, -1) } };
  }

  if (NUMERIC_KEY.test(key) || key === "." || key === "-") {
    // A second `-` or `.` would only make the buffer unparseable.
    if (key === "-" && entry.buffer.length > 0) return { kind: "none" };
    if (key === "." && entry.buffer.includes(".")) return { kind: "none" };
    return { kind: "update", entry: { ...entry, buffer: `${entry.buffer}${key}` } };
  }

  if (/^[a-zA-Z]$/.test(key)) {
    // `x` jumps to the X axis and starts it fresh — the `X=10` habit.
    const index = axisFromPrefix(key, entry.axes);
    if (index === null) return { kind: "none" };
    const entered = { ...entry.entered };
    const parsed = parseNumericTransformValue(entry.buffer);
    if (parsed !== null) entered[entry.axes[entry.activeIndex].key] = parsed;
    return { kind: "update", entry: { ...entry, activeIndex: index, buffer: "", entered } };
  }

  return { kind: "none" };
}

/** What the overlay shows: `X 10.5 | Z —` with the active axis marked. */
export function describeNumericEntry(entry: NumericTransformEntry) {
  return entry.axes
    .map((axis, index) => {
      const isActive = index === entry.activeIndex;
      const typed = isActive ? entry.buffer : "";
      const banked = entry.entered[axis.key];
      const shown = typed || (banked !== undefined ? String(banked) : "");
      return `${axis.label} ${shown || "—"}${isActive ? "_" : ""}`;
    })
    .join("  ");
}

/** True once anything has been typed — the viewport uses this to take over the drag. */
export function numericEntryHasInput(entry: NumericTransformEntry) {
  return entry.buffer.length > 0 || Object.keys(entry.entered).length > 0;
}
