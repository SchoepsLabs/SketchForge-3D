# NIGHTLOG

Newest entries on top. Template:
## YYYY-MM-DD — Block N
- Shipped:
- Blocked:
- PR candidates:
- Next:

## 2026-08-05 — Block 7, task 4 (print handoff)
- Shipped: new `lib/printOutbox.ts` + `app/api/print-outbox/route.ts` (14 tests), a "Send to print"
  toolbar button in the Arrange group with a new inline SVG icon, and `sketchforge_send_to_print`
  over MCP. Scene, or the selection when there is one; holes are excluded like every other export.
- Outbox location: `SKETCHFORGE_PRINT_OUTBOX_DIR`, defaulting to `<shared parts library>/outbox/` so
  the existing Docker mount covers both. Unconfigured returns an actionable message naming both
  variables rather than inventing a folder.
- Two things a **folder watcher** cares about, both tested: (a) the STL is written to a temp name and
  then renamed — rename is atomic, so Bambu Studio can never pick up a half-written file and start
  slicing it; (b) a second send of the same part on the same day becomes `-2`, because clobbering the
  first print or failing the second are both worse than naming it. The route also rebuilds the file
  name from `path.basename` + sanitiser, so `?fileName=../../escape.stl` cannot leave the outbox
  (there is a test for that).
- Verified live against the running dev server with the outbox pointed at a scratch dir: two sends
  produced `SketchForge design-2026-08-05.stl` and `SketchForge design-2026-08-05-2.stl`, 113 bytes
  each, no `.tmp` left behind.
- **Not** verified end-to-end from the dock, and the reason is worth writing down: `send it to print`
  in the dock returned *"Unknown MCP command: send_to_print"*. That is not a bug — the open editor tab
  was still running the JS bundle it loaded **before** I restarted the dev server (I had to restart it
  to inject the outbox env var), and a tab keeps its old bundle until it reloads. The MCP bridge
  reconnects across a server restart, so the tab *looks* healthy while its command handler table is
  stale. Lesson for future live checks: **after restarting the dev server, the editor tab must be
  reloaded before testing any newly added MCP command** — the heartbeat reconnecting is not evidence
  the tab has the new code.
- typecheck + test (414) green.
- Blocked: nothing (the dock round-trip needs a tab reload, which needs the browser).
- Next: Block 7 task 5 — assistant session log.

## 2026-08-05 — Block 7, task 3 (save-to-shared flow + dock save tool)
- Shipped: new `lib/sharedProjectSave.ts` (13 tests), named conflict reasons in
  `api/shared-projects/route.ts`, an overwrite confirm bar in the editor, and
  `sketchforge_save_project` over MCP. New `tests/unit/sharedProjectsRoute.test.ts` drives the real
  route against a real temp directory (6 cases).
- **The bug worth naming:** saving under a name that already existed was *impossible*. The client
  always sent `If-None-Match: *`, and the route answered every 409 with "The shared project changed
  after you opened it" — wrong for that case (nothing changed; the name is simply taken) and offering
  no way forward. The route now distinguishes `name-taken` / `stale-revision` / `missing` / `locked` /
  `disabled`, and only `name-taken` comes back with the revision an overwrite would have to match.
- Flow now: first save is create-only → if the name is taken the editor **keeps the packaged bytes**
  (so answering doesn't repackage the project) and shows a confirm bar → "Overwrite" re-sends with
  `If-Match` against exactly the revision the server named. A stale revision still refuses, so a real
  lost update is still impossible — there is a test for precisely that distinction.
- `SKETCHFORGE_SHARED_PROJECTS_DIR` unset now says which variable to set and that the server must
  restart, rather than "Shared project storage is disabled".
- **Save-and-stay already worked** — the export panel only sets a notice and stays open. Checked
  before writing anything; nothing to change. (Roadmap item satisfied by existing behaviour.)
- Dock capability: `sketchforge_save_project` goes through the same path as the toolbar. It creates
  by default and, on a collision, returns an error telling the assistant to ask the user and call
  again with `overwrite: true` — the dock never silently replaces a part. `.skf` packaging is now one
  helper (`packageSkfBytes`) shared by the export panel and the tool, instead of two copies.
- typecheck + test (400) green.
- Blocked: nothing.
- Next: Block 7 task 4 — print handoff (STL into a watched outbox).

## 2026-08-05 — Block 7, task 2 (autosave / crash-proof scenes)
- Shipped: new `lib/sceneDraft.ts` (pure, 12 tests) + `components/workplane/SceneDraftGuard.tsx`,
  mounted in the editor with one block of props. The scene autosaves to localStorage on a 1.2 s
  debounce (a drag commits many times; that writes once), and a load that finds work in the draft
  shows a "Resume / Discard" bar. This is the fix for the failure that bit us this month — the
  MCP-imported M3 spacer that vanished on a Fast Refresh.
- The rule that keeps it from being annoying is `already-current`: if the editor restored the same
  scene from the project store, the draft adds nothing and **no prompt appears**. The notice only
  shows when the draft holds work the editor does not — which is exactly the crash case. Tests name
  all five decisions (no-draft / empty / stale / other-project / already-current).
- Two deliberate calls: (a) a draft from a *different saved project* is never offered, but a draft
  from the **unsaved scratch scene** (`projectId: null`) is offered anywhere, because that is the one
  that keeps getting lost; (b) resuming goes through `commitShapes`, so it lands as one undoable step
  like the assistant checkpoints do.
- Quota: a scene with big imported meshes can exceed localStorage's ~5 MB. `serializeSceneDraft`
  returns `too-large` rather than throwing inside a failed write, and the editor says "save the
  project to keep it" **once** instead of silently not autosaving. There is a test with a
  400k-element mesh for it.
- Verified indirectly: after the hot reload the open editor (84306) was still heartbeating with its
  scene intact, so the new component doesn't break the editor. **Owed:** the actual acceptance —
  kill the tab mid-design and reopen — needs a browser, and this session still can't pick between the
  two connected Chromes. That is the one thing to try first next visually-supervised session.
- typecheck + test (382) green.
- Blocked: nothing.
- Next: Block 7 task 3 — save-to-shared flow (overwrite confirmation, clear error when
  `SKETCHFORGE_SHARED_PROJECTS_DIR` is unset, save-and-stay, plus a dock capability).

## 2026-08-05 — Block 7, task 1 (H2D shop profile in the dock)
- Shipped: new `lib/assistantDesignProfile.ts` + a profile section in `buildAssistantSystemPrompt`,
  wired into `api/assistant/route.ts`. 11 tests.
- Design decision: the profile is read **per request** rather than baked into the prompt builder, so
  editing `docs/assistant/H2D_DESIGN_PROFILE.md` changes the next reply with no rebuild, and none of
  it reaches the client bundle. A missing profile is not an error — the dock still works, it just
  loses the shop rules. 20k-char clamp so a runaway profile can't crowd out the scene summary.
- Ordering matters and there is a test for it: the profile goes **before** the scene summary. The
  profile is standing constraints on every dimension chosen; the scene is current state, and its
  section already says "trust it over anything earlier".
- **Verified live** on editor 84306 with the roadmap's acceptance prompt and nothing more — "add a
  mounting plate with four M3 clearance holes, 60x40mm". Unprompted, it produced: **Ø3.4** cutters
  (M3 clearance + the profile's +0.2 mm vertical-hole compensation), a 3 mm plate (≥0.9 floor rule),
  and cutters at `height: 7, elevation: -2` so they overshoot both faces of a 3 mm plate — the
  profile's cutter rule, quoted almost exactly. It then boolean-cut and renamed the result to one
  object. Test objects deleted afterwards; the pre-existing Group was left untouched (I listed the
  scene first and only deleted ids matching my own prefix).
- Note for the next session: the dev server was **not** running on 3001 when this session started
  (only the Docker prod container on 3000), so I started it. The editor tab reconnected on its own
  with its scene intact — the Web Worker heartbeat from 2026-08-04 did its job across a server restart.
- typecheck + test (370) green.
- Blocked: nothing.
- Next: Block 7 task 2 — autosave / crash-proof scenes.

## 2026-08-05 — Block 5, task 7 (toolbar shortcut hints) + task 6 blocked
- Shipped task 7: new `lib/shortcutHints.ts` is the one table; `renderToolButton` builds every tooltip
  from it, and a test asserts each key in the table also appears in `docs/SHORTCUTS.md` — so the
  tooltip and the doc cannot drift, which is exactly what the acceptance asked for ("derived from one
  shared constants module, not hand-typed twice"). 7 tests.
- **The roadmap's own example doesn't exist.** It suggested `"Fillet (Shift+F)"`, but the audit for
  SHORTCUTS.md found Chamfer and Fillet have **no** binding: `F` resets the view (viewport handler)
  and `Shift+F` is reserved for Block 1's fit-to-selection. Buttons with no key keep their bare label
  rather than advertising one that does nothing.
- Details worth keeping: Hole/Solid and Lock advertise the key for the direction they would *apply*
  (a solid selection reads "Make hole (H)"); macOS renders ⌘/⇧/⌫ glyphs, resolved **after mount**
  because the server render has no `navigator` and a differing tooltip would be a hydration mismatch;
  and the tooltip is now the `aria-label` too, so the key reaches screen readers instead of only
  hover.
- **Task 6 (icon unification) — not attempted, and deliberately so.** The inventory: 19 toolbar icons
  are `<img>` PNGs under `public/assets/sketchforge/` (`toolbar-copy.png`, `toolbar-group.png`,
  `toolbar-chamfer.png`, …), 3 are sprite crops (`ToolbarShapeAddIcon`, `ToolbarHideSelectedIcon`,
  `ToolbarAlignIcon`), the rest are already inline SVG. That is 22 pieces of Marty's chosen toolbar
  art to redraw by hand, and the task's own acceptance is a **visual** one — "no visual regression on
  the sections screenshot in `docs/media/`" (the v0.8.0 editor screenshot). With no browser this
  session (two Chromes connected; the extension needs a manual pick before any automation), 22 blind
  redraws of the app's visual identity could only be checked by the next person to open the editor.
  Shipping half of them would be worse than either end state — a toolbar mixing my line-art with the
  existing art reads as broken rather than unfinished. Logged and skipped per the "log it and move on"
  rule; the two icons this session *did* add (`ToolbarHoleIcon`, `ToolbarLockIcon`) are already inline
  `currentColor` SVG, so they need no rework when the pass happens.
  Plan for next session, in order: (1) open the editor and screenshot the toolbar at both themes as a
  before; (2) redraw the 3 sprite crops first — they are the smallest and the sprite sheet can then be
  dropped entirely; (3) the 19 PNGs in groups of ~5, screenshotting after each group; (4) delete the
  unused PNGs and the `toolbar-command-icon` CSS only once nothing references them.
- typecheck + test (359) green.
- Blocked: task 6 only, on visual verification (see above).
- Next: Block 5 is otherwise complete. Remaining across the roadmap: Block 1's distribute-evenly,
  fit-to-selection (`Shift+F`) and the perf baselines, then Block 2's MCP surface — for which
  `lib/patternShapes.ts` is now waiting.

## 2026-08-05 — Block 5, task 5 (Hole/Solid + Lock in the toolbar)
- Shipped: two entries in the toolbar's Modify group next to Chamfer/Fillet, using the same
  `active` → `.toolbar-icon.active` pressed styling, plus new `ToolbarHoleIcon`/`ToolbarLockIcon`
  drawn as **inline `currentColor` SVGs** — the direction task 6 (icon unification) is heading, so
  these two do not have to be redrawn later.
- Both labels flip with the state (Make hole / Make solid, Lock / Unlock) and both call the same
  editor callbacks the inspector and the new context menu use. Same two rules as the context menu:
  hole/solid reads "**all** of the selection" so a mixed selection shows as solid and one press makes
  it all holes, and it is disabled on a locked selection; Lock stays enabled while locked.
- Caught on the way past: `EditorLoadingSkeleton` in `page.tsx` hardcodes how many shimmer buttons
  each toolbar section has, and `combine` was still at 3 — stale since Split parts was added on
  2026-08-04. Fixed both (combine 3→4, modify 5→7) so the loading placeholder matches the real bar.
  Worth remembering: **any toolbar button added in `SketchForgeEditor.tsx` needs that count updated**,
  and nothing enforces it.
- typecheck + test (352) green.
- Blocked: nothing.
- Next: Block 5 task 6 — icon unification pass (replace the PNG/sprite toolbar icons with inline SVG).

## 2026-08-05 — Block 5, task 4 (right-click context menu)
- Shipped: `components/workplane/ContextMenu.tsx` (presentational), `lib/workplaneContextMenu.ts`
  (entry list + enablement, 8 tests), gesture detection in `WorkplaneViewport.tsx`, and the item
  wiring in `SketchForgeEditor.tsx`. Entries: Duplicate, Delete · Group, Ungroup, Split parts ·
  Make hole/Make solid, Lock, Hide · Drop to workplane, Center on plate.
- **"Never fires after an orbit-drag" is the whole task.** The right button also orbits or pans
  (scheme-dependent), and the browser fires `contextmenu` at the *end* of that drag anyway — on
  Windows at button-up, on macOS/Linux at button-down. Timing therefore can't be the test, so the
  viewport records where the right button went down (`onPointerDownCapture`) and only raises the menu
  when the pointer moved **< 5 px**, the same slack the click-to-place gesture already uses. That one
  rule covers both platform timings. The menu also stays quiet during workplane placement, shape
  placement, edge picking and the three ruler modes.
- Note for anyone touching this: the canvas already has its own `contextmenu` → `preventDefault`
  listener (so right-drag orbit doesn't pop the browser menu), added inside `createThreeState`. The
  event still bubbles to the React host div, which is where the new handler sits — no need to modify
  that listener.
- Every entry reuses an existing callback (`duplicateSelected`, `deleteSelected`, `groupSelected`,
  `ungroupSelected`, `separateSelectedParts`, `setSelectionHoleMode`, `toggleLocked`, `toggleHidden`,
  `dropSelectedToWorkplane`, `centerSelectedOnPlate`), and enablement mirrors the toolbar's rule for
  each — `canGroup`, `canUngroup`, `canSeparateParts` are the same expressions the toolbar props use.
  Two deliberate exceptions: **Lock stays enabled while locked** (it is the way back out), and
  hole/solid is one toggle showing whichever direction the selection is not already in.
- Right-clicking an unselected shape selects it first (via the viewport's existing `pickShape`), the
  way every other app behaves; right-clicking empty space with nothing selected opens nothing.
- Placement gotcha handled in the component: it measures itself in `useLayoutEffect` and flips back
  inside the window, so a right-click near the right or bottom edge doesn't open a half-off-screen
  menu. It closes on Esc, outside pointerdown (capture phase), wheel, and window blur.
- typecheck + test (352) green.
- Owed: not clicked in a browser this session (same browser-selection block). The orbit-suppression
  rule is the part that most deserves a live check — right-drag to orbit, release, and confirm no menu.
- Blocked: nothing.
- Next: Block 5 task 5 — Hole/Solid + Lock toggles in the toolbar's Modify group.

## 2026-08-05 — Block 5, task 3 (post-placement polish) + docs/SHORTCUTS.md
- Audited first, as the task says, and the audit changed the job: arrow keys were **already bound** —
  arrows nudge X/Z, Ctrl+arrows raise/lower — so there was nothing to add. What was actually wrong is
  that they stepped a hardcoded 1 mm (5 mm with Shift) no matter what the snap grid was set to, so a
  nudged part could land off the very grid a dragged part snaps to. One press is now **one snap step**,
  Shift is **10×**, and with snapping Off it falls back to the historical 1 mm so nothing gets stuck.
- `snapStep` turned out to be copy-pasted in `WorkplaneViewport.tsx` and `SketchWorkspace.tsx`. Rather
  than add a third copy in the editor it moved to `lib/gridSnap.ts` as `snapGridStep`, both callers now
  import it, and `nudgeStepForSnap` is built on top (5 new tests, including the two labels that are not
  numbers: `Off` → 0 and `Brick` → 8 mm).
- Also remembered the thing that silently breaks this kind of change: `snapGrid` had to go into the
  keydown effect's dependency array, or the handler would keep nudging by whatever the grid was when
  the editor mounted.
- Wrote **`docs/SHORTCUTS.md`**, the doc both this task's and Block 1's acceptance criteria point at.
  It covers every key bound across all three handlers — the editor keydown block, the edge-modifier
  handler (Esc/Enter), and the viewport keydown block (`W`/`Shift+W`, `F`/`Home`, `O`, `+`/`-`) — plus
  the placement mouse modifiers (Shift underside, Alt+click repeat), the sketch-mode handler that
  shadows the shape shortcuts, and the chat dock keys. It also records the one real gap the audit
  confirms: `F` resets the whole view and there is still no fit-to-selection, which stays Block 1's
  `Shift+F` task. Worth knowing for any future key work: all three handlers already bail on
  INPUT/TEXTAREA/SELECT/contentEditable targets, so no new field needs its own guard.
- typecheck + test (344) green.
- Blocked: nothing.
- Next: Block 5 task 4 — right-click context menu, new `components/workplane/ContextMenu.tsx`.

## 2026-08-05 — Block 5, task 2 (smart duplicate / Ctrl+D transform replay)
- Shipped: new `lib/patternShapes.ts` (27 tests) + `duplicateSelected` in `SketchForgeEditor.tsx` now
  routing through `nextDuplicateStep`. Duplicate a shape, move the copy, and every further Ctrl+D
  repeats that move; the replay lapses the moment the selection is no longer exactly the last copies.
  Supersedes the Block 1 "Linear array / duplicate-repeat" task, as the roadmap says.
- **The subtle bit, and the reason the state has the shape it does:** the replayed step is the copy's
  *total* offset from the shape it was copied from, **not** the drag the user added on top. Storing
  only the drag looks right and spaces the parts wrong: duplicate puts the copy at +8, the user drags
  it to 30, and repeating "the drag" (+22) gives 0 → 30 → 52 → 74 instead of 0 → 30 → 60 → 90. So the
  replay record keeps, per copy, the placement of its *source*, and the step is measured against that.
  There is a test that walks the whole sequence and asserts the even spacing.
- The acceptance case is a test: five keypresses from one box give six shapes at 0/8/16/24/32/40, gaps
  equal within 1e-6. Rotation and elevation replay too, not just translation.
- Also landed in the same lib, because Block 2's `sketchforge_pattern_objects` and Block 3's
  generators want them and they are the same maths: `linearPatternPlacements` and
  `circularPatternPlacements` (count-1 copies, `count` includes the original). The circular one
  rotates the offset the same right-handed way about **+Y** that `shape.rotation` turns the shape
  (checked against the `THREE.MathUtils.degToRad(shape.rotation)` Euler the viewport builds), so a
  rotated copy still faces the centre; a test pins the +90° case at (20,0) → (0,−20). A full 360°
  sweep divides by the copy count, a partial sweep by the gaps, so the last copy lands on the arc end
  instead of on top of the original.
- Kept the plate clamp (`Math.min(110, …)`) for the plain duplicate only. Clamping a replayed step
  would stack every further copy on the same spot once the chain reached the edge.
- typecheck + test (339) green.
- Owed: not exercised through the real keyboard this session (browser-selection block again). The pure
  replay function is tested through the exact loop the editor runs, and the editor side is now four
  lines of wiring.
- Blocked: nothing.
- Next: Block 5 task 3 — post-placement polish; audit the editor keydown block for arrow-key nudge
  before building anything (Block 0 lesson: grep first).

## 2026-08-05 — Block 5, task 1 (ghost for the drag-and-drop path)
- Shipped: new `lib/shapeDragPayload.ts` (8 tests) + `handleDragOver`/`clearDragGhost` in
  `WorkplaneViewport.tsx`, with the drag source in `SketchForgeEditor.tsx` registering the asset.
  Dragging Box from the panel now shows the same translucent ghost as click-to-place, face cruising
  included, and the drop commits to the cruised face instead of re-picking flat.
- **The DOM rule that dictates the whole design:** during `dragover` the browser is in *protected
  mode* — `dataTransfer.getData()` returns `""`, only `dataTransfer.types` is readable. So the
  viewport cannot learn what is being dragged until the drop, which is far too late to draw a ghost
  that follows the cursor. Hence the module-level register in the new lib: the drag source parks the
  asset there on `dragstart` and clears it on `dragend`; `isShapeDragTransfer(types)` is what the
  dragover handler is allowed to check. Both sides live in one document and one JS context, so this
  is a plain module variable, not state plumbing.
- Moved `parseDroppedShapeAsset` and the `SHAPE_KINDS` set out of `WorkplaneViewport.tsx` into the new
  lib on the way past — same logic, now unit tested (bad kind, non-boolean hole, non-JSON, missing
  fields), and the viewport shrinks by ~50 lines.
- Decisions: (a) gated on the existing `cruiseShapes` setting, the same toggle click-to-place uses, so
  turning ghosts off restores today's drop-at-cursor behaviour exactly; (b) skipped entirely while a
  click-to-place ghost is already armed, so the two never fight over `shapePreviewLayer`; (c) the
  built base shape is cached per drag — `makeShapeFromAsset` builds text/gear geometry and dragover
  fires continuously; (d) a `dragend` window listener clears the ghost, because a drag released
  outside the viewport (or cancelled with Esc) fires no drop at all.
- typecheck + test (312) green; page still serves.
- Owed, same as the dock: not eyeballed in the browser this session (two Chromes connected, extension
  needs a manual pick). The visible behaviour to confirm first: ghost appears on dragover, cruises
  onto a face, Shift flips to the underside, and dragging out of the window leaves no stuck ghost.
- Blocked: nothing.
- Next: Block 5 task 2 — smart duplicate (Ctrl+D transform replay) in new `lib/patternShapes.ts`.

## 2026-08-05 — Block 6, task 5 (session context) — Block 6 complete
- Shipped: `lib/assistantSceneContext.ts` (pure, 12 tests) + one more dock prop wired straight to the
  editor's existing `mcpSceneSnapshot`, so the summary is rebuilt from live state on **every**
  message — a resumed CLI session never reasons about the scene as it was three turns ago.
- Each object is one line: name, kind, id, size, position, then only the flags that change what an
  edit may do (hole, locked, hidden, group size, triangle count, edge-feature count, non-zero
  rotations). The selection is named at the end so "move it 10 mm" has a referent. Token guard:
  20 objects listed, then a pointer to `sketchforge_list_objects` for the rest.
- **The bug that only a live scene could have shown.** Built against a fixture the summary looked
  fine; run against the real editor it printed `Workplane 200 × 200 Metric (Default)` and
  `units Metric (Default) at 1:1 (millimeters)`. `workspace.units` / `workspace.scale` are *UI preset
  labels*, not unit symbols — the real display unit comes from `lengthDisplayUnit(workspace)` in
  `measurementUnits.ts` (mm/cm/m/in/ft/stud). And the distinction matters twice over: the MCP tools
  and every stored dimension are **millimetres regardless of the display unit**, so the summary now
  says exactly that, and only mentions a conversion (`1 in = 25.4 mm`) when the user's workspace shows
  something other than mm. There is a test named for the preset-label case.
- Verified live, the roadmap's own acceptance sentence: with a 20 × 20 × 25 box and a 10 × 10 × 8
  cylinder on the plate, "Make the cylinder as tall as the box." produced a single
  `update_object(height: 25)` — **no `read_scene`, no `list_objects`** — and the reply named the
  dimensions it left alone. Both test objects were deleted afterwards, plate back to empty.
- typecheck + test (305) green.
- Blocked: nothing. **Block 6 is complete** (all five tasks).
- Next: Block 5 — drag-and-drop ghost, smart duplicate (Ctrl+D transform replay), post-placement
  nudge audit, right-click context menu, hole/lock in the toolbar, icon unification, shortcut hints.

## 2026-08-05 — Block 6, task 4 (iteration checkpoints + version selector)
- Shipped: `lib/assistantCheckpoints.ts` (pure, 13 tests), a version `<select>` in the dock header,
  and two callbacks in `SketchForgeEditor.tsx` — `readShapesForAssistant` (returns `shapesRef.current`)
  and `restoreShapesForAssistant` (invalidates any edge-modifier session, then `commitShapes`).
- The design decision that makes the acceptance criterion fall out for free: **a restore is not a
  parallel history, it is a normal edit.** Restoring commits the snapshot through the editor's own
  `commitShapes`, which appends a history entry like any other change — so "restore v1 then undo
  returns to v3's state" is just undo doing its usual job, and manual edits made between iterations
  stay in the same chain instead of being shadowed by a second stack.
- Snapshots are taken *before* the turn and again in the `finally`, so a turn that was stopped or
  errored halfway still records what it actually changed. A turn whose fingerprint is unchanged
  (`projectShapesFingerprint`, reused from `editorHistory`) produces **no** version, which keeps
  question-answering turns out of the dropdown — the list is design iterations, not chat messages.
- Dropdown reads Current / v3 / v2 / v1 / Before v1, newest first, each iteration labelled with its
  own prompt clipped to 48 chars. "Before v1" comes from the first checkpoint's before-state, so
  there is always a way back to the scene as it was before the assistant touched it. Checkpoints
  deliberately survive "New chat": they bookmark the scene, not the conversation.
- Verified by unit tests over a three-iteration fixture (empty → box → two boxes → taller box), plus
  typecheck and a live page load. **Not** click-verified in the browser for the same
  browser-selection reason as task 2 — the restore path itself is one call into `commitShapes`, the
  same function every toolbar action already uses.
- typecheck + test (293) green.
- Blocked: nothing.
- Next: Block 6 task 5 — per-request scene summary in the system prompt so "make the cylinder as tall
  as the box" resolves without a read-tool round trip.

## 2026-08-05 — Block 6, task 3 (tool round-trip through the bridge)
- Shipped: mostly verification — the parsing (task 1) and the transcript rendering (task 2) already
  carried tool calls, so the code delta is one real gap the live check exposed: a **failed** call put
  its error in a `title` tooltip only, which is the one result worth reading without hovering. Failed
  tool lines now print the error under the call.
- Verified live against editor 63398 with the roadmap's own acceptance prompt, "add a 20mm box at the
  origin and fillet its top edges by 2mm". The turn ran `read_scene` → `create_shape` (kind: box,
  20×20×20 at 0,0,0) → `list_edges` → `apply_edge_treatment` (fillet, 4 edges, 2 mm) →
  `capture_image`, every one surfacing as a single transcript line with its parameters, each with a
  matching ok result, and the geometry landed in the visible editor. Then deleted the test object by
  id over the bridge so the scene was left as found (`deletedCount: 1`).
- Worth knowing about the transcript: `capture_image` returns a text block **and** a ~490 KB base64
  PNG block. `summarizeAssistantToolResult` renders image blocks as `[image]` and clips at 160 chars,
  so a screenshot tool call costs one short line, not a wall of base64. That was designed for; the
  live run confirmed it.
- **Side effect of working on a running dev server, worth remembering:** editing
  `SketchForgeEditor.tsx` and `globals.css` mid-session Fast-Refreshed the open editor tab, and the
  unsaved MCP-imported "M3 spacer" from the previous session was gone by the time the dock turn ran
  (`read_scene` reported `shapeCount: 0` before anything was created — confirmed by resuming that CLI
  session and asking). The project had `projectId: null`, i.e. a scratch scene with nothing persisted
  to restore from. Nothing I deleted caused it, but the lesson holds for every later UI task: an
  unsaved scene does not survive edits to the editor component, so save the project before a session
  that touches those two files.
- typecheck + test (280) green.
- Blocked: nothing.
- Next: Block 6 task 4 — iteration checkpoints + version selector (snapshot before each assistant edit
  batch, dropdown in the dock header, restore is itself undoable).

## 2026-08-05 — Block 6, task 2 (chat dock panel)
- Shipped: `components/assistant/AssistantDock.tsx`, `lib/assistantDockState.ts` (pure reducer, 18
  tests), `lib/mcpEditorIdentity.ts`, ~260 lines of `.assistant-*` CSS at the end of `globals.css`,
  and a two-line mount in `SketchForgeEditor.tsx` (import + `<AssistantDock />`).
- Layout decision that answers the roadmap's "never overlaps the inspector" the structural way: the
  dock is a **flex sibling of the viewport stage inside `.editor-body`**, not an overlay. `.editor-body`
  is already `display: flex` with `.workplane-stage { flex: 1 }`, and `.shape-inspector` is
  `position: absolute; right: 0` *inside that stage* — so a sibling on the right takes width from the
  viewport and the inspector re-anchors to the viewport's new right edge on its own. An overlay would
  have needed a hand-maintained offset that drifts the moment either width changes.
- Gotcha that would have shipped a stretched canvas: `WorkplaneViewport` sizes the renderer from
  `host.clientWidth` and only listens to `window.resize` (:2886) — there is no ResizeObserver. Since
  expanding/collapsing the dock changes the flex row without any window resize, the dock dispatches
  `new Event("resize")` whenever `collapsed` changes. Grepped for ResizeObserver first; it isn't there.
- Checked before wiring the keyboard: both keydown blocks already ignore events whose target is an
  INPUT/TEXTAREA/SELECT or contentEditable (`SketchForgeEditor.tsx:8626`, `WorkplaneViewport.tsx:4813`),
  so typing "d" in the composer cannot fire Duplicate. Esc additionally `stopPropagation`s so it means
  "collapse the dock" and never "cancel the ghost placement".
- Styling uses only the existing theme variables (`--panel`, `--border`, `--tile`, `--primary`, …),
  which is why dark mode needed two overrides rather than a parallel ruleset.
- Owed: **no browser screenshot of the dock this session.** Two Chrome browsers are connected to this
  account and the extension requires the user to pick one before any automation, which would have
  blocked an unattended session; the page still serves 200 with the dock compiled in. Layout is
  reasoned from the CSS above rather than seen — first thing to eyeball next session.
- typecheck + test (280) green.
- Blocked: nothing.
- Next: Block 6 task 3 — surface each executed tool call in the transcript end to end (the parser and
  the reducer already carry them; this is the live round-trip check through the bridge).

## 2026-08-05 — Block 6, task 1 (assistant backend route)
- Shipped: `app/api/assistant/route.ts` + four new libs, 41 new tests. The route spawns the locally
  installed Claude Code CLI (`claude -p --output-format stream-json --verbose
  --include-partial-messages --strict-mcp-config --mcp-config <file> --tools "" --allowedTools
  mcp__sketchforge`), writes the message to its **stdin**, and translates stream-json into an SSE
  event union (`session` / `text` / `tool` / `tool-result` / `result` / `error`). No API key
  anywhere: the turn bills against Marty's subscription. The spawned CLI's only tools come from
  `scripts/sketchforge-mcp-server.mjs` via `--mcp-config`, with `SKETCHFORGE_URL` set to the origin
  of the request that started the turn — so the dock's Claude and the desktop bridge share one tool
  layer, and the dev-server port is discovered, never hardcoded.
- Probed CLI 2.1.222 before designing, which changed the design three times:
  (a) `--mcp-config`, `--allowedTools` and `--tools` are **variadic**, so a prompt passed as a
  positional argument after any of them is eaten — `claude -p --tools "" "hello"` fails with "Input
  must be provided either through stdin or as a prompt argument". The prompt therefore always goes
  over stdin, which also keeps it out of the process list and off the Windows arg-length limit.
  (b) On Windows `claude` resolves to an npm `.cmd` shim, and Node refuses to spawn a `.cmd` without
  `shell: true` — so every argument had to become a flag, a file path, or a bare token. Long text
  (system prompt, MCP config JSON) goes through temp **files**; `--append-system-prompt-file` exists
  but is only mentioned in `--bare`'s help text, so it was verified by running it, not by reading.
  (c) With `--include-partial-messages` the same assistant text arrives twice — as `stream_event`
  text deltas and again in the completed `assistant` message. `createAssistantStreamParser` tracks
  the message ids that streamed and drops the duplicate block; there is a test named for exactly
  that. It also keeps a tool_use-id → name map so a later `tool_result` can be labelled.
- Verified live against the running editor on :3001 (editor 63398, the M3 spacer left over from the
  MCP session): "reply pong" streamed two text deltas and a result; "list the objects and tell me
  each height" produced `list_objects` + its result + the right answer (8 × 8 × 6 mm, 384 tris) with
  `mcpServers: [{sketchforge, connected}]` and all 17 tools listed in the init event; a follow-up
  with the returned `sessionId` answered "6 mm" from context alone, so `--resume` continuity works.
- Two decisions worth recording. (1) **`--tools ""`**: the dock's Claude gets *no* built-in tools —
  no Read, no Bash, no repo access. It is a scene assistant, and a permission prompt for a built-in
  tool would hang a headless turn with nothing to answer it. (2) **Guard duplication**: the
  localhost/dev-only gate is copied into new `lib/localRequestGuard.ts` rather than refactored out of
  `api/sketchforge-mcp/route.ts`, to keep that upstream file untouched. If the guard ever changes,
  both need the edit — flagged here so it is not a silent drift.
- Untested live: the missing-binary path (needs a dev server restarted with `SKETCHFORGE_CLAUDE_BIN`
  pointing at nothing). It is covered by the code both ways — ENOENT for a real binary, and the
  "exit code with shell noise" case that a missing `.cmd` produces instead.
- typecheck + test (262) green.
- Blocked: nothing. The optional direct-Anthropic-API fallback branch from the roadmap is *not* in
  this commit: the CLI path is the one Marty will use, and a second transport that cannot call MCP
  tools would be a half-feature. Revisit only if a machine without Claude Code ever needs the dock.
- PR candidates: none — this is fork-shaped (it assumes this repo's MCP server).
- Next: Block 6 task 2 — `components/assistant/AssistantDock.tsx`, right-side collapsible dock with
  streaming render, Enter/Shift+Enter/Esc, collapsed state in localStorage.

## 2026-08-04 — Live session (Cowork, not an overnight block)
- Shipped, five commits on `lumera-custom` (d2ff033, 80d444e, 9999d09, e03165f, 5a4c9fc):
  (1) **Mouse control scheme presets** — new `lib/mouseControls.ts` (SketchForge default, Tinkercad,
  Fusion 360, Blender, SolidWorks, Onshape), dropdown in Workspace settings → Appearance, global
  preference in localStorage, storage-event sync across tabs. Gotcha worth remembering: three's
  OrbitControls internally swaps ROTATE↔PAN on mousedown when Ctrl/Meta/Shift is held
  (OrbitControls.js ~1677/1699), so `resolveMouseButtons` pre-swaps the pressed button's binding to
  land on the intended action — any future scheme must go through that resolver, not raw
  `controls.mouseButtons`.
  (2) **Workplane opacity** — `workplaneOpacity` (10–100, default 100) added to
  `WorkplaneWorkspaceSettings`, slider in settings → Workplane, factor applied to the surface material
  and all four grid line materials in `rebuildWorkplane`/`createGridLines`. Normalizer + tests updated.
  (3) **Cursor-follow shape placement with face cruising** (Tinkercad-style): picking a shape arms a
  placement mode — translucent ghost (new `ThreeState.shapePreviewLayer` + `syncShapePlacementGhost`,
  modeled on the workplane hover preview) follows the cursor via
  `pickPlacementSurface` → `toPlacementWorkplanePoint` → `placementPatchForNewShape`, one click
  places (5 px movement threshold so orbit-drags never drop a shape). Shift flips to the underside,
  Alt+click repeats, Esc cancels, pointer-leave hides. The dead `cruiseShapes` setting is now the
  toggle; off = old instant center-of-plate add. `addShape` gained an optional workplane arg so
  face placements commit to the cruised face, not the active placement plane.
  (4) **Split parts in the top toolbar** (Combine group, new `ToolbarSplitIcon`) — was
  inspector-only.
- Verified live over the MCP bridge + editor tab; typecheck green (run from the session sandbox);
  full `npm run ci` still owed a native run.
- Blocked: nothing.
- PR candidates: mouse presets + the OrbitControls modifier-swap workaround might interest upstream;
  the rest is fork-flavoured.
- Next: Block 5 (added to ROADMAP today) — drag-drop ghost, smart duplicate, context menu,
  hole/lock in toolbar, icon unification, shortcut hints.

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
