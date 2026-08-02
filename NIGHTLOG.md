# NIGHTLOG

Newest entries on top. Template:
## YYYY-MM-DD — Block N
- Shipped:
- Blocked:
- PR candidates:
- Next:

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
