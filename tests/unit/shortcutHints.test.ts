import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatShortcutKeys, isMacPlatform, toolbarTooltip, SHORTCUT_HINTS, type ShortcutHintId } from "@/lib/shortcutHints";

const shortcutsDoc = readFileSync(path.resolve(__dirname, "../../docs/SHORTCUTS.md"), "utf8");

describe("toolbarTooltip", () => {
  it("appends the bound key to the label", () => {
    expect(toolbarTooltip("Duplicate", "duplicate")).toBe("Duplicate (Ctrl+D)");
    expect(toolbarTooltip("Group", "group")).toBe("Group (Ctrl+G)");
  });

  it("leaves an unbound action's tooltip alone", () => {
    // Chamfer and Fillet have no key: F resets the view, and Shift+F is spoken
    // for by the fit-to-selection task.
    expect(toolbarTooltip("Fillet")).toBe("Fillet");
    expect(toolbarTooltip("Split parts", null)).toBe("Split parts");
  });

  it("uses mac glyphs on mac", () => {
    expect(toolbarTooltip("Redo", "redo", { mac: true })).toBe("Redo (⌘⇧Z)");
    expect(toolbarTooltip("Delete", "delete", { mac: true })).toBe("Delete (⌫)");
  });
});

describe("formatShortcutKeys", () => {
  it("passes keys through unchanged off mac", () => {
    expect(formatShortcutKeys("Ctrl+Shift+G")).toBe("Ctrl+Shift+G");
  });

  it("recognises the mac platform strings", () => {
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("iPhone")).toBe(true);
    expect(isMacPlatform("Win32")).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});

describe("docs/SHORTCUTS.md stays in step with the table", () => {
  it("documents every key the toolbar advertises", () => {
    const missing = (Object.entries(SHORTCUT_HINTS) as [ShortcutHintId, string][])
      .filter(([, keys]) => !shortcutsDoc.includes(`\`${keys}\``))
      .map(([id, keys]) => `${id} (${keys})`);
    expect(missing).toEqual([]);
  });

  it("advertises keys in the doc's own notation, so the two read alike", () => {
    // The doc writes Ctrl for Ctrl-or-Cmd and spells modifiers with '+'.
    Object.values(SHORTCUT_HINTS).forEach((keys) => {
      expect(keys).not.toMatch(/cmd|meta|⌘/i);
      expect(keys).not.toMatch(/\s/);
    });
  });
});
