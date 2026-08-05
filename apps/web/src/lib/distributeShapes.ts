import { cleanNearZero } from "@/lib/workplaneShapes";

/**
 * Even spacing along one axis, the same shape of pure function as
 * `lib/placeOnPlate.ts`: the caller passes already-computed world bounds so the
 * maths is testable without the mesh pipeline.
 *
 * The rule that makes this feel right in use: the two **end** objects never
 * move. They define the span, everything between them is redistributed inside
 * it — which is what every other CAD tool does and what makes a second press a
 * no-op instead of a slow drift.
 */

export type DistributeAxis = "x" | "z";

export type DistributeBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type DistributeItem = {
  id: string;
  bounds: DistributeBounds;
  x: number;
  z: number;
  locked?: boolean;
};

export type DistributeMode =
  /** Equal gaps between neighbours, inside the span the end objects already define. */
  | { kind: "span" }
  /** Equal gaps of an exact size, growing from the first object. */
  | { kind: "gap"; gap: number };

export type DistributeMove = { id: string; x: number; z: number };

export type DistributeResult = {
  moves: DistributeMove[];
  moved: number;
  /** The gap actually applied, so the UI can report it. */
  gap: number;
  reason?: "too-few" | "locked" | "no-room" | "already-even";
};

export const DISTRIBUTE_EPSILON = 0.0005;

const NO_MOVES = (reason: DistributeResult["reason"], gap = 0): DistributeResult => ({ moves: [], moved: 0, gap, reason });

function extent(bounds: DistributeBounds, axis: DistributeAxis) {
  return axis === "x" ? { min: bounds.minX, max: bounds.maxX } : { min: bounds.minZ, max: bounds.maxZ };
}

function size(item: DistributeItem, axis: DistributeAxis) {
  const { min, max } = extent(item.bounds, axis);
  return max - min;
}

function position(item: DistributeItem, axis: DistributeAxis) {
  return axis === "x" ? item.x : item.z;
}

export function distributeShapes(
  items: DistributeItem[],
  axis: DistributeAxis,
  mode: DistributeMode = { kind: "span" },
): DistributeResult {
  // Fewer than three and there is nothing between the ends to distribute.
  if (items.length < 3) return NO_MOVES("too-few");
  if (items.every((item) => item.locked)) return NO_MOVES("locked");

  const ordered = [...items].sort((a, b) => extent(a.bounds, axis).min - extent(b.bounds, axis).min);
  const totalSize = ordered.reduce((sum, item) => sum + size(item, axis), 0);

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const gaps = ordered.length - 1;

  const gap = mode.kind === "gap"
    ? mode.gap
    : (extent(last.bounds, axis).max - extent(first.bounds, axis).min - totalSize) / gaps;

  // Negative span means the objects already overlap more than the span allows;
  // spacing them would silently pile them up, so refuse and say why.
  if (mode.kind === "span" && gap < -DISTRIBUTE_EPSILON) return NO_MOVES("no-room", gap);

  const moves: DistributeMove[] = [];
  let cursor = extent(first.bounds, axis).min;

  for (const item of ordered) {
    const itemSize = size(item, axis);
    const targetMin = cursor;
    cursor += itemSize + gap;

    // A locked shape keeps its place and still consumes its slot, so the rest
    // stay evenly spaced around it rather than shifting past it.
    if (item.locked) continue;

    const delta = targetMin - extent(item.bounds, axis).min;
    if (Math.abs(delta) <= DISTRIBUTE_EPSILON) continue;

    const nextValue = cleanNearZero(Number((position(item, axis) + delta).toFixed(4)));
    moves.push(axis === "x" ? { id: item.id, x: nextValue, z: item.z } : { id: item.id, x: item.x, z: nextValue });
  }

  if (moves.length === 0) return NO_MOVES("already-even", gap);
  return { moves, moved: moves.length, gap };
}

/** Gaps between neighbours along the axis — what a test (or the UI) checks. */
export function gapsBetween(items: DistributeItem[], axis: DistributeAxis) {
  const ordered = [...items].sort((a, b) => extent(a.bounds, axis).min - extent(b.bounds, axis).min);
  return ordered.slice(1).map((item, index) => extent(item.bounds, axis).min - extent(ordered[index].bounds, axis).max);
}
