import { makeShapeFromAsset } from "@/lib/shapeCatalog";
import type { ShapeAsset, ShapeKind } from "@/types/sketchforge";

/**
 * Planning layer for the shape gallery's 3D tile art.
 *
 * Split from the renderer on purpose: everything here is pure and runs in a node
 * test, while `shapeThumbnailRenderer.ts` owns the WebGL context that vitest
 * cannot give us. The plan answers three questions the renderer should not have
 * to re-derive — what geometry to build, how big it is, and where to put the
 * camera so every tile frames its shape the same way.
 *
 * Dimensions come from `makeShapeFromAsset`, the same function the placement
 * path uses, so a tile shows the proportions of the object you actually get.
 */

/** How a catalog entry's tile is drawn. */
export type ShapeThumbnailArt =
  /** Real three.js geometry, built by the renderer from the plan. */
  | "mesh"
  /** Falls back to the catalog PNG — geometry we cannot build faithfully yet. */
  | "icon";

export type ShapeThumbnailPlan = {
  assetId: string;
  kind: ShapeKind;
  color: string;
  hole: boolean;
  width: number;
  height: number;
  depth: number;
  art: ShapeThumbnailArt;
};

/**
 * Kinds whose thumbnail geometry the renderer can build faithfully.
 *
 * `text` is excluded because real glyphs need the font pipeline that lives in
 * the viewport; its tile keeps the catalog PNG rather than showing a blank
 * plate that misrepresents the shape. `gear` IS included but the renderer draws
 * an approximation (rim teeth, no center bore) — close enough to read at 96 px,
 * and noted there so nobody mistakes it for the real generator.
 */
const MESH_ART_KINDS = new Set<ShapeKind>([
  "box",
  "cylinder",
  "sphere",
  "cone",
  "pyramid",
  "wedge",
  "roundRoof",
  "halfSphere",
  "torus",
  "tube",
  "gear",
]);

export function shapeThumbnailArt(kind: ShapeKind): ShapeThumbnailArt {
  return MESH_ART_KINDS.has(kind) ? "mesh" : "icon";
}

/** What the tile for `asset` should draw, at the size the asset actually places. */
export function shapeThumbnailPlan(asset: ShapeAsset): ShapeThumbnailPlan {
  const shape = makeShapeFromAsset(asset);
  return {
    assetId: asset.id,
    kind: asset.kind,
    color: asset.color,
    hole: asset.hole ?? false,
    width: shape.width,
    height: shape.height,
    depth: shape.depth,
    art: shapeThumbnailArt(asset.kind),
  };
}

export type ThumbnailFraming = {
  /** Half-diagonal of the bounding box — the sphere the camera must clear. */
  radius: number;
  camera: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  near: number;
  far: number;
};

/**
 * Camera placement for a tile, from the shape's extents.
 *
 * Every tile uses one direction (a raised three-quarter view, matching how the
 * viewport first frames a new object) and varies only distance, so a row of
 * tiles reads as one set instead of twelve unrelated renders. Distance is a
 * multiple of the bounding radius, which is why a 86 mm text plate and a 20 mm
 * box both fill the same fraction of their tile.
 */
export const THUMBNAIL_FOV_DEGREES = 32;

export function thumbnailFraming(
  width: number,
  height: number,
  depth: number,
  margin = 1.06,
  fovDegrees = THUMBNAIL_FOV_DEGREES,
): ThumbnailFraming {
  const safeWidth = Math.max(0.001, width);
  const safeHeight = Math.max(0.001, height);
  const safeDepth = Math.max(0.001, depth);
  const radius = Math.max(0.001, Math.hypot(safeWidth, safeHeight, safeDepth) / 2);
  // Fit the bounding sphere to the frustum: at distance d the vertical half-angle
  // subtends d·sin(fov/2), so anything closer than r/sin(fov/2) crops the shape.
  // `margin` is padding on top of a just-touching fit, not the fit itself.
  const distance = (radius / Math.sin((fovDegrees * Math.PI) / 360)) * margin;
  // Normalised three-quarter direction, so `distance` is the true eye distance.
  const dir = { x: 0.62, y: 0.52, z: 0.59 };
  const length = Math.hypot(dir.x, dir.y, dir.z);
  return {
    radius,
    camera: {
      x: (dir.x / length) * distance,
      y: (dir.y / length) * distance,
      z: (dir.z / length) * distance,
    },
    target: { x: 0, y: 0, z: 0 },
    near: Math.max(0.01, distance / 100),
    far: distance * 20,
  };
}

/**
 * Cache identity for a rendered tile.
 *
 * Theme is in the key because the tile is rendered against the panel colour;
 * flipping light/dark has to invalidate, or dark tiles keep a light halo.
 */
export function thumbnailCacheKey(assetId: string, size: number, pixelRatio: number, theme: string): string {
  return `${assetId}|${Math.round(size)}|${pixelRatio.toFixed(2)}|${theme}`;
}

const thumbnailCache = new Map<string, string>();

export function readCachedThumbnail(key: string): string | null {
  return thumbnailCache.get(key) ?? null;
}

export function writeCachedThumbnail(key: string, dataUrl: string) {
  thumbnailCache.set(key, dataUrl);
}

export function clearThumbnailCache() {
  thumbnailCache.clear();
}

export function cachedThumbnailCount() {
  return thumbnailCache.size;
}
