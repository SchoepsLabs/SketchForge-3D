import { describe, expect, it } from "vitest";
import {
  classifySharedSaveFailure,
  overwritePrompt,
  sharedProjectFileName,
  sharedSaveHeaders,
  SharedProjectSaveError,
} from "@/lib/sharedProjectSave";

describe("sharedProjectFileName", () => {
  it("adds the extension exactly once", () => {
    expect(sharedProjectFileName("bracket")).toBe("bracket.skf");
    expect(sharedProjectFileName("bracket.skf")).toBe("bracket.skf");
    expect(sharedProjectFileName("  spacer  ")).toBe("spacer.skf");
  });

  it("falls back when the name is empty", () => {
    expect(sharedProjectFileName("", "My project")).toBe("My project.skf");
  });
});

describe("sharedSaveHeaders", () => {
  it("asks the server to refuse an existing file on a first save", () => {
    expect(sharedSaveHeaders({ kind: "create" })["If-None-Match"]).toBe("*");
  });

  it("pins the revision when replacing, so a lost update is impossible", () => {
    expect(sharedSaveHeaders({ kind: "replace", revision: "abc-123" })["If-Match"]).toBe('"abc-123"');
  });
});

describe("classifySharedSaveFailure", () => {
  it("separates a taken name (a question) from a stale revision (a conflict)", () => {
    const taken = classifySharedSaveFailure(409, { error: 'A shared project named "bracket" already exists.', reason: "name-taken", currentRevision: "r1" });
    expect(taken).toMatchObject({ kind: "name-taken", overwritable: true, currentRevision: "r1" });

    const stale = classifySharedSaveFailure(409, { error: "changed after you opened it", reason: "stale-revision", currentRevision: "r2" });
    expect(stale).toMatchObject({ kind: "stale-revision", overwritable: false });
  });

  it("never offers an overwrite without a revision to overwrite", () => {
    expect(classifySharedSaveFailure(409, { reason: "name-taken", currentRevision: null }).overwritable).toBe(false);
  });

  it("gives an actionable message when shared storage is switched off", () => {
    const failure = classifySharedSaveFailure(404, { error: "Shared project storage is disabled" });
    expect(failure.kind).toBe("disabled");
    expect(failure.message).toContain("SKETCHFORGE_SHARED_PROJECTS_DIR");
    expect(failure.message).toContain("restart");
  });

  it("recognises the lock and missing cases", () => {
    expect(classifySharedSaveFailure(409, { reason: "locked" }).kind).toBe("locked");
    expect(classifySharedSaveFailure(409, { reason: "missing" }).kind).toBe("missing");
  });

  it("falls back to the prose an older server sends", () => {
    // Same route before the `reason` field existed.
    expect(classifySharedSaveFailure(409, { error: "This shared project is currently being saved by someone else" }).kind).toBe("locked");
    expect(classifySharedSaveFailure(409, { error: "The shared project no longer exists. Save it under a different name." }).kind).toBe("missing");
    expect(classifySharedSaveFailure(409, { error: "The shared project changed after you opened it." }).kind).toBe("stale-revision");
  });

  it("handles size limits and unknown failures", () => {
    expect(classifySharedSaveFailure(413, { error: ".skf file exceeds the shared storage size limit" }).kind).toBe("too-large");
    expect(classifySharedSaveFailure(500, null)).toMatchObject({ kind: "other", overwritable: false });
    expect(classifySharedSaveFailure(500, null).message).toContain("500");
  });
});

describe("SharedProjectSaveError", () => {
  it("carries the classification through to the editor", () => {
    const failure = classifySharedSaveFailure(409, { reason: "name-taken", currentRevision: "r1", error: "exists" });
    const error = new SharedProjectSaveError(failure, "bracket.skf");
    expect(error).toBeInstanceOf(Error);
    expect(error.failure.overwritable).toBe(true);
    expect(error.fileName).toBe("bracket.skf");
    expect(error.message).toBe("exists");
  });
});

describe("overwritePrompt", () => {
  it("names the part without its extension", () => {
    expect(overwritePrompt("bracket.skf")).toBe("bracket already exists in the shared library. Overwrite it?");
  });
});
