import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  clampDesignProfile,
  loadDesignProfile,
  resolveDesignProfilePath,
  DEFAULT_DESIGN_PROFILE_RELATIVE_PATH,
  MAX_DESIGN_PROFILE_CHARS,
} from "@/lib/assistantDesignProfile";
import { buildAssistantSystemPrompt } from "@/lib/assistantSystemPrompt";

const scratch = mkdtempSync(path.join(tmpdir(), "sketchforge-profile-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("resolveDesignProfilePath", () => {
  it("defaults to the doc that ships with the repo", () => {
    expect(resolveDesignProfilePath({ cwd: "/repo" })).toBe(path.resolve("/repo", DEFAULT_DESIGN_PROFILE_RELATIVE_PATH));
  });

  it("honours an explicit path so the profile can live outside the repo", () => {
    expect(resolveDesignProfilePath({ cwd: "/repo", configuredPath: "/shop/profile.md" })).toBe(path.resolve("/shop/profile.md"));
    expect(resolveDesignProfilePath({ cwd: "/repo", configuredPath: "   " })).toBe(path.resolve("/repo", DEFAULT_DESIGN_PROFILE_RELATIVE_PATH));
  });
});

describe("clampDesignProfile", () => {
  it("keeps a normal profile intact", () => {
    expect(clampDesignProfile("  walls 1.24 min  ")).toBe("walls 1.24 min");
  });

  it("treats an empty profile as absent", () => {
    expect(clampDesignProfile("   \n  ")).toBeNull();
  });

  it("truncates a runaway profile instead of crowding out the scene summary", () => {
    const clamped = clampDesignProfile("x".repeat(MAX_DESIGN_PROFILE_CHARS + 500));
    expect(clamped).toContain("[profile truncated at");
    expect(clamped!.length).toBeLessThan(MAX_DESIGN_PROFILE_CHARS + 100);
  });
});

describe("loadDesignProfile", () => {
  it("reads the profile from the default location", () => {
    const cwd = path.join(scratch, "repo");
    mkdirSync(path.join(cwd, "docs", "assistant"), { recursive: true });
    writeFileSync(path.join(cwd, DEFAULT_DESIGN_PROFILE_RELATIVE_PATH), "# Profile\nWalls in multiples of 0.62 mm.\n", "utf8");
    expect(loadDesignProfile({ cwd, configuredPath: null })).toContain("0.62");
  });

  it("returns null when there is no profile, rather than failing the turn", () => {
    expect(loadDesignProfile({ cwd: path.join(scratch, "empty"), configuredPath: null })).toBeNull();
  });

  it("picks up the real repo profile", () => {
    // The shipped doc is what the acceptance case depends on; if it moves or is
    // emptied, the dock silently loses the shop rules and this catches it.
    const profile = loadDesignProfile({ cwd: path.resolve(__dirname, "../.."), configuredPath: null });
    expect(profile).toBeTruthy();
    expect(profile).toMatch(/0\.62|1\.24/);
  });
});

describe("system prompt with the profile", () => {
  it("carries the shop rules and puts them before the scene", () => {
    const prompt = buildAssistantSystemPrompt({
      editorNumber: 1,
      designProfile: "Add +0.2 mm to every hole diameter.",
      sceneContext: "2 objects on the plate",
    });
    expect(prompt).toContain("+0.2 mm to every hole diameter");
    expect(prompt).toContain("Shop profile");
    // Standing constraints first, current state last.
    expect(prompt.indexOf("Shop profile")).toBeLessThan(prompt.indexOf("Current scene"));
  });

  it("says to ask rather than guess a measured dimension", () => {
    expect(buildAssistantSystemPrompt({ designProfile: "x" })).toContain("ask for a measured");
  });

  it("leaves the section out entirely when there is no profile", () => {
    expect(buildAssistantSystemPrompt({ editorNumber: 1 })).not.toContain("Shop profile");
    expect(buildAssistantSystemPrompt({ editorNumber: 1, designProfile: "  " })).not.toContain("Shop profile");
  });
});
