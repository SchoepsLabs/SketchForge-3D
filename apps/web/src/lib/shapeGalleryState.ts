import type { ShapeAsset } from "@/types/sketchforge";

/**
 * Categories, filtering and persisted panel state for the shape gallery.
 *
 * Pure by design so the whole panel behaviour is unit tested without a DOM: the
 * component owns rendering and localStorage I/O, this owns what the panel shows
 * and what a stored preference means.
 *
 * Categories are keyed off the catalog id rather than the shape kind so the
 * Block 3 generators (Gridfinity, fasteners, panel cutouts) can join a category
 * without this file learning anything about their geometry.
 */

export type ShapeGalleryCategoryId = "all" | "basic" | "rounded" | "parts";

export type ShapeGalleryCategory = {
  id: ShapeGalleryCategoryId;
  label: string;
};

export const SHAPE_GALLERY_CATEGORIES: ShapeGalleryCategory[] = [
  { id: "all", label: "All shapes" },
  { id: "basic", label: "Basic" },
  { id: "rounded", label: "Rounded" },
  { id: "parts", label: "Parts" },
];

const CATEGORY_BY_ASSET_ID: Record<string, ShapeGalleryCategoryId> = {
  box: "basic",
  cylinder: "basic",
  sphere: "basic",
  cone: "basic",
  pyramid: "basic",
  wedge: "basic",
  "round-roof": "rounded",
  "half-sphere": "rounded",
  torus: "rounded",
  tube: "rounded",
  gear: "parts",
  text: "parts",
};

/** Anything not explicitly categorised still has to be reachable, so it lands in Parts. */
export function galleryCategoryFor(assetId: string): ShapeGalleryCategoryId {
  return CATEGORY_BY_ASSET_ID[assetId] ?? "parts";
}

export function filterGalleryAssets<T extends ShapeAsset>(
  assets: readonly T[],
  category: ShapeGalleryCategoryId,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  return assets.filter((asset) => {
    if (category !== "all" && galleryCategoryFor(asset.id) !== category) return false;
    if (!needle) return true;
    return asset.name.toLowerCase().includes(needle) || asset.id.toLowerCase().includes(needle);
  });
}

export type ShapeGallerySide = "left" | "right";

export type ShapeGalleryPanelState = {
  collapsed: boolean;
  side: ShapeGallerySide;
  category: ShapeGalleryCategoryId;
};

/**
 * Left by default.
 *
 * Tinkercad puts its palette on the right, but the fork's right edge already
 * carries the inspector rail and the assistant dock; freeing it is the Block 8
 * "inspector becomes a popover" task, which has not landed. Left keeps the
 * panel always-visible today without a three-way fight for the same edge, and
 * the side is stored so the choice can be flipped once that task ships.
 */
export const DEFAULT_SHAPE_GALLERY_STATE: ShapeGalleryPanelState = {
  collapsed: false,
  side: "left",
  category: "all",
};

export const SHAPE_GALLERY_STORAGE_KEY = "sketchForge.shapeGallery";

function isCategory(value: unknown): value is ShapeGalleryCategoryId {
  return SHAPE_GALLERY_CATEGORIES.some((category) => category.id === value);
}

/** Tolerant on purpose: a malformed or partial preference falls back per-field. */
export function parseShapeGalleryState(raw: string | null | undefined): ShapeGalleryPanelState {
  if (!raw) return DEFAULT_SHAPE_GALLERY_STATE;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_SHAPE_GALLERY_STATE;
    const stored = value as Partial<ShapeGalleryPanelState>;
    return {
      collapsed: typeof stored.collapsed === "boolean" ? stored.collapsed : DEFAULT_SHAPE_GALLERY_STATE.collapsed,
      side: stored.side === "left" || stored.side === "right" ? stored.side : DEFAULT_SHAPE_GALLERY_STATE.side,
      category: isCategory(stored.category) ? stored.category : DEFAULT_SHAPE_GALLERY_STATE.category,
    };
  } catch {
    return DEFAULT_SHAPE_GALLERY_STATE;
  }
}

export function serializeShapeGalleryState(state: ShapeGalleryPanelState): string {
  return JSON.stringify(state);
}
