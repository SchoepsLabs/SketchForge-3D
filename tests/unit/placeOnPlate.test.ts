import { describe, expect, it } from "vitest";
import { PLACE_ON_PLATE_EPSILON, placeSelectionOnPlate, type PlaceOnPlateItem } from "@/lib/placeOnPlate";

/**
 * Box helper: an axis-aligned shape whose centre is (x, z), sitting `elevation` above the plate.
 * Mirrors what the editor's mesh AABB produces for an unrotated primitive.
 */
function box(
  id: string,
  { x, z, elevation = 0, width = 10, depth = 10, height = 10, locked = false }: {
    x: number;
    z: number;
    elevation?: number;
    width?: number;
    depth?: number;
    height?: number;
    locked?: boolean;
  },
): PlaceOnPlateItem {
  return {
    id,
    x,
    z,
    elevation,
    locked,
    bounds: {
      minX: x - width / 2,
      maxX: x + width / 2,
      minY: elevation,
      maxY: elevation + height,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
    },
  };
}

function movedCenter(items: PlaceOnPlateItem[], moves: { id: string; x: number; z: number; elevation: number }[]) {
  const byId = new Map(moves.map((move) => [move.id, move]));
  const placed = items.map((item) => {
    const move = byId.get(item.id) ?? { x: item.x, z: item.z, elevation: item.elevation };
    const deltaX = move.x - item.x;
    const deltaZ = move.z - item.z;
    const deltaY = move.elevation - item.elevation;
    return {
      minX: item.bounds.minX + deltaX,
      maxX: item.bounds.maxX + deltaX,
      minY: item.bounds.minY + deltaY,
      minZ: item.bounds.minZ + deltaZ,
      maxZ: item.bounds.maxZ + deltaZ,
    };
  });
  return {
    x: (Math.min(...placed.map((p) => p.minX)) + Math.max(...placed.map((p) => p.maxX))) / 2,
    z: (Math.min(...placed.map((p) => p.minZ)) + Math.max(...placed.map((p) => p.maxZ))) / 2,
    minY: Math.min(...placed.map((p) => p.minY)),
  };
}

describe("placeSelectionOnPlate", () => {
  it("centres a single shape on the plate origin", () => {
    const items = [box("a", { x: 60, z: -25 })];
    const result = placeSelectionOnPlate(items);

    expect(result.moved).toBe(1);
    expect(result.moves).toEqual([{ id: "a", x: 0, z: 0, elevation: 0 }]);
  });

  it("centres an off-centre imported mesh whose footprint is not symmetric about its origin", () => {
    // Imported meshes keep their authored offset: the shape origin is at (0, 0) but the mesh spans
    // 100..140 in X, so centring must use the bounds, not the shape position.
    const item: PlaceOnPlateItem = {
      id: "stl",
      x: 0,
      z: 0,
      elevation: 0,
      bounds: { minX: 100, maxX: 140, minY: 0, maxY: 8, minZ: -30, maxZ: 10 },
    };
    const result = placeSelectionOnPlate([item]);

    expect(result.moves).toEqual([{ id: "stl", x: -120, z: 10, elevation: 0 }]);
    expect(movedCenter([item], result.moves)).toMatchObject({ x: 0, z: 0 });
  });

  it("leaves the elevation alone unless asked to drop", () => {
    const items = [box("a", { x: 30, z: 30, elevation: 12 })];

    expect(placeSelectionOnPlate(items).moves[0].elevation).toBe(12);
    expect(placeSelectionOnPlate(items, { dropToPlate: true }).moves[0].elevation).toBe(0);
  });

  it("drops the selection as a unit so only the lowest shape lands on the plate", () => {
    const items = [
      box("low", { x: 0, z: 0, elevation: 15 }),
      box("high", { x: 20, z: 0, elevation: 40 }),
    ];
    const result = placeSelectionOnPlate(items, { dropToPlate: true });

    expect(result.moves.map((move) => move.elevation)).toEqual([0, 25]);
    expect(movedCenter(items, result.moves).minY).toBe(0);
  });

  it("moves a multi-selection rigidly: combined centre lands on the origin, spacing is unchanged", () => {
    const items = [
      box("wide", { x: 100, z: 40, width: 40, depth: 10 }),
      box("narrow", { x: 130, z: 40, width: 6, depth: 10 }),
      box("tall", { x: 145, z: 70, width: 20, depth: 30 }),
    ];
    const result = placeSelectionOnPlate(items);
    const byId = new Map(result.moves.map((move) => [move.id, move]));

    expect(result.moved).toBe(3);
    const centre = movedCenter(items, result.moves);
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.z).toBeCloseTo(0, 6);

    // Rigid translation: every pairwise offset survives.
    expect(byId.get("narrow")!.x - byId.get("wide")!.x).toBeCloseTo(30, 6);
    expect(byId.get("tall")!.x - byId.get("narrow")!.x).toBeCloseTo(15, 6);
    expect(byId.get("tall")!.z - byId.get("wide")!.z).toBeCloseTo(30, 6);
  });

  it("centres only what can move and never touches a locked shape", () => {
    const items = [
      box("plate", { x: 0, z: 0, width: 80, depth: 80, locked: true }),
      box("boss-a", { x: 100, z: 20 }),
      box("boss-b", { x: 120, z: 20 }),
    ];
    const result = placeSelectionOnPlate(items);

    expect(result.moves.map((move) => move.id)).toEqual(["boss-a", "boss-b"]);
    // Combined bounds of the movable pair span 95..125 in X, centre 110, so both shift by -110.
    expect(result.moves).toEqual([
      { id: "boss-a", x: -10, z: 0, elevation: 0 },
      { id: "boss-b", x: 10, z: 0, elevation: 0 },
    ]);
  });

  it("reports nothing to do when every selected shape is locked", () => {
    const result = placeSelectionOnPlate([
      box("a", { x: 50, z: 50, locked: true }),
      box("b", { x: 70, z: 50, locked: true }),
    ]);

    expect(result).toEqual({ moves: [], moved: 0, delta: { x: 0, y: 0, z: 0 } });
  });

  it("reports nothing to do for an empty selection", () => {
    expect(placeSelectionOnPlate([]).moved).toBe(0);
  });

  it("reports nothing to do when the selection is already centred", () => {
    const items = [
      box("a", { x: -20, z: 0 }),
      box("b", { x: 20, z: 0 }),
    ];

    expect(placeSelectionOnPlate(items).moved).toBe(0);
    // ...but a drop is still work to do when the same selection floats.
    const floating = items.map((item) => box(item.id, { x: item.x, z: item.z, elevation: 5 }));
    expect(placeSelectionOnPlate(floating, { dropToPlate: true }).moved).toBe(2);
  });

  it("treats a sub-epsilon offset as already centred rather than emitting a no-op move", () => {
    const nudge = PLACE_ON_PLATE_EPSILON / 2;

    expect(placeSelectionOnPlate([box("a", { x: nudge, z: -nudge })]).moved).toBe(0);
    expect(placeSelectionOnPlate([box("a", { x: 0.01, z: 0 })]).moved).toBe(1);
  });

  it("keeps the whole group moving when one shape's own delta would round away", () => {
    // "narrow" is already at the plate centre; a per-shape epsilon check would strand it there
    // while its neighbour moved, shearing the selection apart.
    const items = [
      box("narrow", { x: 0, z: 0, width: 4, depth: 4 }),
      box("wide", { x: 40, z: 0, width: 4, depth: 4 }),
    ];
    const result = placeSelectionOnPlate(items);

    expect(result.moves).toEqual([
      { id: "narrow", x: -20, z: 0, elevation: 0 },
      { id: "wide", x: 20, z: 0, elevation: 0 },
    ]);
  });

  it("honours a non-default plate centre and height", () => {
    const items = [box("a", { x: 0, z: 0, elevation: 0 })];
    const result = placeSelectionOnPlate(items, { dropToPlate: true, plateCenterX: 15, plateCenterZ: -5, plateY: 3 });

    expect(result.moves).toEqual([{ id: "a", x: 15, z: -5, elevation: 3 }]);
  });

  it("snaps coordinates that land a hair off zero and rounds to 4 decimals", () => {
    const items = [box("a", { x: 1 / 3, z: 10.000_012_3, width: 7, depth: 7 })];
    const result = placeSelectionOnPlate(items);

    expect(result.moves).toEqual([{ id: "a", x: 0, z: 0, elevation: 0 }]);

    const pair = [
      box("a", { x: 0, z: 0, width: 1 / 3, depth: 1 }),
      box("b", { x: 10.123_456_7, z: 0, width: 1 / 3, depth: 1 }),
    ];
    const rounded = placeSelectionOnPlate(pair);
    expect(rounded.moves.map((move) => move.x)).toEqual([-5.0617, 5.0617]);
  });

  it("refuses to emit non-finite positions when a shape carries broken bounds", () => {
    const broken: PlaceOnPlateItem = {
      id: "bad",
      x: 0,
      z: 0,
      elevation: 0,
      bounds: { minX: Number.NaN, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 },
    };

    expect(placeSelectionOnPlate([broken]).moved).toBe(0);
  });
});
