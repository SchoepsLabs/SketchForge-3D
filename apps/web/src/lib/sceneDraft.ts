import { projectShapesFingerprint } from "@/lib/editorHistory";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Crash-proofing for the working scene.
 *
 * The editor's scene is ephemeral until it is saved as a project: a reload, a
 * Fast Refresh, or a closed tab loses it (that is how the MCP-imported M3 spacer
 * vanished on 2026-08-05). This module owns the draft that survives that — what
 * gets written, when a write is worth making, and whether a draft found on load
 * is worth offering back.
 *
 * Pure: no localStorage access here, so every decision is testable in node. The
 * component supplies the storage.
 */

export const SCENE_DRAFT_STORAGE_KEY = "sketchforge.scene.draft";
export const SCENE_DRAFT_VERSION = 1;

/** Past this, writing the draft costs more than it saves (localStorage caps near 5 MB). */
export const MAX_SCENE_DRAFT_BYTES = 3_500_000;

/** A draft older than this is stale enough that offering it would be confusing. */
export const MAX_SCENE_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type SceneDraft = {
  version: number;
  savedAt: number;
  projectId: string | null;
  projectName: string;
  shapes: WorkplaneShape[];
  selectedIds: string[];
  fingerprint: string;
};

export function buildSceneDraft({
  shapes,
  selectedIds,
  projectId,
  projectName,
  now,
}: {
  shapes: WorkplaneShape[];
  selectedIds: string[];
  projectId: string | null;
  projectName: string;
  now: number;
}): SceneDraft {
  return {
    version: SCENE_DRAFT_VERSION,
    savedAt: now,
    projectId,
    projectName,
    shapes,
    selectedIds,
    fingerprint: projectShapesFingerprint(shapes),
  };
}

export type SerializedDraft = { ok: true; json: string; bytes: number } | { ok: false; reason: "too-large"; bytes: number };

/**
 * Cheap size estimate from the mesh payloads, without serialising anything.
 *
 * Measured on the 500k-triangle perf workload, `JSON.stringify` of a scene that
 * size costs ~890 ms — so checking the quota *after* stringifying would burn
 * nearly a second of the main thread on every autosave tick, only to throw the
 * result away. Each imported vertex coordinate serialises to roughly 8 chars.
 */
export function estimateSceneDraftBytes(draft: SceneDraft) {
  let chars = 512; // envelope: ids, names, selection, workspace fields
  for (const shape of draft.shapes) {
    chars += 300;
    const positions = shape.importedMesh?.positions?.length ?? 0;
    const normals = shape.importedMesh?.normals?.length ?? 0;
    chars += (positions + normals) * 8;
  }
  return chars * 2;
}

/**
 * A scene carrying big imported meshes can exceed the storage quota. Report that
 * instead of throwing inside a quota-exceeded write the user never sees — and
 * decide it from the estimate first, so an oversized scene never pays for a
 * serialisation that gets discarded.
 */
export function serializeSceneDraft(draft: SceneDraft, maxBytes = MAX_SCENE_DRAFT_BYTES): SerializedDraft {
  const estimated = estimateSceneDraftBytes(draft);
  if (estimated > maxBytes) return { ok: false, reason: "too-large", bytes: estimated };

  const json = JSON.stringify(draft);
  // UTF-16 code units in storage; the char count is the honest estimate.
  const bytes = json.length * 2;
  if (bytes > maxBytes) return { ok: false, reason: "too-large", bytes };
  return { ok: true, json, bytes };
}

function isShapeArray(value: unknown): value is WorkplaneShape[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => Boolean(entry) && typeof entry === "object" && typeof (entry as WorkplaneShape).id === "string")
  );
}

export function parseSceneDraft(raw: string | null | undefined): SceneDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SceneDraft>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== SCENE_DRAFT_VERSION) return null;
    if (typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) return null;
    if (!isShapeArray(parsed.shapes)) return null;
    return {
      version: SCENE_DRAFT_VERSION,
      savedAt: parsed.savedAt,
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : null,
      projectName: typeof parsed.projectName === "string" ? parsed.projectName : "SketchForge design",
      shapes: parsed.shapes,
      selectedIds: Array.isArray(parsed.selectedIds) ? parsed.selectedIds.filter((id): id is string => typeof id === "string") : [],
      fingerprint: typeof parsed.fingerprint === "string" ? parsed.fingerprint : projectShapesFingerprint(parsed.shapes),
    };
  } catch {
    return null;
  }
}

export type DraftRestoreDecision =
  | { offer: true; draft: SceneDraft; shapeCount: number }
  | { offer: false; reason: "no-draft" | "empty" | "stale" | "other-project" | "already-current" };

/**
 * Whether a draft found on load is worth offering back.
 *
 * The interesting case is `already-current`: the editor restored the same scene
 * from the project store, so the draft adds nothing and a "resume?" prompt would
 * just be noise. The dangerous case is the opposite — a draft with work in it
 * against an editor that came up empty — and that is exactly what gets offered.
 */
export function decideDraftRestore({
  draft,
  currentShapes,
  projectId,
  now,
  maxAgeMs = MAX_SCENE_DRAFT_AGE_MS,
}: {
  draft: SceneDraft | null;
  currentShapes: WorkplaneShape[];
  projectId: string | null;
  now: number;
  maxAgeMs?: number;
}): DraftRestoreDecision {
  if (!draft) return { offer: false, reason: "no-draft" };
  if (draft.shapes.length === 0) return { offer: false, reason: "empty" };
  if (now - draft.savedAt > maxAgeMs) return { offer: false, reason: "stale" };
  // A draft from a different saved project belongs to that project, not this one.
  if (draft.projectId && projectId && draft.projectId !== projectId) return { offer: false, reason: "other-project" };
  if (projectShapesFingerprint(currentShapes) === draft.fingerprint) return { offer: false, reason: "already-current" };
  return { offer: true, draft, shapeCount: draft.shapes.length };
}

/** "2 minutes ago" — the draft notice needs one short phrase, not a date library. */
export function describeDraftAge(savedAt: number, now: number) {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
