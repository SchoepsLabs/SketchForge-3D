import { describe, expect, it } from "vitest";
import { nudgeStepForSnap, snapGridStep, snapShapeFootprintToVisibleGrid } from "@/lib/gridSnap";
import { DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import type { WorkplaneShape } from "@/types/sketchforge";

function groupedShape(): WorkplaneShape {
  return {
    id: "group",
    name: "Group",
    kind: "mesh",
    color: "#d41721",
    x: 3.2,
    z: -1.7,
    elevation: 2.4,
    size: 43.5,
    width: 43.5,
    depth: 19.8,
    height: 31.25,
    rotation: 0,
    groupedBaseWidth: 43.5,
    groupedBaseDepth: 19.8,
    groupedBaseHeight: 31.25,
    groupedShapes: [
      {
        id: "child-a",
        name: "Child A",
        kind: "box",
        color: "#d41721",
        x: -10.75,
        z: 1.2,
        elevation: 0,
        size: 20,
        width: 20,
        depth: 12,
        height: 20,
        rotation: 0,
      },
      {
        id: "child-b",
        name: "Child B",
        kind: "box",
        color: "#0098c7",
        x: 14.5,
        z: -2.8,
        elevation: 0,
        size: 10,
        width: 8,
        depth: 10,
        height: 31.25,
        rotation: 0,
      },
    ],
  };
}

describe("Snap to Grid", () => {
  it("snaps the nearest footprint corner to the visible grid without resizing or changing child offsets", () => {
    const group = groupedShape();
    const snapped = snapShapeFootprintToVisibleGrid(
      group,
      { minX: -17.3, maxX: 26.2, minZ: -11.4, maxZ: 8.4 },
      { ...DEFAULT_WORKPLANE_WORKSPACE, gridBlockSize: 5 },
    );

    expect(snapped.x).toBe(2);
    expect(snapped.z).toBe(-0.3);
    expect(26.2 + snapped.x - group.x).toBeCloseTo(25, 6);
    expect(-11.4 + snapped.z - group.z).toBeCloseTo(-10, 6);
    expect(snapped).toMatchObject({
      elevation: 2.4,
      width: 43.5,
      depth: 19.8,
      height: 31.25,
      size: 43.5,
    });
    expect(snapped.groupedShapes).toBe(group.groupedShapes);
  });

  it("uses the rendered grid origin for custom workplane dimensions", () => {
    const group = groupedShape();
    const snapped = snapShapeFootprintToVisibleGrid(
      group,
      { minX: -18, maxX: 25.5, minZ: -13, maxZ: 6.8 },
      { ...DEFAULT_WORKPLANE_WORKSPACE, width: 203, depth: 187, gridBlockSize: 10 },
    );

    expect(snapped.x).toBeCloseTo(6.2, 6);
    expect(snapped.z).toBeCloseTo(-2, 6);
    expect(25.5 + snapped.x - group.x).toBeCloseTo(28.5, 6);
    expect(6.8 + snapped.z - group.z).toBeCloseTo(6.5, 6);
  });
});

describe("snap grid steps", () => {
  it("reads millimetres out of the grid size label", () => {
    expect(snapGridStep("0.1 mm")).toBe(0.1);
    expect(snapGridStep("1.0 mm")).toBe(1);
    expect(snapGridStep("5.0 mm")).toBe(5);
  });

  it("knows the two labels that are not a number", () => {
    expect(snapGridStep("Off")).toBe(0);
    // A LEGO stud pitch, matching the viewport's placement snapping.
    expect(snapGridStep("Brick")).toBe(8);
  });
});

describe("nudgeStepForSnap", () => {
  it("moves one snap step per arrow press", () => {
    expect(nudgeStepForSnap("1.0 mm")).toBe(1);
    expect(nudgeStepForSnap("0.25 mm")).toBe(0.25);
    expect(nudgeStepForSnap("Brick")).toBe(8);
  });

  it("multiplies by ten with Shift held", () => {
    expect(nudgeStepForSnap("1.0 mm", { coarse: true })).toBe(10);
    expect(nudgeStepForSnap("0.5 mm", { coarse: true })).toBe(5);
    expect(nudgeStepForSnap("Brick", { coarse: true })).toBe(80);
  });

  it("falls back to 1 mm with snapping off, so arrows still do something", () => {
    expect(nudgeStepForSnap("Off")).toBe(1);
    expect(nudgeStepForSnap("Off", { coarse: true })).toBe(10);
  });
});
