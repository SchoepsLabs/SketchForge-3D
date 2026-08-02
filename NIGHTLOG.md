# NIGHTLOG

Newest entries on top. Template:
## YYYY-MM-DD — Block N
- Shipped:
- Blocked:
- PR candidates:
- Next:

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
