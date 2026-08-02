# Block 0 findings — competitor + upstream research (2026-08-02)

Scope filter: "quick AV-part design" = brackets, panel plates, connector cutouts (XLR, USB-C),
Gridfinity-compatible trays. A gap only counts if closing it shortens
*"make a bracket with a connector cutout and export it"*. General CAD parity is explicitly out of scope.

Every gap below was grep-verified against `apps/web/src` before being written down.
Tags: `[C]` = competitor gap, `[U#]` = upstream issue/PR number.

---

## 1. What SketchForge already has (do not re-task)

Verified present, so these are ruled out as roadmap items:

| Capability | Evidence |
| --- | --- |
| Align (editor + MCP) | `sketchforge_align_objects`, `toggleAlignMode` (`L`) |
| Mirror | `toggleMirrorMode` (`M`), `mirrorX/Y/Z` on `WorkplaneShape` |
| Duplicate, copy/cut/paste | `Ctrl+D/C/X/V` in `SketchForgeEditor.tsx:8617-8640` |
| Measure / ruler with edge+corner snapping | `moveDimensionLines.ts`, shipped for [U25] |
| Chamfer/fillet with reversible history | `edgeTreatmentHistory.ts`, `EdgeModifierPanel.tsx` |
| Boolean cut + intersection, group/ungroup, separate parts | MCP tools + editor |
| STEP B-Rep round-trip, SVG import→extrude, revolve, gears, text | `stepExport/stepImport`, `svgImport`, `sketchRevolve`, `gearGeometry` |
| Shared `.skf` project directory over HTTP | `api/shared-projects/route.ts` |
| Orthographic toggle (`O`), snap settings, per-shape inspector | README + `WorkspaceSettingsModal.tsx` |

## 2. Upstream issues and PRs (Formsmith746/SketchForge-3D)

Open issues (5 total — the tracker is small; this is the whole signal, not a sample):

- **[U51] Automatic distribute objects** — even spacing across a width. Maintainer: "may be added in
  the next update, which will focus on measurement and positioning tools."
- **[U50] Center object on the build plane** — button to center selection in X/Z (optionally Y).
  Maintainer: "It will be added to the roadmap!"
- **[U42] Desktop app** (Tauri/Electron) — maintainer defers to post-1.0. Out of scope for this fork.
- **[U32] Direct numeric keyboard input for transform** — type `25` + Enter during a move/rotate/scale,
  Tab between axes, on-screen overlay, Esc to cancel.
- **[U26] Scene inspector sidebar** — list of all shapes with show/hide, group, delete, select.
  Note: the existing `ShapeInspector.tsx` is a *per-shape property panel*, not a scene tree.

Notable closed/unmerged PRs:

- **[U29] Metric screw hole cutters — CLOSED, not merged.** M2–M6, socket/countersunk/button/pan/hex
  heads, clearance holes, heat-set insert pockets, hex nut traps, precise/standard/loose fits,
  through/blind. This is the single highest-value AV-part feature identified anywhere in this research
  and upstream declined it. Prime fork feature.
- **[U27] Sketching + theming + revolves + snapping + 3MF — OPEN.** Large, still unmerged. Touches
  the same files as most editor work → **keep our edits additive and out of the sketch pipeline**
  to avoid conflicts when it lands.
- Recently fixed upstream, so don't re-report: boolean subtraction [U33], fillet errors [U31],
  "preparing edges for an hour on a cube" [U21], hole missing from export [U52], sketch grid centering [U53].

## 3. Competitor gaps that matter for AV parts

Sources at the bottom.

### 3.1 Tinkercad — the "fast" bar
Ships `R` ruler, `W` workplane, `Shift+W` workplane on a face, `E` show-shape-workplane, `Ctrl+D`
duplicate-and-repeat, `L` align, `M` mirror. SketchForge matches all except:

- **[C] Duplicate-and-repeat pattern.** In Tinkercad, `Ctrl+D` then a transform, then repeated `Ctrl+D`
  replays the transform — an instant linear array. SketchForge's `Ctrl+D` duplicates in place only.
  Verified absent: `grep -ri pattern apps/web/src` hits only `svgImport.ts`; `distribute` → zero hits.
- **[C] Workplane on a face.** `placementWorkplane.ts` exists but there is no "set workplane from a
  selected face of a solid" path, which is how you place a connector cutout on a bracket wall.

### 3.2 Shapr3D / Plasticity — the "functional part" bar
- **[C] Shell / hollow to a wall thickness.** Missing. `grep -ri hollow` matches only the
  `HOLLOW_SUBTRACTION`/`HOLLOW_INTERSECTION` CSG modes from `three-bvh-csg` — those are open-mesh
  boolean flags, not a wall-thickness operation. Every enclosure workflow starts with shell.
- **[C] Offset face / adjust wall thickness.** Missing (`wallThickness` → zero hits).
- **[C] Loft / sweep.** Missing (`loft` → zero hits). Low priority for flat AV plates; noted, not tasked.

### 3.3 Onshape / Fusion — the "parametric" bar
- **[C] Named/parametric dimensions.** Shapes are baked numbers; there is no "make this 2 grid units"
  relationship. Full parametrics is a rewrite and violates the mergeability rule — **out of scope**.
  The cheap 80%: *generators* that emit correct geometry from parameters (Gridfinity, screw holes,
  connector cutouts), which is what the Fusion/Onshape Gridfinity add-ins actually do in practice.

### 3.4 Domain generators competitors ship that SketchForge lacks
- **[C] Gridfinity.** Standard is 42 mm × 42 mm grid, 7 mm height units. Onshape and Fusion both have
  community generators; several browser generators export STL/STEP/3MF. Zero hits in this repo.
- **[C][U29] Fastener holes.** Counterbore/countersink/heat-set/nut-trap. `counterbore`, `thread` →
  zero hits.
- **[C] Panel-connector cutouts.** No competitor ships XLR/USB-C cutouts as primitives either — this is
  a genuine differentiator for the Lumera fork, and it is just a parameterised hole shape.

## 4. Non-competitive gaps found while verifying

- **OBJ import is explicitly rejected** even though OBJ export ships:
  `page.tsx:996` and `SketchForgeEditor.tsx:8436` both bail on `sourceFormat === "obj"`.
  Import accept list is `.skf,.stl,.step,.stp,.svg` only.
- **STL import has no robustness layer.** `stlImport.ts` (109 lines) calls `STLLoader.parse` directly:
  no try/catch → a truncated or non-STL file surfaces a raw loader exception; no NaN/degenerate-triangle
  filtering; no triangle-count guard before the mesh reaches the CSG path; no unit heuristic
  (a metres-authored STL imports 1000× small with no warning).
- **MCP surface is 17 tools and read-thin.** No measure/distance query, no duplicate, no pattern,
  no mirror (`update_object` exposes position/size/rotation/color/hole/name only — not `mirrorX/Y/Z`,
  not lock/hide, not text or gear params), no named anchors, no undo, no save/export.

## 5. Ranked shortlist feeding Blocks 1–4

1. Screw-hole / fastener cutter generator [U29][C] — highest value, upstream declined it, additive.
2. Shell / wall thickness [C] — unblocks enclosures.
3. Gridfinity generator [C] — already a Block 3 goal, now with the 42/7 mm spec pinned.
4. Panel-connector cutout library (XLR, USB-C) [C] — fork differentiator, cheap once #1 lands.
5. Center-on-plate [U50] + distribute [U51] — small, wanted upstream, clean PR candidates.
6. Numeric transform entry [U32] — wanted upstream, but lands in the 9.8k-line editor; size carefully.
7. STL import hardening + OBJ import — correctness, cheap, clean PR candidates.
8. MCP: measure, pattern, mirror/flags on update, anchors.

## Sources

- [Best 3D Modeling & CAD Software for 3D Printing 2026](https://3dprinting.com/software-guides/best-3d-modeling-cad-software/)
- [Easiest CAD software: Top picks for beginners in 2026 — Shapr3D](https://www.shapr3d.com/content-library/easiest-cad-software-to-learn)
- [The Tinkercad alternative to level up your 3D design — Shapr3D](https://www.shapr3d.com/comparison/tinkercad-alternative)
- [Onshape vs. Shapr3D vs. Tinkercad Comparison](https://sourceforge.net/software/compare/Onshape-vs-Shapr3D-vs-Tinkercad/)
- [Keyboard Shortcuts for the 3D Editor — Tinkercad](https://www.tinkercad.com/blog/keyboard-shortcuts-for-the-3d-editor)
- [Advanced Features and Shortcuts in Tinkercad — Maker Pro](https://maker.pro/custom/tutorial/advanced-features-and-shortcuts-in-tinkercad)
- [Shell — Shapr3D Help Center](https://support.shapr3d.com/hc/en-us/articles/7874427098268-Shell)
- [Offset Face — Shapr3D Help Center](https://support.shapr3d.com/hc/en-us/articles/7874400678428-Offset-Face)
- [Gridfinity Sizes & Dimensions — 42mm Grid + 7mm Heights](https://gridfinitylayouttool.com/gridfinity-sizes)
- [Custom Feature: Gridfinity Bin & Base Generators — Onshape forum](https://forum.onshape.com/discussion/24405/custom-feature-gridfinity-bin-base-generators)
- [Gridfinity generator add-in for Fusion 360](https://github.com/tache/fusiongridfinitygenerator)
- Upstream tracker: `gh issue list --repo Formsmith746/SketchForge-3D --state all`
