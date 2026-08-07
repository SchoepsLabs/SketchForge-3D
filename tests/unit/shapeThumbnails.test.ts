import { describe, expect, it, beforeEach } from "vitest";
import {
  cachedThumbnailCount,
  clearThumbnailCache,
  readCachedThumbnail,
  shapeThumbnailArt,
  shapeThumbnailPlan,
  thumbnailCacheKey,
  thumbnailFraming,
  writeCachedThumbnail,
  THUMBNAIL_FOV_DEGREES,
} from "@/lib/shapeThumbnails";
import { makeShapeFromAsset, toolbarShapeAssets } from "@/lib/shapeCatalog";

describe("shapeThumbnailPlan", () => {
  it("carries the dimensions the placement path would actually use", () => {
    for (const asset of toolbarShapeAssets) {
      const placed = makeShapeFromAsset(asset);
      const plan = shapeThumbnailPlan(asset);
      expect(plan.width).toBe(placed.width);
      expect(plan.height).toBe(placed.height);
      expect(plan.depth).toBe(placed.depth);
      expect(plan.color).toBe(asset.color);
    }
  });

  it("plans mesh art for every catalog shape except the ones needing the font pipeline", () => {
    const iconOnly = toolbarShapeAssets.filter((asset) => shapeThumbnailPlan(asset).art === "icon");
    expect(iconOnly.map((asset) => asset.id)).toEqual(["text"]);
  });

  it("treats a hole variant as a hole so the renderer greys it", () => {
    const box = toolbarShapeAssets.find((asset) => asset.id === "box");
    expect(box).toBeDefined();
    expect(shapeThumbnailPlan({ ...box!, hole: true }).hole).toBe(true);
    expect(shapeThumbnailPlan(box!).hole).toBe(false);
  });

  it("falls back to icon art for a kind with no thumbnail geometry", () => {
    expect(shapeThumbnailArt("mesh")).toBe("icon");
    expect(shapeThumbnailArt("box")).toBe("mesh");
  });
});

describe("thumbnailFraming", () => {
  it("stands far enough back to fit the whole bounding sphere in the frustum", () => {
    // The regression this locks: a distance chosen without reference to the FOV
    // cropped every tile. Anything closer than radius/sin(fov/2) clips the shape.
    for (const asset of toolbarShapeAssets) {
      const plan = shapeThumbnailPlan(asset);
      const framing = thumbnailFraming(plan.width, plan.height, plan.depth);
      const distance = Math.hypot(framing.camera.x, framing.camera.y, framing.camera.z);
      const minimum = framing.radius / Math.sin((THUMBNAIL_FOV_DEGREES * Math.PI) / 360);
      expect(distance).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("does not stand so far back that the shape shrinks in the tile", () => {
    const framing = thumbnailFraming(20, 20, 20);
    const distance = Math.hypot(framing.camera.x, framing.camera.y, framing.camera.z);
    const minimum = framing.radius / Math.sin((THUMBNAIL_FOV_DEGREES * Math.PI) / 360);
    expect(distance).toBeLessThan(minimum * 1.25);
  });

  it("respects a caller-supplied field of view", () => {
    const narrow = thumbnailFraming(20, 20, 20, 1.06, 16);
    const wide = thumbnailFraming(20, 20, 20, 1.06, 64);
    expect(Math.hypot(narrow.camera.x, narrow.camera.y, narrow.camera.z)).toBeGreaterThan(
      Math.hypot(wide.camera.x, wide.camera.y, wide.camera.z),
    );
  });

  it("scales distance with the shape so tiles fill the same fraction of the frame", () => {
    const small = thumbnailFraming(10, 10, 10);
    const large = thumbnailFraming(100, 100, 100);
    const ratio = Math.hypot(large.camera.x, large.camera.y, large.camera.z) / Math.hypot(small.camera.x, small.camera.y, small.camera.z);
    expect(ratio).toBeCloseTo(10, 6);
  });

  it("keeps the whole bounding sphere between the near and far planes", () => {
    for (const asset of toolbarShapeAssets) {
      const plan = shapeThumbnailPlan(asset);
      const framing = thumbnailFraming(plan.width, plan.height, plan.depth);
      const distance = Math.hypot(framing.camera.x, framing.camera.y, framing.camera.z);
      expect(framing.near).toBeGreaterThan(0);
      expect(framing.near).toBeLessThan(distance - framing.radius);
      expect(framing.far).toBeGreaterThan(distance + framing.radius);
    }
  });

  it("survives a degenerate flat shape without a zero or NaN camera", () => {
    const framing = thumbnailFraming(0, 0, 0);
    expect(framing.radius).toBeGreaterThan(0);
    expect(Number.isFinite(framing.camera.x)).toBe(true);
    expect(Number.isFinite(framing.near)).toBe(true);
    expect(framing.far).toBeGreaterThan(framing.near);
  });

  it("uses one viewing direction for every shape", () => {
    const directions = toolbarShapeAssets.map((asset) => {
      const plan = shapeThumbnailPlan(asset);
      const framing = thumbnailFraming(plan.width, plan.height, plan.depth);
      const length = Math.hypot(framing.camera.x, framing.camera.y, framing.camera.z);
      return `${(framing.camera.x / length).toFixed(4)},${(framing.camera.y / length).toFixed(4)},${(framing.camera.z / length).toFixed(4)}`;
    });
    expect(new Set(directions).size).toBe(1);
  });
});

describe("thumbnail cache", () => {
  beforeEach(() => clearThumbnailCache());

  it("separates entries by asset, size, pixel ratio and theme", () => {
    const keys = new Set([
      thumbnailCacheKey("box", 96, 1, "light"),
      thumbnailCacheKey("box", 96, 2, "light"),
      thumbnailCacheKey("box", 96, 1, "dark"),
      thumbnailCacheKey("box", 64, 1, "light"),
      thumbnailCacheKey("cone", 96, 1, "light"),
    ]);
    expect(keys.size).toBe(5);
  });

  it("treats an equivalent size as the same key so a resize does not re-render", () => {
    expect(thumbnailCacheKey("box", 96.4, 1, "light")).toBe(thumbnailCacheKey("box", 96, 1, "light"));
  });

  it("stores and reads back, and reports a miss as null", () => {
    const key = thumbnailCacheKey("box", 96, 1, "light");
    expect(readCachedThumbnail(key)).toBeNull();
    writeCachedThumbnail(key, "data:image/png;base64,AAAA");
    expect(readCachedThumbnail(key)).toBe("data:image/png;base64,AAAA");
    expect(cachedThumbnailCount()).toBe(1);
  });

  it("clears", () => {
    writeCachedThumbnail(thumbnailCacheKey("box", 96, 1, "light"), "x");
    clearThumbnailCache();
    expect(cachedThumbnailCount()).toBe(0);
  });
});
