import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Placement maths for duplicate-repeat and for linear/circular arrays.
 *
 * Pure, and deliberately narrow: everything here works on the six placement
 * fields a copy can differ by, never on whole shapes, so the editor's smart
 * duplicate, the array tools, and the Block 2 MCP `pattern_objects` front end
 * can share one implementation without dragging geometry along.
 */

export type ShapePlacement = {
  x: number;
  z: number;
  elevation: number;
  rotation: number;
  rotationX: number;
  rotationZ: number;
};

export type ShapeTransformDelta = ShapePlacement;

export const IDENTITY_TRANSFORM_DELTA: ShapeTransformDelta = {
  x: 0,
  z: 0,
  elevation: 0,
  rotation: 0,
  rotationX: 0,
  rotationZ: 0,
};

/** The offset a plain duplicate has always used, before any transform is memorised. */
export const DEFAULT_DUPLICATE_DELTA: ShapeTransformDelta = { ...IDENTITY_TRANSFORM_DELTA, x: 8, z: 8 };

export const TRANSFORM_DELTA_EPSILON = 1e-4;

const PLACEMENT_DECIMALS = 4;

function round(value: number) {
  return Number(value.toFixed(PLACEMENT_DECIMALS));
}

/** Read the placement fields out of a shape, filling in the optional ones. */
export function shapePlacement(shape: Pick<WorkplaneShape, "x" | "z" | "elevation" | "rotation" | "rotationX" | "rotationZ">): ShapePlacement {
  return {
    x: shape.x,
    z: shape.z,
    elevation: shape.elevation ?? 0,
    rotation: shape.rotation ?? 0,
    rotationX: shape.rotationX ?? 0,
    rotationZ: shape.rotationZ ?? 0,
  };
}

/** What the user did to a copy after it was made — the thing Ctrl+D replays. */
export function transformDeltaBetween(before: ShapePlacement, after: ShapePlacement): ShapeTransformDelta {
  return {
    x: round(after.x - before.x),
    z: round(after.z - before.z),
    elevation: round(after.elevation - before.elevation),
    rotation: round(after.rotation - before.rotation),
    rotationX: round(after.rotationX - before.rotationX),
    rotationZ: round(after.rotationZ - before.rotationZ),
  };
}

export function isIdentityTransformDelta(delta: ShapeTransformDelta, epsilon = TRANSFORM_DELTA_EPSILON) {
  return (Object.keys(IDENTITY_TRANSFORM_DELTA) as (keyof ShapeTransformDelta)[]).every(
    (key) => Math.abs(delta[key]) <= epsilon,
  );
}

export function scaleTransformDelta(delta: ShapeTransformDelta, factor: number): ShapeTransformDelta {
  return {
    x: round(delta.x * factor),
    z: round(delta.z * factor),
    elevation: round(delta.elevation * factor),
    rotation: round(delta.rotation * factor),
    rotationX: round(delta.rotationX * factor),
    rotationZ: round(delta.rotationZ * factor),
  };
}

/** Apply a delta to a shape's placement, returning only the fields that change. */
export function applyTransformDelta(
  shape: Pick<WorkplaneShape, "x" | "z" | "elevation" | "rotation" | "rotationX" | "rotationZ">,
  delta: ShapeTransformDelta,
): ShapePlacement {
  const placement = shapePlacement(shape);
  return {
    x: round(placement.x + delta.x),
    z: round(placement.z + delta.z),
    elevation: round(placement.elevation + delta.elevation),
    rotation: round(placement.rotation + delta.rotation),
    rotationX: round(placement.rotationX + delta.rotationX),
    rotationZ: round(placement.rotationZ + delta.rotationZ),
  };
}

/**
 * What the last duplicate produced: the copies it made and, for each, the
 * placement of the shape it was copied from.
 */
export type DuplicateReplay = {
  copyIds: string[];
  sourcePlacements: Map<string, ShapePlacement>;
  delta: ShapeTransformDelta;
};

/**
 * The step the next duplicate should use, Tinkercad-style.
 *
 * The step is the copy's **total** offset from the shape it was copied from,
 * not just the transform the user added afterwards: repeating only the drag
 * would leave the third part a different distance away than the second. The
 * replay only applies while the last copies are still exactly the selection —
 * select anything else and the next duplicate is a plain one again.
 */
export function nextDuplicateStep(
  replay: DuplicateReplay | null,
  selection: { id: string; placement: ShapePlacement }[],
): { delta: ShapeTransformDelta; replaying: boolean } {
  const selectedIds = selection.map((entry) => entry.id);
  const selectionIsLastCopies =
    replay !== null && replay.copyIds.length === selectedIds.length && replay.copyIds.every((id) => selectedIds.includes(id));
  if (!replay || !selectionIsLastCopies) {
    return { delta: DEFAULT_DUPLICATE_DELTA, replaying: false };
  }

  const anchor = selection.find((entry) => replay.sourcePlacements.has(entry.id));
  const source = anchor ? replay.sourcePlacements.get(anchor.id) : undefined;
  if (!anchor || !source) {
    return { delta: DEFAULT_DUPLICATE_DELTA, replaying: false };
  }

  const stepped = transformDeltaBetween(source, anchor.placement);
  // A copy dragged back exactly onto its source has no step to repeat.
  return isIdentityTransformDelta(stepped) ? { delta: DEFAULT_DUPLICATE_DELTA, replaying: false } : { delta: stepped, replaying: true };
}

/** True when a replayed step is more than the plain duplicate's own offset. */
export function isMemorisedDuplicateStep(delta: ShapeTransformDelta) {
  return !isIdentityTransformDelta(transformDeltaBetween(DEFAULT_DUPLICATE_DELTA, delta));
}

/**
 * Placements for a linear array. `count` counts the original, so a count of 5
 * returns the 4 copies that follow it — the caller already has the original.
 */
export function linearPatternPlacements(
  source: Pick<WorkplaneShape, "x" | "z" | "elevation" | "rotation" | "rotationX" | "rotationZ">,
  { count, step }: { count: number; step: ShapeTransformDelta },
): ShapePlacement[] {
  const copies = Math.max(0, Math.floor(count) - 1);
  return Array.from({ length: copies }, (_, index) => applyTransformDelta(source, scaleTransformDelta(step, index + 1)));
}

/**
 * Placements for a circular array around (centerX, centerZ) — the bolt-circle
 * case. `count` counts the original, and copies keep their radius; with
 * `rotateCopies` they also spin to face outward the way a bolt pattern needs.
 */
export function circularPatternPlacements(
  source: Pick<WorkplaneShape, "x" | "z" | "elevation" | "rotation" | "rotationX" | "rotationZ">,
  {
    count,
    centerX,
    centerZ,
    totalAngle = 360,
    rotateCopies = true,
  }: { count: number; centerX: number; centerZ: number; totalAngle?: number; rotateCopies?: boolean },
): ShapePlacement[] {
  const copies = Math.max(0, Math.floor(count) - 1);
  if (copies === 0) return [];

  const placement = shapePlacement(source);
  const offsetX = placement.x - centerX;
  const offsetZ = placement.z - centerZ;
  // A full turn puts the last copy back on the original, so the step divides by
  // count; a partial sweep spans the arc and divides by the gaps instead.
  const isFullTurn = Math.abs(Math.abs(totalAngle) - 360) <= TRANSFORM_DELTA_EPSILON;
  const stepAngle = totalAngle / (isFullTurn ? copies + 1 : copies);

  return Array.from({ length: copies }, (_, index) => {
    const degrees = (index + 1) * stepAngle;
    const angle = (degrees * Math.PI) / 180;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    // Rotate the offset the same way `rotation` turns the shape: a positive
    // angle is a right-handed turn about +Y, matching the Euler the viewport
    // builds from shape.rotation, so a rotated copy still faces the centre.
    return {
      ...placement,
      x: round(centerX + offsetX * cos + offsetZ * sin),
      z: round(centerZ - offsetX * sin + offsetZ * cos),
      rotation: round(placement.rotation + (rotateCopies ? degrees : 0)),
    };
  });
}
