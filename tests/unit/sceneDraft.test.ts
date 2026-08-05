import { describe, expect, it } from "vitest";
import { projectShapesFingerprint } from "@/lib/editorHistory";
import {
  buildSceneDraft,
  decideDraftRestore,
  describeDraftAge,
  parseSceneDraft,
  serializeSceneDraft,
  MAX_SCENE_DRAFT_AGE_MS,
  SCENE_DRAFT_VERSION,
} from "@/lib/sceneDraft";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "box-1",
    name: "Box",
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

const NOW = 1_785_000_000_000;

function draftOf(shapes: WorkplaneShape[], overrides: { now?: number; projectId?: string | null } = {}) {
  return buildSceneDraft({
    shapes,
    selectedIds: shapes.slice(0, 1).map((s) => s.id),
    projectId: overrides.projectId ?? null,
    projectName: "SketchForge design",
    now: overrides.now ?? NOW,
  });
}

describe("draft round trip", () => {
  it("survives serialize → parse with its shapes and selection", () => {
    const draft = draftOf([box(), box({ id: "box-2", x: 40 })]);
    const serialized = serializeSceneDraft(draft);
    expect(serialized.ok).toBe(true);
    const parsed = parseSceneDraft(serialized.ok ? serialized.json : null);
    expect(parsed?.shapes).toHaveLength(2);
    expect(parsed?.selectedIds).toEqual(["box-1"]);
    expect(parsed?.fingerprint).toBe(projectShapesFingerprint(draft.shapes));
  });

  it("refuses to write a draft too big for the storage quota", () => {
    // An imported mesh is the realistic way to blow the quota.
    const huge = box({ kind: "mesh", importedMesh: { positions: new Array(400_000).fill(1.234567), baseWidth: 1, baseDepth: 1, baseHeight: 1, triangleCount: 1, sourceFormat: "stl" } } as Partial<WorkplaneShape>);
    const result = serializeSceneDraft(draftOf([huge]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-large");
  });

  it("rejects junk rather than restoring a broken scene", () => {
    expect(parseSceneDraft(null)).toBeNull();
    expect(parseSceneDraft("not json")).toBeNull();
    expect(parseSceneDraft(JSON.stringify({ version: 999, savedAt: NOW, shapes: [] }))).toBeNull();
    expect(parseSceneDraft(JSON.stringify({ version: SCENE_DRAFT_VERSION, savedAt: NOW, shapes: [{ noId: true }] }))).toBeNull();
    expect(parseSceneDraft(JSON.stringify({ version: SCENE_DRAFT_VERSION, shapes: [] }))).toBeNull();
  });

  it("recomputes a missing fingerprint instead of discarding the draft", () => {
    const parsed = parseSceneDraft(JSON.stringify({ version: SCENE_DRAFT_VERSION, savedAt: NOW, shapes: [box()] }));
    expect(parsed?.fingerprint).toBe(projectShapesFingerprint([box()]));
  });
});

describe("decideDraftRestore", () => {
  it("offers a draft with work in it when the editor came up empty — the crash case", () => {
    const decision = decideDraftRestore({ draft: draftOf([box(), box({ id: "box-2" })]), currentShapes: [], projectId: null, now: NOW + 5000 });
    expect(decision).toMatchObject({ offer: true, shapeCount: 2 });
  });

  it("stays quiet when the editor already has the same scene", () => {
    const shapes = [box()];
    const decision = decideDraftRestore({ draft: draftOf(shapes), currentShapes: shapes, projectId: null, now: NOW + 5000 });
    expect(decision).toEqual({ offer: false, reason: "already-current" });
  });

  it("offers when the scene differs, even if the editor is not empty", () => {
    const decision = decideDraftRestore({ draft: draftOf([box(), box({ id: "box-2" })]), currentShapes: [box()], projectId: null, now: NOW });
    expect(decision.offer).toBe(true);
  });

  it("ignores an empty, missing, or stale draft", () => {
    expect(decideDraftRestore({ draft: null, currentShapes: [], projectId: null, now: NOW })).toEqual({ offer: false, reason: "no-draft" });
    expect(decideDraftRestore({ draft: draftOf([]), currentShapes: [], projectId: null, now: NOW })).toEqual({ offer: false, reason: "empty" });
    expect(
      decideDraftRestore({ draft: draftOf([box()]), currentShapes: [], projectId: null, now: NOW + MAX_SCENE_DRAFT_AGE_MS + 1 }),
    ).toEqual({ offer: false, reason: "stale" });
  });

  it("does not offer another project's draft", () => {
    expect(
      decideDraftRestore({ draft: draftOf([box()], { projectId: "project-a" }), currentShapes: [], projectId: "project-b", now: NOW }),
    ).toEqual({ offer: false, reason: "other-project" });
  });

  it("offers an unsaved-scene draft into any project, since it belongs to no project", () => {
    // projectId null is the scratch scene — exactly the case that keeps getting lost.
    expect(decideDraftRestore({ draft: draftOf([box()]), currentShapes: [], projectId: "project-b", now: NOW }).offer).toBe(true);
  });
});

describe("describeDraftAge", () => {
  it("reads like a person wrote it", () => {
    expect(describeDraftAge(NOW, NOW + 5_000)).toBe("just now");
    expect(describeDraftAge(NOW, NOW + 120_000)).toBe("2 minutes ago");
    expect(describeDraftAge(NOW, NOW + 60_000)).toBe("1 minute ago");
    expect(describeDraftAge(NOW, NOW + 3 * 3_600_000)).toBe("3 hours ago");
    expect(describeDraftAge(NOW, NOW + 2 * 86_400_000)).toBe("2 days ago");
  });

  it("never reports a negative age from a clock skew", () => {
    expect(describeDraftAge(NOW + 10_000, NOW)).toBe("just now");
  });
});
