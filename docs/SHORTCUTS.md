# Keyboard shortcuts

Audited from the two places keys are actually bound — there is no single table in the code:

- `apps/web/src/components/SketchForgeEditor.tsx` — the editor `keydown` effect (selection, clipboard,
  history, nudging, mode toggles) plus the edge-modifier handler.
- `apps/web/src/components/WorkplaneViewport.tsx` — the viewport `keydown` effect (camera, workplane,
  placement cancel).

Both handlers ignore events whose target is an `<input>`, `<textarea>`, `<select>`, or a
contentEditable element, so typing in the inspector, a dimension field, or the Claude dock never
fires a shortcut.

`Ctrl` means `Ctrl` on Windows/Linux and `Cmd` on macOS — every binding below tests both.

## Selection and editing

| Keys | Action |
| --- | --- |
| `Esc` | Clear the selection |
| `Delete` / `Backspace` | Delete the selection |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste |
| `Ctrl+D` | Duplicate — and replay the last transform (see below) |
| `Ctrl+A` | Select every visible shape |
| `Ctrl+G` / `Ctrl+Shift+G` | Group / ungroup |
| `Ctrl+L` | Lock or unlock the selection |
| `Ctrl+H` / `Ctrl+Shift+H` | Hide the selection / show everything hidden |

### Smart duplicate

`Ctrl+D` copies the selection 8 mm along X and Z. Move, lift, or rotate that copy and the next
`Ctrl+D` repeats the copy's **whole** offset from the shape it came from, so further presses keep the
same spacing — five evenly spaced parts in five presses. The replay lapses as soon as the selection is
no longer exactly the last set of copies.

## Moving the selection

One press moves by **one snap step** — whatever the snap grid is set to (`Brick` is 8 mm; with
snapping `Off` the step falls back to 1 mm). Hold `Shift` for 10× the step.

| Keys | Action |
| --- | --- |
| `←` `→` | Nudge along the workplane's X axis |
| `↑` `↓` | Nudge along the workplane's Z axis |
| `Ctrl+↑` / `Ctrl+↓` | Raise / lower along the workplane normal |
| `D` | Drop the selection to the workplane |

Nudges follow the **active placement workplane**, so on a workplane set to a face the arrows move
across that face, not across the ground plane.

## Modes

| Keys | Action |
| --- | --- |
| `H` | Make the selection a hole |
| `S` | Make the selection solid |
| `L` | Toggle the align overlay |
| `M` | Toggle the mirror overlay |
| `W` | Toggle the placement workplane |
| `Shift+W` | Put the placement workplane on the selected face (falls back to toggling) |

## Camera

| Keys | Action |
| --- | --- |
| `F` / `Home` | Reset the view |
| `O` | Toggle orthographic / perspective |
| `+` / `=` | Zoom in |
| `-` / `_` | Zoom out |

There is currently **no fit-to-selection**; `F` always resets the whole view. Block 1 of the roadmap
adds `Shift+F` for framing just the selection.

## Placing a shape

Picking a shape from the toolbar menu (or dragging one onto the workplane) arms placement and shows a
translucent ghost that follows the cursor and cruises onto faces. Requires the **Cruise shapes**
setting in Workspace settings → Workplane; with it off, shapes are added straight to the plate.

| Input | Action |
| --- | --- |
| Click | Place the shape where the ghost is |
| `Shift` (held) | Flip the ghost to the underside of the face |
| `Alt`+click | Place and stay in placement mode for another |
| `Esc` | Cancel placement |
| Pointer leaves the viewport | Hide the ghost |

## Sketch mode

While the sketch workspace is open, the sketch handler takes over and the shape shortcuts above are
inactive.

| Keys | Action |
| --- | --- |
| `Esc` | Clear the current chain and selection |
| `Delete` / `Backspace` | Delete the selected point/segment/image, or clear the measurement |
| `Ctrl+Z` | Sketch undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Sketch redo |

## Chamfer / fillet panel

| Keys | Action |
| --- | --- |
| `Esc` | Cancel the edge modifier |
| `Enter` | Apply it, once a preview is ready and at least one edge is selected |

## Claude chat dock

| Keys | Action |
| --- | --- |
| `Enter` | Send the message |
| `Shift+Enter` | Newline |
| `Esc` | Collapse the dock |

## Mouse

Orbit/pan/zoom button assignments follow the scheme chosen in Workspace settings → Appearance
(SketchForge, Tinkercad, Fusion 360, Blender, SolidWorks, Onshape). See `lib/mouseControls.ts`.
