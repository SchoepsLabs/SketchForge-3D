import type { ShapeAsset } from "@/types/sketchforge";

/**
 * Drag payload for shapes dragged from the toolbar shape menu onto the workplane.
 *
 * The register at the bottom exists because of one DOM rule: during `dragover`
 * the browser is in protected mode and `dataTransfer.getData()` returns "" —
 * only `dataTransfer.types` is readable. So the viewport cannot read the dropped
 * asset until the drop itself, which is too late to draw a placement ghost while
 * the pointer is still moving. The drag source therefore parks the asset here on
 * `dragstart` and clears it on `dragend`; both live in the same document and the
 * same JS context, so a module-level value is the whole mechanism.
 */

export const SHAPE_DRAG_MIME = "application/x-sketchforge-shape";

const SHAPE_DRAG_KINDS = new Set<ShapeAsset["kind"]>([
  "box",
  "cylinder",
  "sphere",
  "sketch",
  "scribble",
  "cone",
  "pyramid",
  "roof",
  "text",
  "roundRoof",
  "halfSphere",
  "torus",
  "tube",
  "gear",
  "ring",
  "wedge",
  "polygon",
  "icosahedron",
  "mesh",
]);

export function serializeShapeDragAsset(asset: ShapeAsset) {
  return JSON.stringify(asset);
}

export function parseShapeDragPayload(raw: string): ShapeAsset | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") {
      return null;
    }
    const asset = value as Partial<ShapeAsset>;
    if (
      typeof asset.id !== "string" ||
      typeof asset.name !== "string" ||
      typeof asset.src !== "string" ||
      typeof asset.color !== "string" ||
      !SHAPE_DRAG_KINDS.has(asset.kind as ShapeAsset["kind"]) ||
      (asset.hole !== undefined && typeof asset.hole !== "boolean")
    ) {
      return null;
    }
    return {
      id: asset.id,
      name: asset.name,
      src: asset.src,
      kind: asset.kind as ShapeAsset["kind"],
      color: asset.color,
      hole: asset.hole,
    };
  } catch {
    return null;
  }
}

/** True when this drag carries a SketchForge shape. `types` is all dragover exposes. */
export function isShapeDragTransfer(types: readonly string[] | DOMStringList | undefined | null) {
  if (!types) return false;
  const list = Array.from(types as ArrayLike<string>);
  return list.includes(SHAPE_DRAG_MIME);
}

let activeShapeDragAsset: ShapeAsset | null = null;

export function setActiveShapeDragAsset(asset: ShapeAsset | null) {
  activeShapeDragAsset = asset;
}

export function readActiveShapeDragAsset() {
  return activeShapeDragAsset;
}

export function clearActiveShapeDragAsset() {
  activeShapeDragAsset = null;
}
