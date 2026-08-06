# Performance baseline — 2026-08-05

First measurement of first-load payload and large-model handling, so later work has
something to compare against. Machine: Windows 11, Node 24.16.0. Every number below is
reproducible with the command quoted next to it.

## First load

Command: `npm run build` (output read from the route table)

| Route | Route JS | First Load JS |
| --- | --- | --- |
| `/` (the editor) | **1.24 MB** | **1.35 MB** |
| `/_not-found` | 985 B | 104 kB |
| every `/api/*` route | 138 B | 103 kB |
| shared by all | — | 103 kB |

Command: `ls -S apps/web/.next/static/chunks/*.js`

| Chunk | Size | Contents (grepped for identifying symbols) |
| --- | --- | --- |
| `f858556e-*.js` | 634 KB | manifold WASM as base64 — see below |
| `38b89ec4-*.js` | 474 KB | manifold module source + generated glue |
| `786-*.js` | 378 KB | three.js + react-dom |
| `9d78c252-*.js` | 339 KB | editor/viewport code |
| `9a4e65d8-*.js` | 322 KB | editor/viewport code |

### Top three payload contributors

1. **`src/generated/manifoldWasmBase64.ts` — 719 KB on disk.** The manifold WASM binary
   (527 KB) base64-encoded into a TypeScript module.
2. **`src/generated/manifoldModuleSource.ts` — 80 KB.** The manifold JS runtime, inlined as a
   string and instantiated from a blob URL at runtime.
3. **three.js**, which is irreducible for a 3D editor.

### Are the WASM kernels eager or on demand?

| Kernel | Size | Loading |
| --- | --- | --- |
| **manifold** (booleans, group/cut) | 527 KB wasm + 80 KB js | **Eager.** Both generated modules are static `import`s at the top of `SketchForgeEditor.tsx` (lines 19–20), so they are in the route's first-load JS whether or not the user ever performs a boolean. |
| **OCCT** (STEP import/export, chamfer/fillet) | 21.1 MB wasm in `public/occt/` | **On demand.** Served as a static asset and fetched by the worker only when a STEP or CAD-modifier operation runs. It never touches the JS bundle. |

### Deferral candidate — attempted 2026-08-05, NOT as simple as it looks

The obvious idea is to stop shipping `manifoldWasmBase64` (719 KB) and
`manifoldModuleSource` (80 KB) in server builds, since only the `file:` branch of
`getManifoldRuntime()` reads them and that branch exists purely for the static export.
An attempt was made and **reverted**; record of what was learned, so the next attempt
starts further along:

- **`resolve.alias` on `"@/generated/..."` does nothing.** Next resolves the `@` path
  mapping itself, so an alias keyed on that request is never consulted. The bundle came
  out byte-identical.
- **`NormalModuleReplacementPlugin` matching the resolved path did not remove the bytes
  either.** After it, `next build` reported the editor route dropping 1.25 MB → 948 kB,
  which *looked* like success — but a recursive search of the whole build output found the
  base64 still present, in `static/chunks/app/page-<hash>.js`, with the same content hash
  as the static export's copy. The route "Size" column moved for some other reason; it is
  not a reliable proxy for "these bytes are gone".
- **Measurement lesson, the expensive one:** verify a payload claim by searching the build
  output *recursively* for a substring of the actual payload. A flat scan of
  `static/chunks/*.js` misses `chunks/app/`, and Next's route-size column can move without
  the module graph changing the way you think.

So the saving is still on the table — the editor route is still ~1.25 MB and manifold is
still statically imported — but it needs someone to find where that chunk is really
assembled, and to confirm the static export keeps its inlined copy afterwards (a server
build and an export must be checked separately; only the export can afford to lose the
fetchable assets).

## Large models and the boolean path

Command: `npm run perf` (`tests/perf/stl-import.perf.ts`, node, no browser)

Synthetic binary STL workloads. The 500k row is the roadmap's large-model baseline; set
`SKETCHFORGE_PERF_SKIP_HUGE=1` to skip it on a memory-constrained machine.

| Workload | Step | Triangles | Avg ms | Heap Δ |
| --- | --- | --- | --- | --- |
| synthetic-500k | import STL → WorkplaneShape | 500,004 | **454.5** | +253 MB |
| synthetic-500k | serialize shape JSON | 500,004 | **888.3** | +99 MB |
| synthetic-500k | parse shape JSON | 500,004 | 270.6 | +137 MB |
| synthetic-large | import STL → WorkplaneShape | 60,000 | 54.7 | +26 MB |
| boolean | load manifold module | — | 5.9 | — |
| boolean | instantiate manifold WASM (first boolean pays this) | — | **12.1** | — |
| boolean | cube minus sphere (first boolean) | — | **17.1** | — |
| boolean | cube minus sphere (warm) | — | 6.3 | — |

Import scales linearly at ~9 ms per 10k triangles, unchanged from the 60k workload — the
sanitiser added in Block 1 costs nothing extra at scale.

### Nothing exceeds 2 s, but one step deserves naming

**`JSON.stringify` of a 500k-triangle scene: 888 ms.** No single step crosses the ~2 s
threshold the roadmap asked about, but this is the hot path because it is the *repeated* one:
it runs on project save, on `.skf` export, and on every scene-draft autosave.

That last one was a real bug this measurement caught. `serializeSceneDraft` originally
stringified the draft and *then* compared the result against the storage quota — so a scene
too large to autosave would burn ~890 ms of main thread on every debounce tick and throw the
result away. It now estimates the size from the mesh payloads first (~8 chars per coordinate)
and skips the serialisation entirely when the scene cannot fit. See
`estimateSceneDraftBytes` and the test that asserts `JSON.stringify` is never called for an
oversized scene.

The remaining 888 ms on genuine saves is untouched and is the obvious next target — a
structured-clone or binary mesh encoding would avoid the JSON round trip.

## Re-running this

```
npm run build     # first-load numbers (route table + chunk sizes)
npm run export    # the static-export build - NOT covered by `npm run ci`
npm run perf      # the timing table above
```

`npm run export` deserves its place in that list: on 2026-08-05 the assistant route shipped
with `export const dynamic = "force-dynamic"`, which `output: export` rejects outright, and
nothing caught it because `npm run ci` is only typecheck + test. The route now uses
`revalidate = false` like every other API route here. If you add an API route, run the
export once.
