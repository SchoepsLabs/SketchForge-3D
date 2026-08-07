# Performance baseline — 2026-08-05, updated 2026-08-06

> **2026-08-06:** the manifold deferral this document called "still on the table" has been
> taken — editor route **1.24 MB → 944 kB**, first load **1.35 MB → 1.05 MB**. Two chunk
> attributions in the first-load table were also wrong and are corrected inline. The new top
> payload contributor is the typeface JSON. Details in the two sections below.

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
| `f858556e-*.js` | 634 KB | ~~manifold WASM as base64~~ — **wrong, see correction below** |
| `38b89ec4-*.js` | 474 KB | ~~manifold module source + generated glue~~ — **wrong, see correction below** |
| `786-*.js` | 378 KB | three.js + react-dom |
| `9d78c252-*.js` | 339 KB | editor/viewport code |
| `9a4e65d8-*.js` | 322 KB | editor/viewport code |

> **Correction (2026-08-06).** Those first two rows were misattributed. Both chunks start
> `q.exports=JSON.parse('{"glyphs":…` — they are **three.js typeface font JSON**, not manifold.
> The manifold payload lived in `static/chunks/app/page-*.js`, which is exactly why the
> 2026-08-05 flat scan of `static/chunks/*.js` could not find it. Identify a chunk by grepping
> its *contents*, not by inferring from its size.

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

### Deferral — TAKEN, 2026-08-06

Both earlier attempts tried to make the bundler pretend a static import was not there.
Neither could, because that was never the problem: **a static import at module scope is a
hard edge in the module graph**, and no resolver trick removes it. The fix was to move the
import to where the module is actually read — `await import()` inside the `file:` branch of
`getManifoldRuntime()`, which is the only reader. No webpack config at all.

Measured at HEAD immediately before and after, same machine, same command:

| | Editor route JS | First Load JS | `app/page-*.js` chunk |
| --- | --- | --- | --- |
| Before (incl. the new gallery panel) | 1.24 MB | 1.35 MB | **1276.6 KB** |
| After | **944 kB** | **1.05 MB** | **502.3 KB** |

Verified the way the failed attempt should have been, by recursive search for a substring of
the real payload rather than by trusting the route-size column:

- the base64 is **gone from `static/chunks/app/page-*.js`** (the chunk the previous attempt
  found it hiding in);
- it now lives alone in `static/chunks/343.*.js`, 702.3 KB, which is **not referenced by the
  prerendered HTML** — so it is fetched only if something takes the `file:` branch;
- `npm run export` still builds, still passes `verify-static-worker-assets`, and its output
  **still contains** the base64 in that chunk;
- `npm run perf` shows the boolean path unchanged (first boolean 16.3 ms vs 17.1 ms baseline).

Separately, `SketchWorkspace` is now `next/dynamic` with `ssr: false` — it only mounts in
sketch mode, and it splits cleanly into a **29.4 KB** on-demand chunk.

#### Third dead end, so nobody retries it: `webpackMode: "eager"` cannot gate this per build

The tidy-looking way to keep the export's copy eager while the served build defers is to
branch on the build-time `STATIC_EXPORT_BUILD` literal with two `import()`s of the same
module, one carrying `/* webpackMode: "eager" */`. **It does not work.** When webpack sees
the same module imported with different modes it takes the union, eager wins, and the module
goes back into the parent chunk — the server build returned to 1.24 MB, i.e. the whole saving
was silently handed back. Reverted; the plain dynamic import is what ships.

### Next target, and it is now the biggest one: the typeface JSON

With manifold deferred, the two largest eagerly-loaded chunks are the font glyph data above:
**634 KB + 474 KB raw (~344 KB transferred)**, larger than the manifold payload just removed.

Six typeface JSON files are statically imported **twice** — `SketchForgeEditor.tsx:13-18` and
`WorkplaneViewport.tsx:15-20`:

```
droid_sans_mono_regular, droid_sans_bold, droid_serif_bold,
gentilis_bold, helvetiker_bold, optimer_bold
```

They are needed only to build geometry for **text shapes**, which most scenes never contain,
and only one of the six is used per shape. This is the same shape of win as the manifold one
(static import at module scope, read from one branch) but it is *not* the same size of job:
text geometry is built synchronously today, so deferring the fonts means making that path
async, inside the two giant files. It deserves its own task rather than being tacked onto this
one. Loading only the requested face would cut ~5/6 of it again on top.

Measured after this session's change:

| Chunk | Raw | Loaded on first paint? |
| --- | --- | --- |
| `f858556e-*.js` (fonts) | 634.5 KB | **yes** |
| `38b89ec4-*.js` (fonts) | 474.3 KB | **yes** |
| `343-*.js` (manifold wasm base64) | 702.3 KB | no |
| `317-*.js` (manifold module source) | 72.4 KB | no |

Confirmed in a real production serve (`next start`, editor loaded in Chrome): the resource list
contains neither `343.*` nor `317.*`, and `manifold.js` is fetched from `public/` by the normal
non-`file:` branch as before.

#### What is NOT verified, and should be before this is trusted

The `file:` branch now depends on webpack fetching `343.*.js` on demand, where before the
bytes were already in an eagerly-loaded chunk. **Nobody has opened the export under
`file://` and run a boolean since this change.** Note also that the export's HTML references
assets as absolute `/_next/...` (and `verify-static-worker-assets` *requires* that form), which
would not resolve from an arbitrary directory under `file://` anyway — so how that build is
actually opened needs confirming before concluding either way. Until someone runs a boolean
in the exported build, treat the export path as unproven.

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
