import { cleanNearZero } from "@/lib/workplaneShapes";

/**
 * Centering a selection on the build plate is a single rigid translation, so the caller passes in
 * already-computed world bounds per shape (the editor uses its mesh AABB) and gets back the moved
 * positions. Keeping the geometry out of here keeps the maths testable without the mesh pipeline.
 */
export type PlaceOnPlateBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type PlaceOnPlateItem = {
  id: string;
  bounds: PlaceOnPlateBounds;
  x: number;
  z: number;
  elevation: number;
  locked?: boolean;
};

export type PlaceOnPlateOptions = {
  /** Also drop the selection so its lowest point rests on the plate. */
  dropToPlate?: boolean;
  /** Plate height; the build plate sits at world Y=0. */
  plateY?: number;
  /** Plate centre; the workspace grid spans -width/2..+width/2, so its centre is the world origin. */
  plateCenterX?: number;
  plateCenterZ?: number;
  epsilon?: number;
};

export type PlaceOnPlateMove = {
  id: string;
  x: number;
  z: number;
  elevation: number;
};

export type PlaceOnPlateResult = {
  moves: PlaceOnPlateMove[];
  moved: number;
  delta: { x: number; y: number; z: number };
};

export const PLACE_ON_PLATE_EPSILON = 0.0005;

const NO_MOVES: PlaceOnPlateResult = { moves: [], moved: 0, delta: { x: 0, y: 0, z: 0 } };

function unionBounds(items: PlaceOnPlateItem[]): PlaceOnPlateBounds {
  return {
    minX: Math.min(...items.map((item) => item.bounds.minX)),
    maxX: Math.max(...items.map((item) => item.bounds.maxX)),
    minY: Math.min(...items.map((item) => item.bounds.minY)),
    maxY: Math.max(...items.map((item) => item.bounds.maxY)),
    minZ: Math.min(...items.map((item) => item.bounds.minZ)),
    maxZ: Math.max(...items.map((item) => item.bounds.maxZ)),
  };
}

function roundCoordinate(value: number, epsilon: number) {
  return cleanNearZero(Number(value.toFixed(4)), epsilon);
}

/**
 * Translate the selection so its combined footprint is centred on the build plate, optionally
 * dropping it onto the plate as well.
 *
 * Locked shapes are left where they are and are excluded from the combined bounds, matching the
 * neighbouring "drop to workplane" action: what can move is what gets centred. A selection of only
 * locked shapes reports `moved: 0` rather than centring nothing.
 *
 * The whole selection shares one delta — the per-shape epsilon check that alignment uses would
 * strand a shape whose own delta rounded small and break the rigid translation, so the
 * already-in-place check is made once, on the group.
 */
export function placeSelectionOnPlate(items: PlaceOnPlateItem[], options: PlaceOnPlateOptions = {}): PlaceOnPlateResult {
  const {
    dropToPlate = false,
    plateY = 0,
    plateCenterX = 0,
    plateCenterZ = 0,
    epsilon = PLACE_ON_PLATE_EPSILON,
  } = options;

  const movable = items.filter((item) => !item.locked);
  if (movable.length === 0) {
    return NO_MOVES;
  }

  const bounds = unionBounds(movable);
  const deltaX = plateCenterX - (bounds.minX + bounds.maxX) / 2;
  const deltaZ = plateCenterZ - (bounds.minZ + bounds.maxZ) / 2;
  const deltaY = dropToPlate ? plateY - bounds.minY : 0;

  if (![deltaX, deltaY, deltaZ].every(Number.isFinite)) {
    return NO_MOVES;
  }

  if (Math.abs(deltaX) <= epsilon && Math.abs(deltaZ) <= epsilon && Math.abs(deltaY) <= epsilon) {
    return NO_MOVES;
  }

  const moves = movable.map((item) => ({
    id: item.id,
    x: roundCoordinate(item.x + deltaX, epsilon),
    z: roundCoordinate(item.z + deltaZ, epsilon),
    elevation: roundCoordinate(item.elevation + deltaY, epsilon),
  }));

  return { moves, moved: moves.length, delta: { x: deltaX, y: deltaY, z: deltaZ } };
}
