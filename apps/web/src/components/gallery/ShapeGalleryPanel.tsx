"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SHAPE_GALLERY_STATE,
  SHAPE_GALLERY_CATEGORIES,
  SHAPE_GALLERY_STORAGE_KEY,
  filterGalleryAssets,
  parseShapeGalleryState,
  serializeShapeGalleryState,
  type ShapeGalleryCategoryId,
  type ShapeGalleryPanelState,
} from "@/lib/shapeGalleryState";
import {
  readCachedThumbnail,
  shapeThumbnailPlan,
  thumbnailCacheKey,
  writeCachedThumbnail,
} from "@/lib/shapeThumbnails";
import { disposeThumbnailRenderer, renderShapeThumbnail } from "@/lib/shapeThumbnailRenderer";
import { clearActiveShapeDragAsset, serializeShapeDragAsset, setActiveShapeDragAsset, SHAPE_DRAG_MIME } from "@/lib/shapeDragPayload";
import type { ToolbarShapeAsset } from "@/lib/shapeCatalog";
import type { ResolvedAppTheme } from "@/lib/appTheme";

/**
 * The always-visible shape gallery.
 *
 * Placement is not reimplemented here. Dragging sets the same MIME payload and
 * module-level asset register the toolbar dropdown sets, so the viewport's
 * existing `handleDragOver`/`handleDrop` and the placement ghost drive the drop
 * unchanged; clicking calls the same handler the dropdown's tiles call, which
 * arms cursor placement when `cruiseShapes` is on. Everything visual in this
 * panel is provisional until approved live.
 */

const TILE_ART_SIZE = 96;

export type ShapeGalleryPanelProps = {
  assets: readonly ToolbarShapeAsset[];
  onPlaceShape: (asset: ToolbarShapeAsset) => void;
  resolvedTheme: ResolvedAppTheme;
};

function readStoredState(): ShapeGalleryPanelState {
  if (typeof window === "undefined") return DEFAULT_SHAPE_GALLERY_STATE;
  try {
    return parseShapeGalleryState(window.localStorage.getItem(SHAPE_GALLERY_STORAGE_KEY));
  } catch {
    return DEFAULT_SHAPE_GALLERY_STATE;
  }
}

export function ShapeGalleryPanel({ assets, onPlaceShape, resolvedTheme }: ShapeGalleryPanelProps) {
  // Server render must match the first client render, so the stored preference
  // is adopted in an effect rather than read during the initial render.
  const [state, setState] = useState<ShapeGalleryPanelState>(DEFAULT_SHAPE_GALLERY_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  /**
   * Which theme the current tile art was rendered for, or null for "none yet".
   *
   * Keyed on the theme rather than a boolean `rendered` flag on purpose: with a
   * boolean plus a separate effect to reset it, a theme switch re-runs the
   * render effect *before* the reset effect clears the flag, so the render
   * bails out and every tile stays on its PNG fallback for good. Comparing
   * against the theme makes the guard independent of effect ordering.
   */
  const renderedForRef = useRef<string | null>(null);

  useEffect(() => {
    setState(readStoredState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SHAPE_GALLERY_STORAGE_KEY, serializeShapeGalleryState(state));
    } catch {
      // A blocked localStorage costs the preference, not the panel.
    }
  }, [hydrated, state]);

  const visibleAssets = useMemo(
    () => filterGalleryAssets(assets, state.category, query),
    [assets, state.category, query],
  );

  /**
   * Tile art is rendered once the panel is actually open, not at mount: an
   * expanded-by-default panel still defers twelve WebGL renders until after
   * first paint, and a collapsed one never pays for them at all.
   */
  useEffect(() => {
    if (!hydrated || state.collapsed || renderedForRef.current === resolvedTheme) return;
    renderedForRef.current = resolvedTheme;
    const pixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

    const handle = window.setTimeout(() => {
      const rendered: Record<string, string> = {};
      for (const asset of assets) {
        const plan = shapeThumbnailPlan(asset);
        if (plan.art !== "mesh") continue;
        const key = thumbnailCacheKey(asset.id, TILE_ART_SIZE, pixelRatio, resolvedTheme);
        const cached = readCachedThumbnail(key);
        if (cached) {
          rendered[asset.id] = cached;
          continue;
        }
        const dataUrl = renderShapeThumbnail({ plan, size: TILE_ART_SIZE, pixelRatio });
        if (dataUrl) {
          writeCachedThumbnail(key, dataUrl);
          rendered[asset.id] = dataUrl;
        }
      }
      // Replaced, not merged: art rendered for the previous theme must not
      // linger for any tile the new pass could not produce.
      setThumbnails(rendered);
    }, 0);

    return () => window.clearTimeout(handle);
  }, [assets, hydrated, resolvedTheme, state.collapsed]);

  useEffect(() => () => disposeThumbnailRenderer(), []);

  const setCategory = useCallback((category: ShapeGalleryCategoryId) => {
    setState((current) => ({ ...current, category }));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setState((current) => ({ ...current, collapsed: !current.collapsed }));
  }, []);

  if (state.collapsed) {
    return (
      <aside className={`shape-gallery collapsed ${state.side}`} aria-label="Shape gallery">
        <button type="button" className="shape-gallery-tab" onClick={toggleCollapsed} title="Show shapes" aria-expanded={false}>
          <span className="shape-gallery-tab-label">Shapes</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className={`shape-gallery ${state.side}`} aria-label="Shape gallery">
      <header className="shape-gallery-header">
        <strong>Shapes</strong>
        <button type="button" className="shape-gallery-collapse" onClick={toggleCollapsed} title="Hide shapes" aria-expanded>
          Hide
        </button>
      </header>

      <div className="shape-gallery-filters">
        <div className="shape-gallery-categories" role="tablist" aria-label="Shape categories">
          {SHAPE_GALLERY_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={state.category === category.id}
              className={`shape-gallery-category ${state.category === category.id ? "active" : ""}`}
              onClick={() => setCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
        <input
          className="shape-gallery-search"
          type="search"
          value={query}
          placeholder="Search shapes"
          aria-label="Search shapes"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="shape-gallery-grid">
        {visibleAssets.map((asset) => {
          const art = thumbnails[asset.id];
          return (
            <button
              key={asset.id}
              type="button"
              className="shape-gallery-tile"
              title={`${asset.name} — drag onto the plate, or click to place`}
              draggable
              onClick={() => onPlaceShape(asset)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(SHAPE_DRAG_MIME, serializeShapeDragAsset(asset));
                // Unreadable during dragover — park it where the ghost can reach it.
                setActiveShapeDragAsset(asset);
              }}
              onDragEnd={() => clearActiveShapeDragAsset()}
            >
              <span className="shape-gallery-tile-art">
                <img src={art ?? asset.menuIcon} alt="" draggable={false} />
              </span>
              <span className="shape-gallery-tile-label">{asset.name}</span>
            </button>
          );
        })}
        {visibleAssets.length === 0 ? <p className="shape-gallery-empty">No shapes match “{query}”.</p> : null}
      </div>

      <footer className="shape-gallery-hint">Drag onto the plate, or click to place</footer>
    </aside>
  );
}
