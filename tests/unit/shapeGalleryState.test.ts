import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHAPE_GALLERY_STATE,
  SHAPE_GALLERY_CATEGORIES,
  filterGalleryAssets,
  galleryCategoryFor,
  parseShapeGalleryState,
  serializeShapeGalleryState,
} from "@/lib/shapeGalleryState";
import { toolbarShapeAssets } from "@/lib/shapeCatalog";

describe("gallery categories", () => {
  it("assigns every catalog shape to a real category", () => {
    for (const asset of toolbarShapeAssets) {
      const category = galleryCategoryFor(asset.id);
      expect(SHAPE_GALLERY_CATEGORIES.some((entry) => entry.id === category)).toBe(true);
      expect(category).not.toBe("all");
    }
  });

  it("keeps an uncategorised id reachable instead of hiding it", () => {
    expect(galleryCategoryFor("gridfinity-bin")).toBe("parts");
  });

  it("leaves no category tab empty for the shipped catalog", () => {
    for (const category of SHAPE_GALLERY_CATEGORIES) {
      expect(filterGalleryAssets(toolbarShapeAssets, category.id, "").length).toBeGreaterThan(0);
    }
  });
});

describe("filterGalleryAssets", () => {
  it("returns the whole catalog for 'all' with no query", () => {
    expect(filterGalleryAssets(toolbarShapeAssets, "all", "")).toHaveLength(toolbarShapeAssets.length);
  });

  it("filters by category", () => {
    const basic = filterGalleryAssets(toolbarShapeAssets, "basic", "");
    expect(basic.map((asset) => asset.id)).toContain("box");
    expect(basic.map((asset) => asset.id)).not.toContain("gear");
  });

  it("matches names case-insensitively and ignores surrounding space", () => {
    expect(filterGalleryAssets(toolbarShapeAssets, "all", "  CYL ").map((asset) => asset.id)).toEqual(["cylinder"]);
  });

  it("matches on id as well as name, so 'round-roof' finds Round Roof", () => {
    expect(filterGalleryAssets(toolbarShapeAssets, "all", "round-roof").map((asset) => asset.id)).toEqual(["round-roof"]);
  });

  it("intersects category and query rather than picking one", () => {
    expect(filterGalleryAssets(toolbarShapeAssets, "parts", "box")).toEqual([]);
  });

  it("returns empty for a query that matches nothing", () => {
    expect(filterGalleryAssets(toolbarShapeAssets, "all", "sprocket")).toEqual([]);
  });
});

describe("panel state persistence", () => {
  it("round-trips", () => {
    const state = { collapsed: true, side: "right" as const, category: "rounded" as const };
    expect(parseShapeGalleryState(serializeShapeGalleryState(state))).toEqual(state);
  });

  it("defaults to an open panel on the left", () => {
    expect(DEFAULT_SHAPE_GALLERY_STATE).toEqual({ collapsed: false, side: "left", category: "all" });
  });

  it("falls back for missing, malformed and non-object stored values", () => {
    expect(parseShapeGalleryState(null)).toEqual(DEFAULT_SHAPE_GALLERY_STATE);
    expect(parseShapeGalleryState("")).toEqual(DEFAULT_SHAPE_GALLERY_STATE);
    expect(parseShapeGalleryState("{not json")).toEqual(DEFAULT_SHAPE_GALLERY_STATE);
    expect(parseShapeGalleryState("[]")).toEqual(DEFAULT_SHAPE_GALLERY_STATE);
    expect(parseShapeGalleryState("null")).toEqual(DEFAULT_SHAPE_GALLERY_STATE);
  });

  it("keeps the valid fields of a partly-corrupt preference", () => {
    const parsed = parseShapeGalleryState(JSON.stringify({ collapsed: true, side: "sideways", category: "nope" }));
    expect(parsed).toEqual({ collapsed: true, side: "left", category: "all" });
  });
});
