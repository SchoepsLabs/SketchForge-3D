# NIGHTLOG

Newest entries on top. Template:
## YYYY-MM-DD — Block N
- Shipped:
- Blocked:
- PR candidates:
- Next:

## 2026-08-02 — Block 1, task 3 (center selection on the build plate)
- Shipped: new `lib/placeOnPlate.ts` (`placeSelectionOnPlate`, pure) + `tests/unit/placeOnPlate.test.ts`
  (14 cases), a `ToolbarCenterOnWorkplaneIcon` inline SVG, and a "Center on plate" button in the
  toolbar's Arrange section next to "Drop to workplane" (one section over from Align, where the
  roadmap wanted it). The fn takes pre-computed world bounds per shape rather than shapes, so the test
  never touches THREE or the mesh pipeline; the editor passes `meshAabb(shape)`, the same bounds the
  align control uses. Options cover `dropToPlate`/`plateY`/`plateCenterX`/`plateCenterZ`, but the
  button only centres X/Z — dropping already has its own button next to it, and keeping them
  orthogonal means "centre" never changes a part's height. The drop option is there for the Block 2/3
  generators that will want centre-and-seat in one call.
- Two decisions worth recording:
  (a) **Locked shapes.** Centring is a rigid translation onto a fixed target (the plate origin), so
  unlike Align there is no rule that both centres the selection and leaves a locked member in place —
  the two are mutually exclusive. Align gets away with it because `effectiveAlignmentAnchorId` promotes
  a locked shape to *the anchor*, making its own coordinate the target. So: locked shapes are excluded
  from the combined bounds and never moved, and the movable remainder is centred — the same
  skip-locked-and-move-the-rest semantics as `dropSelectedToWorkplane`, the button it sits beside. An
  all-locked selection reports `moved: 0` and the UI says "Selection is locked" rather than computing a
  bbox over an empty set (`Math.min()` of nothing is `Infinity`, which would fail silently downstream).
  (b) **One group delta, one epsilon check.** Align's per-shape `<= ALIGN_EPSILON` guard would be a bug
  here: every shape shares one delta, so a per-shape check could strand a shape whose own delta rounded
  small while its neighbours moved, shearing the selection apart. The already-centred check is made
  once on the group; there is a test named for exactly that case.
- Verified in the running editor (localhost:3001, MCP bridge) as well as in unit tests: two boxes
  spanning X 40..95 centred to x=-7.5/+22.5 with the 30 mm spacing intact, a second click reported
  "Already centered on the plate", and an imported mesh moved off-centre landed with its *mesh*
  footprint on the origin (x=-110, z=-210 for a mesh authored at 100..120 / 200..220) with its
  elevation untouched. That last one is the case the pure test `centres an off-centre imported mesh`
  covers, and it confirms centring has to use mesh bounds, not the shape position: `import_mesh` keeps
  the authored offset instead of recentring vertices.
- Follow-up in the same session: "centre never changes height" was a claim the first cut didn't quite
  honour — the elevation still went through `toFixed(4)` + `cleanNearZero` even when the delta was
  zero, so a shape sitting at 0.0003 would have been snapped to 0 by a *centring*. Rounding now only
  touches axes that actually move, with a test for it. Also grepped `WorkplaneViewport.tsx` and
  `ActionOverlays.tsx` for an existing centre-on-plate action before calling this new (Block 0 lesson):
  nothing there, so the upstream PR won't be duplicating a viewport-side control.
- typecheck + test (221) green.
- Blocked: nothing.
- PR candidates: this whole change (upstream issue #50 asks for it) — branch it off `main` in Block 4.
  It is self-contained: one new lib file, one new test, one icon, ~35 lines in the editor, no
  dependency on the STL/OBJ work.
- Next: Block 1 item 4 — distribute evenly, pure fn in new `lib/distributeShapes.ts` [U51].

## 2026-08-02 — Block 1, task 2 (OBJ import)
- Shipped: new `lib/objImport.ts` + `tests/unit/objImport.test.ts` (18 cases), wired into both import
  call sites (`page.tsx`, `SketchForgeEditor.tsx`), both `accept` lists, the drop-zone label, the two
  "import STL, STEP, and SVG separately" notices, `SUPPORTED_IMPORT_EXTENSIONS`, and — the one that
  would have shipped a half-feature — `skfProject.ts` `defaultSourceImporter`, which still threw
  "cannot reconstruct OBJ source assets yet". Without that branch an OBJ imports fine and the project
  fails to *reopen*, since source-backed shapes drop their positions on save. Covered by a new
  skfProject test that asserts the package holds no derived mesh, so the restored positions really do
  come from re-importing the stored bytes.
- Probed `three@0.184` OBJLoader before designing, which paid off twice. (a) It never throws: garbage
  yields an empty group plus one `console.warn` per unreadable line, and an out-of-range face index
  yields NaN vertices — so a truncated OBJ would have surfaced as the sanitizer's vague "invalid
  coordinates". `readObjSource` now validates the text first (empty, no `v` lines, per-face index
  range against the vertices declared above it, resolving negative indices the way OBJLoader does) and
  names the offending line. (b) OBJLoader tracks **one geometry type per object and the last element
  wins**, so a single `l` or `p` line returns that whole object — faces included — as LineSegments,
  and a mixed faces+edges file imports as *nothing*. Found by a failing test, not by reading. Fix:
  strip `l`/`p` lines before parsing, leaving `v` lines in place so every face index still resolves.
  Also skip non-Mesh children, so a stray annotation vertex cannot inflate the bounding box the shape
  is sized and recentred on.
- Reused `importedShapeFromTriangleSoup`, so OBJ inherits last session's NaN/degenerate filtering, the
  2M triangle ceiling, and `importScaleWarning` — which matters more here than for STL, since Blender
  exports metres by default. `onWarning` is wired at both call sites. Quads and n-gons fan-triangulate
  (cube fixture: 6 quads → 12 triangles, 20 × 20 × 20 mm), and a fixture shaped exactly like the
  editor's own `toObj` output — `o` blocks with a running vertex offset — round-trips, closing the
  export/import loop.
- Follow-up in the same session, third OBJLoader behaviour found by probing: `parse` folds `\r\n` and
  joins `\`-continued lines *before* it splits, so validating the raw text meant checking a different
  set of lines than the parser reads — a face continued across two rows left everything after the
  backslash unrange-checked, which is precisely the truncation case the check exists for.
  `readObjSource` now normalizes first (same `indexOf` guards OBJLoader uses, so a large file is not
  copied for nothing) and both the validation and `objLoader.parse` run on that one string.
  Regression tests: a continued hexagon face equals the inline one, an out-of-range index past a
  continuation is still named, and a continued `l` element still leaves the mesh intact.
- Also cleared the last place a format list could hide: MCP `import_mesh` takes raw triangle positions,
  not files, so it needs nothing.
- typecheck + test (206) green. The dead `defaultSourceImporter` fallback needed a `String()` because
  TS now narrows the format union to `never` there — a nice signal that all four formats are handled.
  Not smoke-tested through the browser file picker: verified the app compiles and serves on :3001, and
  the UI wiring is four small edits around the importer the tests exercise directly.
- Blocked: nothing.
- PR candidates: this whole change (upstream rejects OBJ at both call sites while shipping OBJ export)
  — branch it off `main` in Block 4, together with the STL hardening it depends on.
- Next: Block 1 item 3 — center selection on the build plane, pure fn in new `lib/placeOnPlate.ts`.

## 2026-08-02 — Block 1, task 1 (harden STL import)
- Shipped: `lib/stlImport.ts` hardened + `tests/unit/stlImport.test.ts` (22 cases). Probed the real
  `three@0.184` STLLoader first instead of reasoning about it, which changed the design twice:
  (a) `parse()` throws a bare `RangeError: Offset is outside the bounds of the DataView` for *any*
  buffer under 84 bytes, a truncated binary, or an oversized header — it reads the face count at byte
  80 with no bounds check; (b) an ASCII facet with a `NaN` vertex silently drops only that vertex, so
  the returned vertex list is not a whole number of triangles (5 vertices in the probe) and every
  later triangle is off by one. Now: `assertParsableStl` validates the binary framing before parse
  (mirroring `STLLoader.isBinary`'s size-match-before-"solid" order, so binary headers that happen to
  start with "solid" still work), `parse` is wrapped in try/catch, and `sanitizeTriangleSoup` drops
  non-finite and zero-area triangles, keeps normals index-aligned, discards the normal buffer if a
  survivor's normal is non-finite, and counts trailing dangling vertices. Triangle-count guard at 2M
  fires from the binary header before any allocation. `importScaleWarning` (pure, tested) flags
  metre-authored extents; surfaced through a new optional `onWarning` callback wired into both import
  call sites' existing notice strings. Sanitizing inside `importedShapeFromTriangleSoup` means STEP
  import gets the same hardening for free, so error text uses the `sourceFormat` label, not "STL".
  The 2M ceiling is enforced twice: from the binary header before any allocation, and again after
  sanitizing, which is the layer that actually covers ASCII STL and STEP. typecheck + test (183) +
  perf green; the 60k-triangle perf workload is unaffected.
- Checked the reload path (`skfProject.ts` `defaultSourceImporter` re-imports the stored source bytes
  on project open while the shape keeps its saved x/z), because filtering triangles changes the
  bounding box the mesh is recentred on. Probed the old behaviour rather than assuming: non-finite
  coordinates made `computeBoundingBox` return NaN, so the old import *threw* — no saved `.skf` can
  contain a NaN mesh and NaN filtering has no reload path at all. Degenerate facets inside the box
  (all of them in practice) leave recentring byte-identical; there is now a test asserting that.
  Residual, accepted: a project saved before this change whose STL had a stray zero-area facet
  *outside* the mesh box reopens slightly shifted — its stored extents were inflated by junk anyway.
- Blocked: nothing.
- PR candidates: this whole change (upstream has no try/catch around `STLLoader.parse` and no
  NaN/degenerate filtering) — branch it off `main` in Block 4.
- Next: Block 1 item 2 — OBJ import in new `lib/objImport.ts`, reusing `importedShapeFromTriangleSoup`
  (which now sanitizes, so the OBJ path inherits the hardening).

## 2026-08-02 — Block 0
- Shipped: Competitor + upstream research written to docs/research/2026-08-02-block0-findings.md
  (5 open upstream issues, closed-unmerged screw-hole PR #29, open PR #27 conflict risk; competitor
  gaps filtered to AV-part work and each grep-verified against apps/web/src before being recorded).
  Blocks 1–4 of ROADMAP.md rewritten into 26 concrete tasks, each with the files it touches, an
  acceptance check, and an evidence tag. Block 0 boxes ticked. typecheck + test green.
- Blocked: nothing. Second verification pass caught two bad claims in the first draft and both are
  fixed: keys are bound in WorkplaneViewport.tsx as well as SketchForgeEditor.tsx, and workplane-on-a-face
  already exists as Shift+W. Lesson for later blocks: grep both giant components, uncapped, before
  calling anything missing.
- PR candidates (upstream-useful, tagged for Block 4): STL import hardening (no try/catch around
  STLLoader.parse, no NaN/degenerate filtering), OBJ import (export ships but import is explicitly
  rejected at page.tsx:996 and SketchForgeEditor.tsx:8436), center-on-build-plate (#50),
  distribute evenly (#51), numeric transform entry (#32).
- Next: Block 1 first item — harden STL import in lib/stlImport.ts with tests/unit/stlImport.test.ts.
