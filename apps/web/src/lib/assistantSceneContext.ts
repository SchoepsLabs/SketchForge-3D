import { lengthDisplayUnit } from "@/lib/measurementUnits";
import type { SketchForgeMcpSceneSummary, SketchForgeMcpShapeSummary } from "@/lib/sketchforgeMcpProtocol";

/**
 * Renders the live scene as a few lines of text for the assistant's system
 * prompt, rebuilt on every message.
 *
 * The point is that "make the cylinder as tall as the box" resolves without a
 * read-tool round trip: the model already knows there is exactly one cylinder
 * and how tall the box is. Tools stay the source of truth for anything the
 * summary omits — it is a table of contents, not a scene dump, which is why
 * meshes report a triangle count instead of vertices.
 */

export const ASSISTANT_SCENE_SHAPE_LIMIT = 20;

function trimNumber(value: number) {
  if (!Number.isFinite(value)) return "?";
  return `${Math.round(value * 1000) / 1000}`;
}

function shapeSize(shape: SketchForgeMcpShapeSummary) {
  const { width, depth, height } = shape.dimensions;
  return `${trimNumber(width)} × ${trimNumber(depth)} × ${trimNumber(height)}`;
}

function shapeFlags(shape: SketchForgeMcpShapeSummary) {
  const flags: string[] = [];
  if (shape.hole) flags.push("hole");
  if (shape.locked) flags.push("locked");
  if (shape.hidden) flags.push("hidden");
  if (shape.groupedCount > 0) flags.push(`group of ${shape.groupedCount}`);
  if (shape.importedTriangles > 0) flags.push(`${shape.importedTriangles} tris`);
  if (Array.isArray(shape.edgeTreatments) && shape.edgeTreatments.length > 0) {
    flags.push(`${shape.edgeTreatments.length} edge feature${shape.edgeTreatments.length === 1 ? "" : "s"}`);
  }
  const rotations = (["x", "y", "z"] as const)
    .filter((axis) => Math.abs(shape.rotation[axis]) > 0.0001)
    .map((axis) => `${axis}${trimNumber(shape.rotation[axis])}°`);
  if (rotations.length) flags.push(`rotated ${rotations.join(" ")}`);
  return flags;
}

function shapeLine(shape: SketchForgeMcpShapeSummary, selected: boolean) {
  const flags = shapeFlags(shape);
  const marks = [...flags, ...(selected ? ["selected"] : [])];
  const parts = [
    `- ${shape.name} [${shape.kind}, id ${shape.id}]:`,
    `${shapeSize(shape)} at x ${trimNumber(shape.position.x)}, z ${trimNumber(shape.position.z)}, elevation ${trimNumber(shape.position.elevation)}`,
  ];
  if (marks.length) parts.push(`(${marks.join(", ")})`);
  return parts.join(" ");
}

export function buildAssistantSceneContext(
  scene: SketchForgeMcpSceneSummary,
  { shapeLimit = ASSISTANT_SCENE_SHAPE_LIMIT }: { shapeLimit?: number } = {},
): string {
  const workspace = scene.workspace;
  const lines: string[] = [];

  lines.push(`Project "${scene.projectName}" · snap ${scene.snap ?? "Off"}`);
  if (workspace) {
    lines.push(
      `Workplane ${trimNumber(workspace.width)} × ${trimNumber(workspace.depth)} mm, grid blocks ${trimNumber(workspace.gridBlockSize)} mm`,
    );
    // workspace.units/scale are UI preset labels ("Metric (Default)",
    // "1:1 (millimeters)"), not unit symbols — the display unit comes from
    // lengthDisplayUnit. Everything the tools take is millimetres regardless,
    // so say so, and only mention conversion when the user sees something else.
    const display = lengthDisplayUnit(workspace);
    lines.push(
      display.millimetersPerUnit === 1
        ? "Every dimension below and every tool parameter is in millimetres."
        : `Every dimension below and every tool parameter is in millimetres, but the user's workspace displays ${display.label} (1 ${display.label} = ${trimNumber(display.millimetersPerUnit)} mm) — convert sizes they name in ${display.label}.`,
    );
  }

  if (scene.shapeCount === 0) {
    lines.push("The plate is empty — there are no objects yet.");
    return lines.join("\n");
  }

  const selected = new Set(scene.selectedIds);
  const shapes = scene.shapes ?? [];
  const limit = Math.max(0, shapeLimit);
  const listed = shapes.slice(0, limit);
  lines.push(`${scene.shapeCount} object${scene.shapeCount === 1 ? "" : "s"} on the plate:`);
  listed.forEach((shape) => lines.push(shapeLine(shape, selected.has(shape.id))));

  const hidden = shapes.length - listed.length;
  if (hidden > 0) {
    // Token guard: a 500-object scene must not blow up every system prompt.
    lines.push(`- …and ${hidden} more not listed here; call sketchforge_list_objects for the full list.`);
  }

  const selectedNames = shapes.filter((shape) => selected.has(shape.id)).map((shape) => shape.name);
  lines.push(
    selectedNames.length
      ? `Current selection: ${selectedNames.join(", ")}.`
      : "Nothing is selected.",
  );

  return lines.join("\n");
}
