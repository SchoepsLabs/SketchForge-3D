# CLAUDE.md — SketchForge Lumera fork

Fork of Formsmith746/SketchForge-3D. Working branch: lumera-custom. main mirrors upstream.

## Hard rules
- Work ONLY on lumera-custom. Never commit to main.
- Keep upstream mergeability: no giant rewrites of upstream files; prefer additive changes.
- Machine config lives in gitignored deploy/docker/.env — NEVER hardcode local paths or commit .env.
- Generally-useful fixes: note them in NIGHTLOG.md as "PR candidate" (they get PR'd upstream from a branch off main later).
- Before finishing any block: `npm run typecheck` and `npm run test` must pass.
- Dev server: `npm run dev -- -p 3001`. Editor MUST be opened at http://localhost:3001 (NOT 127.0.0.1 — MCP bridge 403s heartbeats). Docker prod runs separately on 3000.
- MCP bridge: GET http://localhost:3001/api/sketchforge-mcp lists live editors.

## Session protocol
1. Read ROADMAP.md, pick the first unchecked item in the current block.
2. Small commits, descriptive messages, push to origin/lumera-custom when green.
3. Append a NIGHTLOG.md entry: date, what shipped, what's blocked, PR candidates, next step.
4. If blocked >30 min on one issue, log it and move to the next item.
