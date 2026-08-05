import type { GridSize, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";

const MIN_VISIBLE_GRID_STEP = 1;
const MAX_VISIBLE_GRID_STEP = 200;

/** Millimetres per snap step. 0 means snapping is off. */
export function snapGridStep(size: GridSize) {
  if (size === "Off") {
    return 0;
  }
  if (size === "Brick") {
    return 8;
  }
  return Number.parseFloat(size) || 1;
}

export const NUDGE_COARSE_MULTIPLIER = 10;
const NUDGE_STEP_WITHOUT_SNAP = 1;

/**
 * How far one arrow-key press moves the selection: one snap step, or 10× with
 * Shift. With snapping off there is no grid to follow, so it falls back to 1 mm
 * — the step the nudge used before it was tied to the grid.
 */
export function nudgeStepForSnap(size: GridSize, { coarse = false }: { coarse?: boolean } = {}) {
  const step = snapGridStep(size) || NUDGE_STEP_WITHOUT_SNAP;
  return coarse ? step * NUDGE_COARSE_MULTIPLIER : step;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cleanCoordinate(value: number) {
  const rounded = Number(value.toFixed(6));
  return Math.abs(rounded) < 1e-6 ? 0 : rounded;
}

export function visibleGridStep(workspace: WorkplaneWorkspaceSettings) {
  return clamp(workspace.gridBlockSize, MIN_VISIBLE_GRID_STEP, MAX_VISIBLE_GRID_STEP);
}

export type GridFootprintBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

function nearestVisibleGridLine(value: number, workspaceSize: number, step: number) {
  const gridOrigin = -workspaceSize / 2;
  return gridOrigin + Math.round((value - gridOrigin) / step) * step;
}

export function snapShapeFootprintToVisibleGrid(
  shape: WorkplaneShape,
  bounds: GridFootprintBounds,
  workspace: WorkplaneWorkspaceSettings,
) {
  const step = visibleGridStep(workspace);
  const xOffsets = [bounds.minX, bounds.maxX].map((value) => nearestVisibleGridLine(value, workspace.width, step) - value);
  const zOffsets = [bounds.minZ, bounds.maxZ].map((value) => nearestVisibleGridLine(value, workspace.depth, step) - value);
  const deltaX = xOffsets.reduce((best, value) => Math.abs(value) < Math.abs(best) ? value : best);
  const deltaZ = zOffsets.reduce((best, value) => Math.abs(value) < Math.abs(best) ? value : best);
  return {
    ...shape,
    x: cleanCoordinate(shape.x + deltaX),
    z: cleanCoordinate(shape.z + deltaZ),
  };
}
