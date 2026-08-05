# ROADMAP — one month, autonomous blocks

Goal: fast, easy to use, smart AI-assisted 3D designer on the Lumera fork.

Blocks 1–4 were rewritten on 2026-08-02 from Block 0 research.
Evidence for every task: [docs/research/2026-08-02-block0-findings.md](docs/research/2026-08-02-block0-findings.md).
Tags: `[C]` competitor gap, `[U#]` upstream issue/PR, `[§n]` findings section.

Sizing rules applied: each task is one session or less; tasks prefer **new files** in
`apps/web/src/lib/` over edits to `WorkplaneViewport.tsx` (7.6k lines) and
`SketchForgeEditor.tsx` (9.9k lines) — those two are big enough that any task landing inside them is
larger than it looks, and additive changes also keep upstream merges clean.
Upstream PR #27 (sketching/theming/revolve/snapping) is open and touches those same files —
stay out of the sketch pipeline.

## Block 0 — Research & refine this roadmap (week 1)
- [x] Research competitors online: Tinkercad, Shapr3D, Plasticity, Fusion personal, Onshape free — list features SketchForge lacks that matter for quick AV-part design
- [x] Read upstream GitHub issues + PRs for feature requests and known pain points
- [x] Rewrite Blocks 1–4 below into concrete scoped tasks based on findings; keep each task <1 session

## Block 1 — Speed & UX quick wins (week 1–2)

- [x] **Harden STL import** — `lib/stlImport.ts` + new `tests/unit/stlImport.test.ts`. Wrap
      `STLLoader.parse` in a try/catch that surfaces a readable message, drop NaN/degenerate triangles,
      guard on triangle count before the mesh reaches CSG, and warn when extents look metre-authored.
      *Accept:* tests cover truncated binary, ASCII with NaN, zero-area triangles; no raw loader
      exception escapes. **PR candidate.** [§4]
- [x] **Add OBJ import** — new `lib/objImport.ts` reusing `importedShapeFromTriangleSoup`; extend
      `SUPPORTED_IMPORT_EXTENSIONS` and the two `sourceFormat === "obj"` rejections
      (`page.tsx:996`, `SketchForgeEditor.tsx:8436`) plus the `accept` lists.
      *Accept:* a cube.obj fixture imports with the right triangle count and bounds; OBJ export already
      ships, so this closes the round-trip. **PR candidate.** [§4]
- [x] **Center selection on the build plane** — pure fn in new `lib/placeOnPlate.ts` (center X/Z,
      optional drop to Y=0), button next to the existing align control.
      *Accept:* unit test on the pure fn for single + multi-selection; button centers an imported STL in
      one click. **PR candidate.** [U50]
- [ ] **Distribute evenly** — pure fn in new `lib/distributeShapes.ts` (even spacing along X or Z,
      by gap or by span), wired into the align overlay.
      *Accept:* unit test for 3+ objects of differing widths, gaps equal within 1e-6; end objects unmoved.
      **PR candidate.** [U51]
- [ ] **Linear array / duplicate-repeat** — pure fn in new `lib/patternShapes.ts` (count + per-step
      delta X/Z/elevation/rotation), reachable from duplicate so repeated `Ctrl+D` replays the last
      transform the way Tinkercad does.
      *Accept:* unit test for count=5 linear and count=6 circular; array of 20 M3 bosses placed in one
      action. Consumed again by Block 2. [C §3.1]
- [ ] **Shortcut audit + fit-to-selection** — *(2026-08-05: the audit and `docs/SHORTCUTS.md` shipped
      with Block 5; what remains here is `Shift+F` fit-to-selection.)* keys are bound in two files, not one: the editor block
      (`SketchForgeEditor.tsx:8560-8710`, plus the edge-modifier handler at :7343) and the viewport
      block (`WorkplaneViewport.tsx:4717-4753` — `W`/`Shift+W` workplane, `F`/`Home` reset view,
      `O` ortho, `+`/`-` zoom). Write `docs/SHORTCUTS.md` covering both. The one real gap: `F` resets
      the whole view; there is no fit-*selection*-to-view.
      *Accept:* doc lists every bound key across both files and matches the code; `Shift+F` frames the
      current selection and leaves plain `F` as-is. [C §3.1]
- [ ] **First-load performance baseline** — record route JS sizes and OCCT/Manifold WASM fetch timing
      into new `docs/perf/BASELINE.md`, then name the top three payload contributors and whether the
      WASM kernels load eagerly or on demand.
      *Accept:* baseline numbers committed with the command used to get them; one concrete deferral
      candidate identified with an estimated saving. (Fix lands as its own task.)
- [ ] **Large-model performance** — extend `tests/perf/stl-import.perf.ts` to a 500k-triangle fixture
      and record import + first-boolean timings in the same baseline doc.
      *Accept:* `npm run perf` reports both numbers; any step over ~2 s is called out with its hot path.

## Block 2 — Smarter AI designer via MCP (week 2–3)

Current surface is 17 tools. Each task = protocol type + store handler + server schema, all additive.

- [ ] **`sketchforge_measure_distance`** — distance between two objects by anchor keyword
      (`center`, `min`/`max` per axis, bbox corners), returning per-axis and euclidean values.
      *Accept:* two boxes 30 mm apart report 30 on the right axis; the AI can verify a fit without a screenshot.
      [§4]
- [ ] **Named anchors in placement** — let `create_shape` / `update_object` take
      `anchorTo: { id, anchor, offset }` instead of raw coordinates, resolved through the same bbox
      helper as the measure tool.
      *Accept:* "put an M3 boss on the top-right corner of the bracket" lands within 1e-6 of the corner.
- [ ] **`sketchforge_pattern_objects`** — expose `lib/patternShapes.ts` (linear + circular) over MCP.
      *Accept:* one call produces 6 evenly spaced holes on a bolt circle. [C §3.1]
- [ ] **Widen `sketchforge_update_object`** — it currently exposes position/size/rotation/color/hole/name
      only. Add `mirrorX/Y/Z`, `locked`, `hidden`, `text`, `font`.
      *Accept:* each new field round-trips through `read_scene`. [§4]
- [ ] **`sketchforge_create_fastener_hole`** — MCP front end for the Block 3 screw-hole generator.
      *Accept:* "M3 countersunk clearance hole, through" produces a cutter that groups into a clean
      opening. [U29][C §3.4]
- [ ] **`sketchforge_create_gridfinity`** — MCP front end for the Block 3 Gridfinity generator.
      *Accept:* a 2×3×6U bin comes back at 84 × 126 × 42 mm. [C §3.4]
- [ ] **Better `sketchforge_inspect_errors`** — return the last N editor notices with a stable code, the
      offending shape ids, and the operation that failed, instead of free text.
      *Accept:* a failed boolean reports code + both operand ids; an AI can retry from the payload alone.

## Block 3 — Generators & parts library workflows (week 3–4)

Theme sharpened by research: the practical substitute for full parametrics is *generators that emit
correct geometry from parameters* — which is what the Fusion/Onshape Gridfinity add-ins actually are.
All generators emit groups of **existing primitives** marked as holes/solids, so no `.skf` format
change and no new shape kind is needed.

- [ ] **Fastener hole generator** — new `lib/fastenerHoles.ts`: M2–M6, clearance fits
      (precise/standard/loose), socket/countersunk/button/pan heads, heat-set insert pockets, hex nut
      traps, through vs blind. Upstream closed PR #29 unmerged, so this is fork-owned.
      *Accept:* unit tests assert shaft/head diameters against the metric table; grouping an M3
      countersunk cutter into a 5 mm plate leaves a clean opening. [U29][C §3.4]
- [ ] **Shell / wall thickness** — new `lib/shellSolid.ts`: for box/cylinder/tube primitives, generate an
      inner cutter inset by the wall thickness with optional open faces.
      *Accept:* a 40×40×30 box shelled at 2 mm yields 2 mm walls measured through the MCP measure tool;
      documented as primitive-only (no general mesh offset). [C §3.2]
- [ ] **Gridfinity generator** — new `lib/gridfinity.ts`, 42 mm grid / 7 mm height units, baseplate +
      bin, u-count parameters.
      *Accept:* 2×3×6U bin measures 84 × 126 × 42 mm; a printed base accepts a stock bin. [C §3.4]
- [ ] **Panel connector cutouts** — new `lib/panelCutouts.ts` for XLR (Neutrik D-series) and USB-C
      panel-mount. First step of the task is pinning the real dimensions from the manufacturer drawing;
      record them as constants with the source in a comment.
      *Accept:* cutout dimensions traceable to a cited drawing; test locks the constants. Fork
      differentiator — no competitor ships these. [C §3.4]
- [ ] **Save-to-shared flow** — smooth `.skf` save into the mounted `lumera-sketchforge-parts` library
      (`api/shared-projects/route.ts`): overwrite confirmation, clear error when
      `SKETCHFORGE_SHARED_PROJECTS_DIR` is unset, save-and-stay.
      *Accept:* saving an existing part name twice never silently duplicates or clobbers; unset env var
      gives an actionable message.
- [ ] **Starter templates** — new `templates/` with Gridfinity base, XLR well, USB-C tail as `.skf`
      files produced by the generators above.
      *Accept:* each opens in the editor and exports to STL without a notice.
- [ ] **Auto-updated `LIBRARY.md`** — new `scripts/build-library-index.mjs` scanning the shared parts dir
      plus `templates/`, writing name/size/updated/thumbnail rows.
      *Accept:* running it after adding a part updates the index; re-running is a no-op (idempotent).

## Block 4 — Polish & upstream PRs (week 4)

- [ ] **Cherry-pick PR candidates onto branches off clean `main`** — expected set: STL import hardening,
      OBJ import, center-on-plate [U50], distribute [U51], plus anything NIGHTLOG tagged during the month.
      *Accept:* one branch per fix off `main`, each typecheck+test green in isolation, PR body linking
      the upstream issue.
- [ ] **Numeric transform entry** [U32] — type a value during move/rotate/scale, Tab between axes,
      Esc cancels. Lands inside `TransformOverlay.tsx` + the editor keydown block; keep the parsing in a
      new `lib/transformNumericInput.ts` so the tested part sits outside the giant files.
      *Accept:* unit tests for parsing (negatives, decimals, `X=10` form); Esc restores the pre-edit
      transform. Sized last because of where it lands. **PR candidate.**
- [ ] **Upstream drift check** — re-read new upstream issues/PRs (especially whether #27 merged) and
      re-run the Block 0 verification greps so no month-2 task duplicates shipped work.
      *Accept:* findings doc gets a dated delta section.
- [ ] **Green pass + month 2** — `npm run typecheck`, `npm run test`, `npm run perf` against the Block 1
      baseline; update this roadmap for month 2.
      *Accept:* all green, perf numbers compared to baseline, month-2 blocks written.

## Block 5 — Tinkercad parity & UI polish (added 2026-08-04 from live session)

Context: the 2026-08-04 live session shipped mouse-scheme presets, workplane opacity,
cursor-follow ghost placement with face cruising (revived `cruiseShapes`), and a Split parts
toolbar button — see NIGHTLOG 2026-08-04. These tasks finish that arc. Research spec for the
Tinkercad interactions (sources cited): the cruise/placement notes in that NIGHTLOG entry.

- [x] **Ghost for drag-and-drop path** — `handleDrop`/`onDragOver` currently show only the browser
      drag image; drive the same `syncShapePlacementGhost` from `onDragOver` so drag-in and
      click-to-place look identical, including face cruising.
      *Accept:* dragging Box from the panel shows the translucent ghost cruising onto faces before drop.
- [x] **Smart duplicate (Ctrl+D transform replay)** — supersedes the Block 1 "Linear array /
      duplicate-repeat" task; same `lib/patternShapes.ts` plan, but wire it Tinkercad-style: after a
      duplicate, any transform applied to the copy is memorized and each further Ctrl+D re-applies it.
      *Accept:* unit test on the pure replay fn; 5 evenly spaced copies in 5 keypresses. [C §3.1]
- [x] **Post-placement polish** — after ghost placement: arrow keys nudge by one snap step
      (Ctrl+arrows for elevation, Shift for 10×) if not already bound; audit against the editor keydown
      block first (Block 0 lesson: grep before building).
      *Accept:* `docs/SHORTCUTS.md` (Block 1 task) documents whatever this lands.
- [x] **Right-click context menu** — new `components/workplane/ContextMenu.tsx`; right-click on a
      selection (release without orbiting, <5 px movement) offers: Duplicate, Delete, Group/Ungroup,
      Split parts, Hole/Solid toggle, Lock, Hide, Drop to workplane, Center on plate — every action the
      toolbar has plus the inspector-only ones, one click closer.
      *Accept:* menu never fires after an orbit-drag; every entry reuses existing editor callbacks.
- [x] **Hole/Solid + Lock in the toolbar** — the two most-used inspector-only toggles, surfaced in the
      Modify group with pressed-state styling like Chamfer/Fillet.
      *Accept:* toggling hole on a selection without opening the inspector.
- [ ] **Icon unification pass** *(2026-08-05: inventory done — 19 PNG `<img>` icons + 3 sprite crops;
      deferred, its acceptance is a visual diff against `docs/media/` and that session had no browser.
      See NIGHTLOG 2026-08-05 for the ordered plan.)* — toolbar mixes PNG command images, sprite crops, and inline SVG;
      redraw the PNG/sprite stragglers as inline `currentColor` SVGs in `icons.tsx` so dark theme and
      hover states render crisply everywhere.
      *Accept:* no `<img>`-based toolbar icons left; dark/light theme both clean; no visual regression
      on the sections screenshot in `docs/media/`.
- [x] **Toolbar shortcut hints** — append the bound key to every toolbar tooltip ("Fillet (Shift+F)"
      style) sourced from the same table `docs/SHORTCUTS.md` is generated from, so the two never drift.
      *Accept:* tooltip text derived from one shared constants module, not hand-typed twice.
- [x] **Background-tab-proof MCP heartbeat** — Chrome throttles main-thread timers in hidden tabs to
      ~1/min, outliving `SKETCHFORGE_MCP_STALE_MS` (6.5 s), so the bridge dropped the editor whenever
      the window was minimized (hit live 2026-08-04 pushing a mesh in). Fixed same night: heartbeat +
      poll ticks now come from an inline dedicated Web Worker (worker timers are not
      visibility-throttled), main-thread intervals kept only as fallback.
      *Verified:* editor hidden, heartbeating 20 s+, `sketchforge_import_mesh` landed a 384-tri mesh.

## Block 6 — In-editor Claude chat dock (added 2026-08-04, Marty's ask: design without alt-tabbing)

Goal: a collapsible chat panel inside the editor, powered by **the locally installed Claude Code
CLI in headless print mode** — `claude -p` runs on Marty's existing subscription, so **no API key
and no per-token billing**. The spawned Claude gets scene tools via the repo's own
`scripts/sketchforge-mcp-server.mjs` (`--mcp-config`), i.e. the exact tool layer the desktop
bridge already uses — nothing hand-written twice. Direct Anthropic-API mode stays as an optional
fallback if `ANTHROPIC_API_KEY` is ever set.

- [x] **Assistant backend route** — new `app/api/assistant/route.ts`: spawns
      `claude -p --output-format stream-json --mcp-config <sketchforge server> --allowedTools "mcp__sketchforge__*"`
      with the user message, streams stdout deltas to the client, `--resume <sessionId>` for
      conversation continuity across dock messages. Detect a missing `claude` binary and return an
      actionable message (install command) instead of a 500. Server-side only, dev-mode only
      (same `localOnly` guard as the MCP route). Optional `ANTHROPIC_API_KEY` branch = direct
      Messages API with the same streamed shape.
      *Accept:* dock replies stream on a machine with only Claude Code installed — no key anywhere;
      follow-up messages keep context via --resume.
- [x] **Chat dock panel** — new `components/assistant/AssistantDock.tsx`, right-side collapsible
      dock (like the inspector), message list + input, streaming render, busy state while the CLI
      turn runs. Keyboard: Enter sends, Shift+Enter newline, Esc collapses.
      *Accept:* dock never overlaps the inspector; collapsed state persists in localStorage.
- [x] **Tool round-trip through the bridge** — the spawned CLI acts on the scene via the
      sketchforge MCP server, which talks to the dev server's existing command queue — so the dock's
      Claude edits the same live editor the user is looking at. Surface each executed tool call as a
      one-line entry in the transcript (parse stream-json tool_use events).
      *Accept:* "add a 20mm box at the origin and fillet the top edges" typed in the dock lands in
      the visible scene, with the tool calls listed in the transcript.
- [x] **Iteration checkpoints + version selector** (Marty's ask) — snapshot the shape state before
      each assistant edit batch (reuse `editorHistory` snapshots; tag them `assistant#N` with the
      prompt text). Dock header gets a version dropdown listing iterations; picking one restores that
      snapshot (a restore is itself undoable). This gives "try it again from iteration 3" without
      touching manual undo.
      *Accept:* three assistant edits → dropdown shows v1/v2/v3 + current; restoring v1 then undoing
      returns to v3's state; manual edits between iterations survive in the history chain.
- [x] **Session context** — system prompt includes scene summary (shape list w/ dimensions, active
      workplane, snap grid, units) rebuilt per request, so the assistant sees what's on the plate
      without a read tool round-trip. Token-guard: summarize past 20 shapes.
      *Accept:* "make the cylinder as tall as the box" resolves without the model asking which cylinder.

## Block 7 — One-place co-design polish (added 2026-08-05 after Block 6 shipped)

Goal: the dock stops being a generic CAD operator and becomes Marty's shop assistant, and
work done in the editor stops being ephemeral.

- [x] **H2D shop knowledge in the dock** — `docs/assistant/H2D_DESIGN_PROFILE.md` (already
      written) gets appended to the assistant system prompt alongside the scene summary.
      *Accept:* "add a mounting plate with M3 holes" produces Ø3.4 holes and ≥1.24 walls
      without being told; asking for a mating sleeve prompts for the measured bore or offers
      a gauge, never guesses.
- [x] **Autosave / crash-proof scenes** — the ephemeral editor loses everything on reload
      (the M3 spacer vanished this way). Autosave the working scene to localStorage or a
      draft `.skf` every N commits of history, restore-on-load with a "resume draft?" notice.
      *Accept:* kill the tab mid-design, reopen, scene comes back.
- [x] **Save-to-shared flow** (pulled forward from Block 3) — smooth `.skf` save into the
      mounted `lumera-sketchforge-parts` library: overwrite confirmation, clear error when
      `SKETCHFORGE_SHARED_PROJECTS_DIR` unset, save-and-stay. The dock gets a
      `save the project as <name>` capability through the same path.
      *Accept:* saving twice never silently duplicates or clobbers; dock can save by name.
- [x] **Print handoff** — one action (toolbar + dock tool) that exports the scene/selection
      as STL into a configurable watched folder (default: the shared parts library's
      `outbox/`), named `<project>-<date>.stl`, ready for Bambu Studio.
      *Accept:* "send it to print" in the dock lands an STL in the outbox with sane naming.
- [x] **Assistant session log** — append each dock conversation (prompt, tool calls, result)
      to `NIGHTLOG-style docs/assistant/SESSIONS.md` so overnight runs and the desktop
      Claude can see what was designed in the dock and why.
      *Accept:* log entry per conversation with timestamp, prompts, and executed actions.

### Deliberately out of scope this month
- Full parametric constraint solver (rewrite; breaks the mergeability rule) — generators cover the 80%. [§3.3]
- Desktop app [U42] — upstream defers it to post-1.0.
- Loft/sweep [C §3.2] — low value for flat AV plates.
