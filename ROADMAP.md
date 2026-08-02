# ROADMAP — one month, autonomous blocks

Goal: fast, easy to use, smart AI-assisted 3D designer on the Lumera fork.

## Block 0 — Research & refine this roadmap (week 1)
- [ ] Research competitors online: Tinkercad, Shapr3D, Plasticity, Fusion personal, Onshape free — list features SketchForge lacks that matter for quick AV-part design
- [ ] Read upstream GitHub issues + PRs for feature requests and known pain points
- [ ] Rewrite Blocks 1–4 below into concrete scoped tasks based on findings; keep each task <1 session

## Block 1 — Speed & UX quick wins (week 1–2)
- [ ] Audit editor for friction: keyboard shortcuts coverage, snap defaults, camera controls
- [ ] Measure and improve first-load and large-model performance
- [ ] Improve STL import robustness (common failing files)

## Block 2 — Smarter AI designer via MCP (week 2–3)
- [ ] Extend MCP tools: more primitives, pattern/array ops, measure/distance query, named anchors
- [ ] Add MCP tool for parametric Gridfinity base/bin generation
- [ ] Better error reporting through sketchforge_inspect_errors

## Block 3 — Parts library workflows (week 3–4)
- [ ] Smooth .skf save-to-shared flow for the mounted lumera-sketchforge-parts library
- [ ] Template starter files in templates/ (Gridfinity base, XLR well, USB-C tail)
- [ ] Keep LIBRARY.md index auto-updated when parts are added

## Block 4 — Polish & upstream PRs (week 4)
- [ ] Cherry-pick PR candidates from NIGHTLOG onto branches off clean main
- [ ] Typecheck/test/perf pass; update this roadmap for month 2
