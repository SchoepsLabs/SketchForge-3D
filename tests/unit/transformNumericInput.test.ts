import { describe, expect, it } from "vitest";
import {
  applyKeyToNumericEntry,
  axisFromPrefix,
  createNumericTransformEntry,
  describeNumericEntry,
  isNumericTransformKey,
  numericEntryHasInput,
  parseNumericTransformValue,
  type NumericTransformEntry,
} from "@/lib/transformNumericInput";

const AXES = [
  { key: "x", label: "X", value: 0 },
  { key: "z", label: "Z", value: 0 },
];

/** Types a string of keys in order, returning the resulting entry (or the action). */
function type(keys: string[], start: NumericTransformEntry = createNumericTransformEntry(AXES)) {
  let entry = start;
  let last: ReturnType<typeof applyKeyToNumericEntry> = { kind: "none" };
  for (const key of keys) {
    last = applyKeyToNumericEntry(entry, key, { shiftKey: key === "ShiftTab" });
    if (last.kind === "update") entry = last.entry;
  }
  return { entry, last };
}

describe("parseNumericTransformValue", () => {
  it("reads plain, negative and decimal values", () => {
    expect(parseNumericTransformValue("10")).toBe(10);
    expect(parseNumericTransformValue("-4.5")).toBe(-4.5);
    expect(parseNumericTransformValue(".5")).toBe(0.5);
    expect(parseNumericTransformValue("12.")).toBe(12);
    expect(parseNumericTransformValue("  7 ")).toBe(7);
  });

  it("reads the X=10 form people type out of habit", () => {
    expect(parseNumericTransformValue("X=10")).toBe(10);
    expect(parseNumericTransformValue("x = -3.5")).toBe(-3.5);
    expect(parseNumericTransformValue("z10")).toBe(10);
  });

  it("returns null for anything half-typed or nonsense", () => {
    expect(parseNumericTransformValue("")).toBeNull();
    expect(parseNumericTransformValue("-")).toBeNull();
    expect(parseNumericTransformValue(".")).toBeNull();
    expect(parseNumericTransformValue("1.2.3")).toBeNull();
    expect(parseNumericTransformValue("12px")).toBeNull();
    expect(parseNumericTransformValue("NaN")).toBeNull();
  });
});

describe("axisFromPrefix", () => {
  it("finds the named axis, case-insensitively", () => {
    expect(axisFromPrefix("X=10", AXES)).toBe(0);
    expect(axisFromPrefix("z 4", AXES)).toBe(1);
  });

  it("is null without a prefix or for an unknown axis", () => {
    expect(axisFromPrefix("10", AXES)).toBeNull();
    expect(axisFromPrefix("q=1", AXES)).toBeNull();
  });
});

describe("typing a value", () => {
  it("builds a number from keystrokes", () => {
    expect(type(["1", "0"]).entry.buffer).toBe("10");
    expect(type(["-", "4", ".", "5"]).entry.buffer).toBe("-4.5");
  });

  it("ignores a second minus or decimal point", () => {
    expect(type(["1", "-"]).entry.buffer).toBe("1");
    expect(type(["1", ".", "5", "."]).entry.buffer).toBe("1.5");
  });

  it("corrects with backspace, and ignores it on an empty buffer", () => {
    expect(type(["1", "2", "Backspace"]).entry.buffer).toBe("1");
    expect(applyKeyToNumericEntry(createNumericTransformEntry(AXES), "Backspace").kind).toBe("none");
  });

  it("leaves keys it does not own alone, so a drag's other shortcuts still work", () => {
    expect(applyKeyToNumericEntry(createNumericTransformEntry(AXES), "F5").kind).toBe("none");
    expect(applyKeyToNumericEntry(createNumericTransformEntry(AXES), "ArrowLeft").kind).toBe("none");
  });
});

describe("Tab between axes", () => {
  it("banks the typed value and moves on", () => {
    const { entry } = type(["1", "0", "Tab"]);
    expect(entry.entered).toEqual({ x: 10 });
    expect(entry.activeIndex).toBe(1);
    expect(entry.buffer).toBe("");
  });

  it("wraps around, and Shift+Tab goes back", () => {
    expect(type(["Tab", "Tab"]).entry.activeIndex).toBe(0);
    const back = applyKeyToNumericEntry({ ...createNumericTransformEntry(AXES), activeIndex: 0 }, "Tab", { shiftKey: true });
    expect(back.kind === "update" && back.entry.activeIndex).toBe(1);
  });

  it("keeps each axis's own value across tabs", () => {
    const { entry } = type(["1", "0", "Tab", "2", "5"]);
    expect(entry.entered).toEqual({ x: 10 });
    expect(entry.buffer).toBe("25");
  });

  it("does not bank a half-typed value", () => {
    expect(type(["-", "Tab"]).entry.entered).toEqual({});
  });
});

describe("committing and cancelling", () => {
  it("Enter commits every axis that got a value", () => {
    const { last } = type(["1", "0", "Tab", "2", "5", "Enter"]);
    expect(last).toEqual({ kind: "commit", values: { x: 10, z: 25 } });
  });

  it("commits a single axis without tabbing", () => {
    const { last } = type(["3", "0", "Enter"]);
    expect(last).toEqual({ kind: "commit", values: { x: 30 } });
  });

  it("Esc cancels, so the caller can restore the pre-edit transform", () => {
    expect(type(["1", "0", "Escape"]).last).toEqual({ kind: "cancel" });
    // Even with nothing typed, Esc means cancel the whole entry.
    expect(applyKeyToNumericEntry(createNumericTransformEntry(AXES), "Escape")).toEqual({ kind: "cancel" });
  });

  it("commits nothing when nothing parseable was typed", () => {
    const { last } = type(["-", "Enter"]);
    expect(last).toEqual({ kind: "commit", values: {} });
  });
});

describe("axis letters jump directly", () => {
  it("`z` switches to Z and starts it fresh, banking what came before", () => {
    const { entry } = type(["1", "0", "z"]);
    expect(entry.activeIndex).toBe(1);
    expect(entry.entered).toEqual({ x: 10 });
    expect(entry.buffer).toBe("");
  });

  it("ignores a letter that names no axis", () => {
    expect(applyKeyToNumericEntry(createNumericTransformEntry(AXES), "q").kind).toBe("none");
  });
});

describe("overlay text and takeover", () => {
  it("marks the active axis and shows banked values", () => {
    const { entry } = type(["1", "0", "Tab", "2"]);
    expect(describeNumericEntry(entry)).toBe("X 10  Z 2_");
  });

  it("shows placeholders before anything is typed", () => {
    expect(describeNumericEntry(createNumericTransformEntry(AXES))).toBe("X —_  Z —");
  });

  it("reports whether the drag should hand over to typed values", () => {
    expect(numericEntryHasInput(createNumericTransformEntry(AXES))).toBe(false);
    expect(numericEntryHasInput(type(["5"]).entry)).toBe(true);
    expect(numericEntryHasInput(type(["5", "Tab"]).entry)).toBe(true);
  });
});

describe("isNumericTransformKey", () => {
  it("claims the keys entry needs and no others", () => {
    ["0", "9", ".", "-", "Backspace", "Tab", "Enter", "Escape", "x"].forEach((key) => expect(isNumericTransformKey(key)).toBe(true));
    ["ArrowUp", "F5", "Shift", "Control", "PageDown"].forEach((key) => expect(isNumericTransformKey(key)).toBe(false));
  });
});
