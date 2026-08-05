import { describe, expect, it } from "vitest";
import { distributeShapes, gapsBetween, type DistributeItem } from "@/lib/distributeShapes";

/** A box centred on (x, z); `w`/`d` are its footprint along X and Z. */
function box(id: string, { x, z = 0, w = 10, d = 10, locked = false }: { x: number; z?: number; w?: number; d?: number; locked?: boolean }): DistributeItem {
  return {
    id,
    x,
    z,
    locked,
    bounds: { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 },
  };
}

/** Re-derive bounds after a move, the way the editor would on the next render. */
function applyMoves(items: DistributeItem[], moves: { id: string; x: number; z: number }[]): DistributeItem[] {
  const byId = new Map(moves.map((move) => [move.id, move]));
  return items.map((item) => {
    const move = byId.get(item.id);
    if (!move) return item;
    const w = item.bounds.maxX - item.bounds.minX;
    const d = item.bounds.maxZ - item.bounds.minZ;
    return box(item.id, { x: move.x, z: move.z, w, d, locked: item.locked });
  });
}

describe("distributeShapes along X", () => {
  it("spaces three objects of different widths with equal gaps, ends unmoved", () => {
    const items = [box("a", { x: 0, w: 10 }), box("b", { x: 18, w: 30 }), box("c", { x: 100, w: 6 })];
    const result = distributeShapes(items, "x");

    expect(result.moved).toBeGreaterThan(0);
    // The ends define the span, so neither may move.
    expect(result.moves.some((move) => move.id === "a")).toBe(false);
    expect(result.moves.some((move) => move.id === "c")).toBe(false);

    const gaps = gapsBetween(applyMoves(items, result.moves), "x");
    expect(gaps).toHaveLength(2);
    gaps.forEach((gap) => expect(Math.abs(gap - gaps[0])).toBeLessThan(1e-6));
  });

  it("handles five objects of differing widths", () => {
    const items = [
      box("a", { x: 0, w: 10 }),
      box("b", { x: 12, w: 4 }),
      box("c", { x: 30, w: 22 }),
      box("d", { x: 55, w: 8 }),
      box("e", { x: 120, w: 14 }),
    ];
    const gaps = gapsBetween(applyMoves(items, distributeShapes(items, "x").moves), "x");
    expect(gaps).toHaveLength(4);
    gaps.forEach((gap) => expect(Math.abs(gap - gaps[0])).toBeLessThan(1e-6));
  });

  it("is a no-op the second time, so pressing twice does not drift", () => {
    const items = [box("a", { x: 0 }), box("b", { x: 25 }), box("c", { x: 60 })];
    const once = applyMoves(items, distributeShapes(items, "x").moves);
    const twice = distributeShapes(once, "x");
    expect(twice.moved).toBe(0);
    expect(twice.reason).toBe("already-even");
  });

  it("does not care what order the selection arrives in", () => {
    const ordered = [box("a", { x: 0 }), box("b", { x: 25, w: 30 }), box("c", { x: 90 })];
    const shuffled = [ordered[2], ordered[0], ordered[1]];
    expect(distributeShapes(shuffled, "x").moves).toEqual(distributeShapes(ordered, "x").moves);
  });
});

describe("distributeShapes along Z", () => {
  it("spaces along Z and leaves X alone", () => {
    const items = [box("a", { x: 5, z: 0, d: 10 }), box("b", { x: 5, z: 20, d: 4 }), box("c", { x: 5, z: 80, d: 12 })];
    const result = distributeShapes(items, "z");

    expect(result.moves.every((move) => move.x === 5)).toBe(true);
    const gaps = gapsBetween(applyMoves(items, result.moves), "z");
    gaps.forEach((gap) => expect(Math.abs(gap - gaps[0])).toBeLessThan(1e-6));
  });
});

describe("explicit gap mode", () => {
  it("applies an exact gap, growing from the first object", () => {
    const items = [box("a", { x: 0, w: 10 }), box("b", { x: 40, w: 10 }), box("c", { x: 90, w: 10 })];
    const result = distributeShapes(items, "x", { kind: "gap", gap: 5 });

    const gaps = gapsBetween(applyMoves(items, result.moves), "x");
    gaps.forEach((gap) => expect(Math.abs(gap - 5)).toBeLessThan(1e-6));
    expect(result.gap).toBe(5);
  });

  it("can close the objects up with a zero gap", () => {
    const items = [box("a", { x: 0, w: 10 }), box("b", { x: 40, w: 10 }), box("c", { x: 90, w: 10 })];
    const gaps = gapsBetween(applyMoves(items, distributeShapes(items, "x", { kind: "gap", gap: 0 }).moves), "x");
    gaps.forEach((gap) => expect(Math.abs(gap)).toBeLessThan(1e-6));
  });
});

describe("refusals", () => {
  it("needs at least three objects", () => {
    expect(distributeShapes([box("a", { x: 0 }), box("b", { x: 20 })], "x")).toMatchObject({ moved: 0, reason: "too-few" });
  });

  it("says so when everything is locked", () => {
    const items = [box("a", { x: 0, locked: true }), box("b", { x: 20, locked: true }), box("c", { x: 60, locked: true })];
    expect(distributeShapes(items, "x")).toMatchObject({ moved: 0, reason: "locked" });
  });

  it("refuses rather than piling objects up when they overlap more than the span allows", () => {
    // Three 40-wide boxes inside a 50-wide span cannot be spaced.
    const items = [box("a", { x: 0, w: 40 }), box("b", { x: 5, w: 40 }), box("c", { x: 10, w: 40 })];
    expect(distributeShapes(items, "x")).toMatchObject({ moved: 0, reason: "no-room" });
  });

  it("keeps a locked shape in place and spaces the rest around its slot", () => {
    const items = [box("a", { x: 0 }), box("b", { x: 30, locked: true }), box("c", { x: 100 })];
    const result = distributeShapes(items, "x");
    expect(result.moves.some((move) => move.id === "b")).toBe(false);
  });
});
