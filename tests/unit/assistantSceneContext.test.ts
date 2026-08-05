import { describe, expect, it } from "vitest";
import { ASSISTANT_SCENE_SHAPE_LIMIT, buildAssistantSceneContext } from "@/lib/assistantSceneContext";
import type { SketchForgeMcpSceneSummary, SketchForgeMcpShapeSummary } from "@/lib/sketchforgeMcpProtocol";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";

const workspace: WorkplaneWorkspaceSettings = {
  width: 200,
  depth: 200,
  sizePreset: "200 × 200",
  gridBlockSize: 5,
  gridBlockPreset: "5 mm",
  gridColor: "#9adcf0",
  background: "#fafafa",
  showShadows: true,
  showGrid: true,
  workplaneOpacity: 100,
  cruiseShapes: true,
  zoomSpeed: 1,
  units: "mm",
  scale: "1:1",
  accuracy: 2,
  historyLimit: "unlimited",
};

function shape(overrides: Partial<SketchForgeMcpShapeSummary> = {}): SketchForgeMcpShapeSummary {
  return {
    id: "shape-1",
    name: "Box",
    kind: "box",
    color: "#d41721",
    hole: false,
    locked: false,
    hidden: false,
    position: { x: 0, z: 0, elevation: 0 },
    dimensions: { width: 20, depth: 20, height: 20, size: 20 },
    rotation: { x: 0, y: 0, z: 0 },
    mirror: { x: false, y: false, z: false },
    edgeTreatments: [],
    groupedCount: 0,
    importedTriangles: 0,
    cadDisplayEdgeCount: null,
    sketchPointCount: 0,
    sketchSegmentCount: 0,
    ...overrides,
  };
}

function scene(overrides: Partial<SketchForgeMcpSceneSummary> = {}): SketchForgeMcpSceneSummary {
  const shapes = overrides.shapes ?? [shape()];
  return {
    projectId: null,
    projectName: "SketchForge design",
    notice: "Ready",
    selectedIds: [],
    shapeCount: shapes.length,
    workspace,
    snap: "1.0 mm",
    ...overrides,
    shapes,
  };
}

describe("buildAssistantSceneContext", () => {
  it("leads with the project, snap and workplane the assistant must respect", () => {
    const context = buildAssistantSceneContext(scene());
    expect(context.split("\n")[0]).toBe('Project "SketchForge design" · snap 1.0 mm');
    expect(context).toContain("Workplane 200 × 200 mm, grid blocks 5 mm");
  });

  it("states that tool parameters are millimetres", () => {
    // workspace.units is the UI preset label ("Metric (Default)"), never a unit
    // symbol — printing it raw produced "200 × 200 Metric (Default)" on live data.
    const context = buildAssistantSceneContext(scene({ workspace: { ...workspace, units: "Metric (Default)", scale: "1:1 (millimeters)" } }));
    expect(context).toContain("Every dimension below and every tool parameter is in millimetres.");
    expect(context).not.toContain("Metric (Default)");
  });

  it("explains the conversion when the workspace displays something other than mm", () => {
    const context = buildAssistantSceneContext(scene({ workspace: { ...workspace, units: "Imperial", scale: "1:1 (inches)" } }));
    expect(context).toContain("displays in (1 in = 25.4 mm)");
    expect(context).toContain("convert sizes they name in in");
  });

  it("says the plate is empty rather than printing a heading with nothing under it", () => {
    const context = buildAssistantSceneContext(scene({ shapes: [], shapeCount: 0 }));
    expect(context).toContain("The plate is empty");
    expect(context).not.toContain("objects on the plate");
  });

  it("gives each object a name, kind, id, size and position", () => {
    const context = buildAssistantSceneContext(
      scene({ shapes: [shape({ name: "Base plate", dimensions: { width: 60, depth: 40, height: 3, size: 60 }, position: { x: 10, z: -5, elevation: 2 } })] }),
    );
    expect(context).toContain("- Base plate [box, id shape-1]: 60 × 40 × 3 at x 10, z -5, elevation 2");
  });

  it("resolves the acceptance case without a tool call: one cylinder, one box, both with heights", () => {
    const context = buildAssistantSceneContext(
      scene({
        shapes: [
          shape({ id: "box-1", name: "Box", dimensions: { width: 20, depth: 20, height: 25, size: 20 } }),
          shape({ id: "cyl-1", name: "Cylinder", kind: "cylinder", dimensions: { width: 10, depth: 10, height: 8, size: 10 } }),
        ],
      }),
    );
    expect(context).toContain("Box [box, id box-1]: 20 × 20 × 25");
    expect(context).toContain("Cylinder [cylinder, id cyl-1]: 10 × 10 × 8");
  });

  it("flags the states that change what an edit is allowed to do", () => {
    const context = buildAssistantSceneContext(
      scene({ shapes: [shape({ hole: true, locked: true, hidden: true, groupedCount: 3, edgeTreatments: [{}, {}] })] }),
    );
    expect(context).toContain("(hole, locked, hidden, group of 3, 2 edge features)");
  });

  it("reports a mesh by triangle count instead of geometry", () => {
    const context = buildAssistantSceneContext(scene({ shapes: [shape({ kind: "mesh", importedTriangles: 384 })] }));
    expect(context).toContain("384 tris");
  });

  it("notes rotations but stays silent about zero ones", () => {
    const rotated = buildAssistantSceneContext(scene({ shapes: [shape({ rotation: { x: 0, y: 45, z: 0 } })] }));
    expect(rotated).toContain("rotated y45°");
    expect(buildAssistantSceneContext(scene())).not.toContain("rotated");
  });

  it("names the selection so 'move it 10mm' has a referent", () => {
    const context = buildAssistantSceneContext(scene({ shapes: [shape({ name: "Bracket" })], selectedIds: ["shape-1"] }));
    expect(context).toContain("(selected)");
    expect(context).toContain("Current selection: Bracket.");
    expect(buildAssistantSceneContext(scene())).toContain("Nothing is selected.");
  });

  it("caps the list at 20 objects and says how to get the rest", () => {
    const shapes = Array.from({ length: 26 }, (_, index) => shape({ id: `shape-${index}`, name: `Part ${index}` }));
    const context = buildAssistantSceneContext(scene({ shapes }));
    const listed = context.split("\n").filter((line) => line.startsWith("- Part "));
    expect(listed).toHaveLength(ASSISTANT_SCENE_SHAPE_LIMIT);
    expect(context).toContain("and 6 more not listed here");
    expect(context).toContain("sketchforge_list_objects");
    expect(context).toContain("26 objects on the plate");
  });

  it("rounds long floats instead of printing 20.000000000000004", () => {
    const context = buildAssistantSceneContext(scene({ shapes: [shape({ dimensions: { width: 20.000000000000004, depth: 19.9999999, height: 3.5, size: 20 } })] }));
    expect(context).toContain("20 × 20 × 3.5");
  });
});
