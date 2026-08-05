import { describe, expect, it } from "vitest";
import {
  applyTransformDelta,
  circularPatternPlacements,
  isIdentityTransformDelta,
  isMemorisedDuplicateStep,
  linearPatternPlacements,
  nextDuplicateStep,
  scaleTransformDelta,
  shapePlacement,
  transformDeltaBetween,
  DEFAULT_DUPLICATE_DELTA,
  IDENTITY_TRANSFORM_DELTA,
  type DuplicateReplay,
  type ShapePlacement,
} from "@/lib/patternShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

function shape(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
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

function placement(overrides: Partial<ShapePlacement> = {}): ShapePlacement {
  return { x: 0, z: 0, elevation: 0, rotation: 0, rotationX: 0, rotationZ: 0, ...overrides };
}

describe("shapePlacement", () => {
  it("fills in the optional placement fields", () => {
    expect(shapePlacement(shape())).toEqual(placement());
    expect(shapePlacement(shape({ x: 5, elevation: 2, rotationZ: 90 }))).toEqual(placement({ x: 5, elevation: 2, rotationZ: 90 }));
  });
});

describe("transformDeltaBetween", () => {
  it("measures what the user did to a copy", () => {
    const delta = transformDeltaBetween(placement({ x: 8, z: 8 }), placement({ x: 38, z: 8, elevation: 5, rotation: 15 }));
    expect(delta).toEqual({ x: 30, z: 0, elevation: 5, rotation: 15, rotationX: 0, rotationZ: 0 });
  });

  it("is identity when nothing moved", () => {
    expect(isIdentityTransformDelta(transformDeltaBetween(placement({ x: 3 }), placement({ x: 3 })))).toBe(true);
    expect(isIdentityTransformDelta(IDENTITY_TRANSFORM_DELTA)).toBe(true);
  });

  it("treats float noise as no movement, but a real nudge as movement", () => {
    expect(isIdentityTransformDelta(transformDeltaBetween(placement(), placement({ x: 1e-9 })))).toBe(true);
    expect(isIdentityTransformDelta(transformDeltaBetween(placement(), placement({ x: 0.01 })))).toBe(false);
  });

  it("rounds away accumulated float error", () => {
    expect(transformDeltaBetween(placement({ x: 0.1 }), placement({ x: 0.3 })).x).toBe(0.2);
  });
});

describe("applyTransformDelta", () => {
  it("adds the delta to every placement field", () => {
    expect(applyTransformDelta(shape({ x: 10, z: -4, elevation: 1, rotation: 30 }), { x: 5, z: 5, elevation: 2, rotation: 15, rotationX: 0, rotationZ: 0 })).toEqual(
      placement({ x: 15, z: 1, elevation: 3, rotation: 45 }),
    );
  });

  it("leaves a shape alone under the identity delta", () => {
    expect(applyTransformDelta(shape({ x: 7, z: 3 }), IDENTITY_TRANSFORM_DELTA)).toEqual(placement({ x: 7, z: 3 }));
  });

  it("keeps the historical plain-duplicate offset", () => {
    expect(applyTransformDelta(shape(), DEFAULT_DUPLICATE_DELTA)).toEqual(placement({ x: 8, z: 8 }));
  });
});

describe("scaleTransformDelta", () => {
  it("multiplies every component", () => {
    expect(scaleTransformDelta({ x: 30, z: 0, elevation: 2, rotation: 15, rotationX: 0, rotationZ: 0 }, 3)).toEqual({
      x: 90,
      z: 0,
      elevation: 6,
      rotation: 45,
      rotationX: 0,
      rotationZ: 0,
    });
  });
});

describe("nextDuplicateStep (Ctrl+D replay)", () => {
  /**
   * Drives the editor's duplicate loop against the pure step function: each
   * press copies the current selection, applies the step, and the copies become
   * the new selection — exactly what `duplicateSelected` does.
   */
  function pressDuplicate(state: { shapes: { id: string; placement: ShapePlacement }[]; selection: { id: string; placement: ShapePlacement }[]; replay: DuplicateReplay | null }, idPrefix: string) {
    const { delta, replaying } = nextDuplicateStep(state.replay, state.selection);
    const copies = state.selection.map((entry, index) => ({
      id: `${idPrefix}-${index}`,
      placement: applyTransformDelta(entry.placement, delta),
    }));
    return {
      shapes: [...state.shapes, ...copies],
      selection: copies,
      replay: {
        copyIds: copies.map((copy) => copy.id),
        sourcePlacements: new Map(copies.map((copy, index) => [copy.id, state.selection[index].placement])),
        delta,
      },
      delta,
      replaying,
    };
  }

  it("makes 5 evenly spaced copies in 5 keypresses", () => {
    let state = { shapes: [{ id: "a", placement: placement() }], selection: [{ id: "a", placement: placement() }], replay: null as DuplicateReplay | null };
    for (let press = 0; press < 5; press += 1) {
      state = pressDuplicate(state, `copy${press}`);
    }

    const xs = state.shapes.map((entry) => entry.placement.x);
    expect(xs).toEqual([0, 8, 16, 24, 32, 40]);
    const gaps = xs.slice(1).map((x, index) => x - xs[index]);
    gaps.forEach((gap) => expect(Math.abs(gap - 8)).toBeLessThan(1e-6));
  });

  it("memorises a transform applied to the copy and keeps the spacing even", () => {
    // Duplicate once, drag that copy to 30 mm, then let Ctrl+D do the rest.
    let state = pressDuplicate(
      { shapes: [{ id: "a", placement: placement() }], selection: [{ id: "a", placement: placement() }], replay: null },
      "copy0",
    );
    const dragged = { id: state.selection[0].id, placement: placement({ x: 30 }) };
    state = { ...state, selection: [dragged], shapes: [{ id: "a", placement: placement() }, dragged] };

    const second = pressDuplicate(state, "copy1");
    const third = pressDuplicate(second, "copy2");

    expect(second.replaying).toBe(true);
    // The step is the copy's whole offset from its source (30), not the 22 mm
    // of drag on top of the 8 mm duplicate offset.
    expect(second.delta.x).toBe(30);
    expect(second.selection[0].placement.x).toBe(60);
    expect(third.selection[0].placement.x).toBe(90);
    const xs = third.shapes.map((entry) => entry.placement.x);
    expect(xs).toEqual([0, 30, 60, 90]);
  });

  it("replays elevation and rotation, not only translation", () => {
    let state = pressDuplicate(
      { shapes: [{ id: "a", placement: placement() }], selection: [{ id: "a", placement: placement() }], replay: null },
      "copy0",
    );
    const turned = { id: state.selection[0].id, placement: placement({ x: 20, elevation: 10, rotation: 45 }) };
    state = { ...state, selection: [turned] };

    const next = pressDuplicate(state, "copy1");
    expect(next.selection[0].placement).toEqual(placement({ x: 40, elevation: 20, rotation: 90 }));
  });

  it("falls back to a plain duplicate once the selection is something else", () => {
    const state = pressDuplicate(
      { shapes: [{ id: "a", placement: placement() }], selection: [{ id: "a", placement: placement() }], replay: null },
      "copy0",
    );
    const elsewhere = nextDuplicateStep(state.replay, [{ id: "other", placement: placement({ x: 70 }) }]);
    expect(elsewhere).toEqual({ delta: DEFAULT_DUPLICATE_DELTA, replaying: false });
  });

  it("falls back when the selection grew beyond the last copies", () => {
    const state = pressDuplicate(
      { shapes: [{ id: "a", placement: placement() }], selection: [{ id: "a", placement: placement() }], replay: null },
      "copy0",
    );
    const widened = nextDuplicateStep(state.replay, [...state.selection, { id: "a", placement: placement() }]);
    expect(widened.replaying).toBe(false);
  });

  it("does not replay a copy dragged back onto its source", () => {
    const state = pressDuplicate(
      { shapes: [{ id: "a", placement: placement() }], selection: [{ id: "a", placement: placement() }], replay: null },
      "copy0",
    );
    const returned = nextDuplicateStep(state.replay, [{ id: state.selection[0].id, placement: placement() }]);
    expect(returned).toEqual({ delta: DEFAULT_DUPLICATE_DELTA, replaying: false });
  });

  it("starts fresh with no replay state at all", () => {
    expect(nextDuplicateStep(null, [{ id: "a", placement: placement() }])).toEqual({ delta: DEFAULT_DUPLICATE_DELTA, replaying: false });
  });

  it("only calls a step memorised once it differs from the plain duplicate offset", () => {
    expect(isMemorisedDuplicateStep(DEFAULT_DUPLICATE_DELTA)).toBe(false);
    expect(isMemorisedDuplicateStep({ ...IDENTITY_TRANSFORM_DELTA, x: 30 })).toBe(true);
  });
});

describe("linearPatternPlacements", () => {
  it("returns count-1 copies, evenly spaced, original untouched", () => {
    const step = { ...IDENTITY_TRANSFORM_DELTA, x: 30 };
    const copies = linearPatternPlacements(shape({ x: 10 }), { count: 5, step });

    expect(copies).toHaveLength(4);
    expect(copies.map((copy) => copy.x)).toEqual([40, 70, 100, 130]);
    const gaps = copies.map((copy, index) => copy.x - (index === 0 ? 10 : copies[index - 1].x));
    gaps.forEach((gap) => expect(Math.abs(gap - 30)).toBeLessThan(1e-6));
  });

  it("replays elevation and rotation steps too, not just translation", () => {
    const copies = linearPatternPlacements(shape(), { count: 3, step: { ...IDENTITY_TRANSFORM_DELTA, elevation: 4, rotation: 10 } });
    expect(copies.map((copy) => [copy.elevation, copy.rotation])).toEqual([
      [4, 10],
      [8, 20],
    ]);
  });

  it("returns nothing for a count of one or less", () => {
    expect(linearPatternPlacements(shape(), { count: 1, step: DEFAULT_DUPLICATE_DELTA })).toEqual([]);
    expect(linearPatternPlacements(shape(), { count: 0, step: DEFAULT_DUPLICATE_DELTA })).toEqual([]);
  });
});

describe("circularPatternPlacements", () => {
  it("puts 6 holes on a bolt circle 60° apart at a constant radius", () => {
    const copies = circularPatternPlacements(shape({ x: 20, z: 0 }), { count: 6, centerX: 0, centerZ: 0 });

    expect(copies).toHaveLength(5);
    copies.forEach((copy) => expect(Math.abs(Math.hypot(copy.x, copy.z) - 20)).toBeLessThan(1e-3));
    expect(copies.map((copy) => copy.rotation)).toEqual([60, 120, 180, 240, 300]);
    // First copy sits 60° round from (20, 0): x = 20cos60 = 10.
    expect(Math.abs(copies[0].x - 10)).toBeLessThan(1e-3);
  });

  it("turns positions the same way rotation turns the shape", () => {
    // shape.rotation feeds a right-handed Euler about +Y, so +90° takes
    // (20, 0) to (0, -20). If these disagreed, rotated copies would face the
    // wrong way round the circle.
    // count 3 across 180° steps by 90°, so the first copy is the +90° case.
    const [copy] = circularPatternPlacements(shape({ x: 20, z: 0 }), { count: 3, centerX: 0, centerZ: 0, totalAngle: 180 });
    expect(Math.abs(copy.x)).toBeLessThan(1e-3);
    expect(Math.abs(copy.z + 20)).toBeLessThan(1e-3);
    expect(copy.rotation).toBe(90);
  });

  it("spans an arc when the sweep is not a full turn", () => {
    const copies = circularPatternPlacements(shape({ x: 10, z: 0 }), { count: 3, centerX: 0, centerZ: 0, totalAngle: 90 });
    // Two copies across 90°: the last one lands exactly on the arc end.
    expect(copies.map((copy) => copy.rotation)).toEqual([45, 90]);
  });

  it("can leave copies unrotated for parts that must stay square to the axes", () => {
    const copies = circularPatternPlacements(shape({ x: 20, rotation: 12 }), { count: 4, centerX: 0, centerZ: 0, rotateCopies: false });
    expect(copies.map((copy) => copy.rotation)).toEqual([12, 12, 12]);
  });

  it("orbits a centre that is not the origin", () => {
    // One copy across a 180° sweep lands opposite the original.
    const copies = circularPatternPlacements(shape({ x: 60, z: 40 }), { count: 2, centerX: 50, centerZ: 40, totalAngle: 180 });
    expect(Math.abs(copies[0].x - 40)).toBeLessThan(1e-3);
    expect(Math.abs(copies[0].z - 40)).toBeLessThan(1e-3);
  });

  it("keeps elevation, so a bolt circle stays in its plane", () => {
    const copies = circularPatternPlacements(shape({ x: 20, elevation: 6 }), { count: 4, centerX: 0, centerZ: 0 });
    copies.forEach((copy) => expect(copy.elevation).toBe(6));
  });

  it("returns nothing for a count of one or less", () => {
    expect(circularPatternPlacements(shape({ x: 20 }), { count: 1, centerX: 0, centerZ: 0 })).toEqual([]);
  });
});
