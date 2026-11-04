# ADR 0002: Single-Canvas Web Map Prototype

- Status: Provisional
- Recorded: 2026-11-04 09:29:49+00:00[UTC]
- Scope: Unpublished `prototype/webmap-canvas`; no main merge or publication

## Current Startup Follow-Up

Recorded 2026-11-04 21:15:07+00:00[UTC]. The owner authorized five measured
startup commits; [session 0018](../../session-logs/2026-11-04-0018-session-log.md)
records their individual results and all area exceptions. This supersedes the
historical `maxAllowableOffset`, Terraformer, GPU-bound-readback, scratch-copy,
startup and heavy-four-iframe limitations below; the original results are retained.

Queries use view quantization at the current degree tolerance and a grid extent
enclosing the multipart query footprint. SDK FeatureSets are explicitly decoded.
Clockwise outer rings and counter-clockwise holes use smallest-containing-outer
assignment; zero-area rings and uncontained holes are dropped and counted.
Terraformer is removed. CPU proj4 computes conservative chunk bounds from actual
Float32 vertices; geometry remains projected in the GPU vertex shader. Drawing
uses visible contiguous ranges without scratch allocation/copying.

Production preview: cold/warm completion 18.64s/4.93s; preparation 3.37s/3.33s;
first-draw phase 2.6ms/1.9ms. Four 960x540 embeds pass all-three-layer, nonblank,
one-context-each checks in 20.92s/11.76s. Actual geometry-buffer memory is
30,280,176 bytes for standalone framing, or 21,402,696 bytes per smaller embed;
framebuffer, compositor and driver memory are not included. Startup instrumentation
records zero GPU readbacks and copies. Timings are single samples and first draw
is not GPU-present timing; four child phase times include shared-thread contention.

Nine decoded vertex samples match independent unquantized queries within half
the grid tolerance. The frozen same-input triangulated-area audit finds 24 of
962 features exceeding 0.1% difference, all listed in session 0018. This is not
area/fidelity parity or replacement acceptance. Existing outline/geometry artifacts
and the deferred owner WebMap remain open. No main merge, push or deployment.

## Architecture

The main application retains its ArcGIS MapViews. An unlinked Vite experiment
will load public WebMaps or feature-layer portal items through `@arcgis/core`,
without creating MapView or SceneView. One WebGL2 canvas will draw pane
rectangles with viewport/scissor; titles, controls, scale bars and swipe will
be DOM overlays. One shared scale and independently pannable centers replace
linked MapViews. Reuse the existing context instrumentation.

All seven regional/overview definitions, in both Albers and Lambert Azimuthal
Equal Area, now live in `src/projections.js`. WKT is generated from numeric
parameters; main app and prototype must use the same source. WGS84 is retained.
Ellipsoidal Snyder formulas, antimeridian-safe rings, densification and earcut
triangulation are planned. Prefer a single lon/lat GPU upload; permit cached
CPU float64 projection only if independent ArcGIS accuracy tests require it.

Feature loading will flatten groups and share one paginated download per layer,
respecting renderer fields, filters, visibility, opacity and scale ranges.
Unsupported layer/rendering types must be reported, not approximated. Public
access only: authentication requirements stop loading with an on-page message.
Budgets, generalization and deepest zoom will be documented with implementation
and measured results. Vertex-budget preflight depends on service metadata.

## Trade-Offs and Verification

This is a restricted vector renderer, not a replacement for the full ArcGIS
cartographic stack. No basemap tiles, labeling, popups, effects, OAuth or
arbitrary symbol approximation are promised. A single context reduces context
pressure but transfers projection, tessellation and symbol responsibilities
to application code. Geographic generalization and deep zoom must be bounded.

Required acceptance: independent ArcGIS projectOperator comparison at the
deepest allowed zoom, named points and pane centers, maximum meter/device-pixel
errors, native visual comparison at both requested sizes, cold/warm transfer
and frame-time comparison, and four-iframe context/load measurements. Use
headless checks during development; batch only necessary native checks to
avoid disrupting the owner's desktop. Results below must distinguish passed,
failed, deferred and untested work. A real owner-provided web map is deferred.

## Measured Results

### Step 0

Alaska Albers now uses meridian -154, parallels 55/65 and origin 50. Its
projection parameters match EPSG:3338 / ESRI:102006, but those CRSs use NAD83,
not this definition's WGS84. Alaska's bar is lower-right in both layouts; its
globe is raised to avoid overlap. Eight headless cases at three scales pass.

The old -146 framing presets were intentionally preserved. At -154, the
panhandle exceeds the right edge by 94.10px at 1920x1080 and 138.88px at
2560x1600 in the standard layout (globe: 94.10px and 139.51px). Anchorage,
Attu, Adak and the north test point fit. Lambert's existing western clipping
is unchanged. This is a known framing regression, not an accepted fit.
Full measurements and artifacts are in [session 0014](../../session-logs/2026-11-04-0014-session-log.md).

### Step 1

All 14 generated WKT parameter sets were independently compared with committed
Step 0 definitions (`416c8aa`); numeric parameters and WGS84 ellipsoid match.
Focused syntax and ESLint checks pass. No rendering change is intended.

### Step 2

Unlinked experiment entry and Vite input implemented. URL defaults: Lambert,
CONUS/AK/HI/PR, scale 1:24,000,000. Explicit scale bounds are 1:1,000,000 through
1:80,000,000; `scale=` is an additional comparison/test parameter. Two Node
contract tests and focused lint pass. The supplied world item loads anonymously
in headless Chrome, with zero created/live WebGL contexts before rendering.
The real owner web-map fixture is still deferred.

The owner approved feature-count preflight plus incremental vertex enforcement
after each page and before triangulation/upload, with whole-layer rejection on
overflow. This replaces the literal pre-download vertex requirement where
services provide no vertex count. See the public
[query contract](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/).

### Remaining Steps

All numbered investigation steps are recorded. Native comparison found
acceptance gaps; the heavy iframe harness and real owner WebMap remain open.
No final prototype acceptance or performance improvement is claimed.

## Step 3: Data Contract and Results

One cached promise per FeatureLayer shares a paginated query across all panes.
Group visibility, multiplicative opacity and ancestor scale ranges are retained.
The count preflight uses the definition expression. Queries request WGS84
geometry and only renderer fields plus the object ID required to verify page
identity. Page size is the smaller of 500 and advertised maxRecordCount;
nonpagination services use object-ID batches. Empty/duplicate/inconsistent pages
are rejected rather than accepted as complete.

Limits: 50,000 features per layer before geometry download; 4,000,000 vertices
per layer, 6,000,000 total before rendering. The initial 2,000,000-vertex cap
correctly rejected the world fixture; the final cap accommodates it. Overflow
rejects the entire layer, never displays a partial download. Generalization is
`maxAllowableOffset=0.001` in output degrees (WGS84); this is a national/state
display compromise, not survey accuracy or a bound on GPU projection error.
Longitude ground tolerance varies by latitude. Geometry is not re-fetched on
pan/zoom. Densification will have a separate post-processing budget.

The owner approved explicit test-only styles applied by intercepted item-data
responses, identically for both comparison applications. No portal edits or
normal-loader approximation: the world item normally rejects `destination-atop`
blending; congressional districts reject CIM symbols. Supported field-driven
grouped unique values are supported, but expressions/visual variables remain
unsupported. Missing/null-class symbols intentionally draw nothing.

| Supplied layer | Features | Geometry pages | Vertices | Vertices at 170..180E, 50..55N |
| --- | --- | --- | --- | --- |
| World countries | 651 | 2 | 3,717,621 | 1,848 |
| US/outlying areas | 148 | 1 | 324,181 | 1,848 |
| 119th congressional districts | 441 | 1 | 492,304 | 0 |

These are generalized source-geometry counts, not a rendering acceptance test.
The congressional omission is confirmed and intentionally not repaired. Six
Node tests, focused lint and the headless real-data fixture pass. Zero contexts
are created before rendering. Output: `/tmp/usa-map-step3.log`.

## Step 4: GPU Rendering

One WebGL2 context renders all pane rectangles with viewport/scissor. Geometry
is unwrapped before Terraformer ring/hole conversion, densified to at most
0.25-degree geographic edge segments, triangulated by Earcut and uploaded once.
Limits after processing: 6,500,000 vertices and 12,000,000 primitive instances
across the page. A layer exceeding a limit is wholly rejected. Primitives that
span the pane projection's antipodal longitude cut are suppressed; this is a
regional renderer, not seamless global wrapping. Generalization error is separate
from numerical projection accuracy. Regional dateline and hole-area tests pass.

Snyder ellipsoidal WGS84 Albers and LAEA execute in float32 GLSL, with constants
computed in float64. No CPU-projected geometry fallback was needed on the tested
Chrome implementation. Proj4 handles center/inverse calculations; GeographicLib
solves WGS84 endpoint distances for true-distance scale bars. Scale is shared;
centers are independent. Wheel/two-pointer pinch, pan and recenter preserve the
one-context/one-download model. Alaska's bar is lower-right. Recenter uses a
Lucide icon and keeps the current scale. Other pane titles and controls fit at
1920x1080, 2560x1600 and 390x844; mobile intentionally crops geography at the
same scale rather than changing the map's scale independently by pane.

The independent transform-feedback test compares the exact projection shader
with ArcGIS projectOperator for ANC, Attu, Adak, HNL, SJU, Key West, Seattle,
projection origins and actual home centers. At minimum scale 1:1,000,000, DPR 2:

| Projection | CONUS max m / device px | AK | HI | PR |
| --- | --- | --- | --- | --- |
| Lambert | 3.405 / 0.0257 | 4.764 / 0.0360 | 2.899 / 0.0219 | 3.862 / 0.0292 |
| Albers | 2.735 / 0.0207 | 3.029 / 0.0229 | 5.020 / 0.0379 | 2.946 / 0.0223 |

This is headless numerical evidence, not native hardware acceptance, complete
raster-pipeline parity or a guarantee at untested zoom/DPR. CPU Proj4 reference
differences are below 0.000001m. Live/created contexts remain 1/1; GL error is zero.

The three-layer Albers run exposed a downloaded-but-unrendered district layer.
SDK `queryFeatures` returned DC OBJECTID 88 at `[101999.898091, 32522.490162]`
while labeling it WGS84. An independent REST `f=json` query returned
`[-77.0218, 38.8059]`. Geometry pagination now uses the SDK's explicit
`executeQueryJSON` API. The corrected district-only render passes without editing
the source; the complete corrected fixture will be measured in Step 6. The
browser harness now requires rendered-layer count, not just downloaded datasets.

Supported fills, solid lines and circle markers render with colors, outlines
and opacity. Headless synthetic circle/line and touch-pinch checks pass. Captures
show subpixel outline roughness, to be assessed against native ArcGIS in Step 6.
Dependencies: earcut 3.2.4, proj4 2.22.0, @terraformer/arcgis 2.2.2,
geographiclib-geodesic 2.2.0 and lucide 1.68.0. Installation audit reported zero
vulnerabilities; focused lint and eight Node tests pass. New screenshots and
runtime artifacts remain temporary, not repository assets.

## Step 5: Shared Swipe

`swipe=A,B` resolves each token by layer ID, then portal item ID, then zero-based
index in the successfully rendered layer list. Invalid/missing targets or two
tokens resolving to the same layer stop initialization with a message. Other
layers remain context beneath the pair in their original relative order. A is
scissored left and B right, including their outlines, using the same rounded
device-pixel boundary. No geometry upload or additional canvas is needed.

Every pane has a DOM slider with a shared initial fraction of 0.5. Pointer drag
and ArrowLeft/ArrowRight adjust it; Shift changes the keyboard step from 1% to
10%; Home/End reach 0%/100%. Accessible values include both layer titles. Dragging
a divider does not pan the map. Four-pane two-color pixel assertions verify
both sides and both endpoints; pointer/keyboard synchronization, unchanged
centers and 1/1 live/created contexts pass headlessly. Nine unit tests pass.
Screenshot: `/tmp/usa-map-swipe.png`. Native comparison remains Step 6.

## Step 6: Comparison and Acceptance Gaps

The main app has a dev-only pre-startup fixture hook; production ignores it.
Tests select exactly the three supplied items in main and drawer before requests
start. Both apps receive the same intercepted simple styles, not portal edits.
The main application retains its seven visible MapViews (including overview,
Guam and Samoa); the prototype has four panes. This is an application-level
comparison, not identical workloads or identical viewport rectangles.

One native Chrome batch captured both apps, both projections and both requested
sizes, at 1:24,000,000. All selected pane centers match within 0.000001m and
scales match exactly. Layout translations and the main view extending behind its
drawer prevent direct whole-image pixel alignment. World/US positive-longitude
Aleutians are retained on the western end of the continuous Alaska chain;
districts still omit them. The prototype's solid outlines are visibly broken at
subpixel widths, and the 2560x1600 Albers Alaska view includes a spurious
far-field polygon near its bottom edge. These are failed visual-fidelity checks,
not accepted approximations. Projection accuracy alone does not certify polygon
tessellation, clipping or stroke coverage.

Native transform-feedback accuracy is at most 5.020m / 0.01898 device pixels at
1:1,000,000 and the observed DPR 1. The earlier headless DPR 2 result is at most
0.03795 device pixels. Native screenshots and numeric states are in
`/var/folders/3v/c9dzmzpn5t9_sw5dhskjk6t40000gq/T/usa-map-comparison-XIk8Au/`.

### Performance Method

Headless Chrome, 1920x1080, DPR 1, Lambert, 1:24,000,000, canonical Vite dev
origin. Cold clears browser HTTP cache; warm navigates again in the same browser.
CDP response-stage interception supplies item-data styles without Playwright
routing's cache disabling. Request counts include dev modules, metadata, counts,
geometry and SDK assets; bytes use CDP encodedDataLength, not cross-origin
ResourceTiming zeros. Intercepted item-data bodies/cache accounting are a fixture
caveat. Browser cache is the controlled variable, not CDN/server-side cache.

First complete is elapsed navigation time after all tested views are ready,
stationary and not updating, including drawer opening and center/scale setup in
main; prototype waits for its complete upload/draw. Pan uses a five-second RAF
loop moving CONUS two CSS pixels per callback; statistics are RAF intervals, not
CPU submission times or measured GPU-present timestamps. Samples are single runs,
not a statistically controlled benchmark. Different achieved frame counts imply
different total travel distances. Main measurements preceded the isolated
prototype rerun, so external service variability is not controlled.

| App / cache | Complete ms | Bytes | Requests | Query requests | Live contexts | RAF median / p95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| Main cold | 8161.5 | 16076566 | 1789 | 218 | 7 | 16.7 / 16.7 |
| Main warm | 2800.2 | 60053 | 1789 | 218 | 7 | 16.7 / 16.7 |
| Prototype cold | 6202.9 | 29972658 | 552 | 7 | 1 | 116.6 / 133.4 |
| Prototype warm | 6180.5 | 17504414 | 551 | 7 | 1 | 116.6 / 116.7 |

Prototype geometry still uses four pages plus three count queries, shared across
panes. Upload size is 185,831,736 bytes. Warm reload reconstructs meshes; pan does
not re-download them. Cold cache hits within a load can arise from cross-frame
reuse. Main created nine contexts cumulatively, seven remaining live. Prototype
created/retained one. Initial fixture runs also encountered an unrecorded
two-layer outcome and a 50.1-second full load; no stable speedup is claimed.
Headless cold failures included an unrelated favicon 404; native main also
recorded three aborted widget-translation requests during lifecycle changes.

### Four Iframes

`experiments/webmap-canvas/four.html` loads four independent prototypes, each
with four panes. An ordinary headless US/outlying-only check, without fixture
interception, initialized all four with 1/1 live/created contexts each and no
page/network errors. Summed live contexts: four. That probe did not retain a
precise first-complete time.

The heavy three-layer comparison remains **unresolved**: one CDP run reached
four contexts and four incomplete two-layer renders at 66.46s; another timed
out at 300s. Smaller/full routed runs initialized only two iframes, while the
other two never exposed application state. Switching CDP to Playwright routing
did not resolve it. The last full routed run had two complete three-layer
iframes at 10.74/11.10s but timed out at 120s overall. Therefore there is no
accepted full-fixture four-iframe load time or heavy-fixture context acceptance.
The owner explicitly approved recording this limitation rather than continuing
the harness investigation. Do not interpret it as proven application incapacity
or a proven interception root cause.

### Build and Decision

Build and all 649 chunk budgets pass, with focused lint and nine unit tests.
Adding the second app moved common SDK modules into a heuristically named
`projections` chunk, failing the default 500KB gate. A stable `arcgis-shared`
manual chunk now owns the unchanged 1,450,000-byte SDK allowance (actual
905,931 bytes); the main entry returns to the 500KB default. Other ceilings are
unchanged. Built main and supported-layer prototype smoke checks pass using
actual dist bytes intercepted at the canonical origin, without a second server.

Keep this ADR provisional and the branch unpublished. The context reduction is
real on tested pages, but fidelity, pan throughput, far-field clipping, the heavy
iframe harness and a real owner WebMap remain acceptance gaps. No CPU projection
fallback is indicated by numerical evidence. Geometry culling/batching and
stroke/clipping correctness need separate follow-up, not a performance claim.

Artifacts: main headless `usa-map-comparison-3Yojhm`, prototype headless
`usa-map-comparison-L26bDQ` under the same temporary parent as native captures;
`/tmp/usa-map-comparison.log`, `/tmp/usa-map-comparison-prototype-final.log`,
`/tmp/usa-map-four-fixed.log`, `/tmp/usa-map-prototype-build.log`.

## Step 7: Public Vector Tile Research

[Source inventory](../vector-tile-sources.md) records public item IDs, owners,
service SR/WKT, origins, LODs and exact-match decisions. Skinner's Alaska/CONUS
services and the Hawaii candidate match pane Albers parameters but use NAD83,
not WGS84. Public LAEA sources have different centers. No inspected source is
an exact complete-CRS pane match, and no dedicated PR/USVI match was established.
Text search and advertised global bounds do not prove island-level coverage.
All access was anonymous/public; missing item style resources were documented
and service-root styles checked, without accessing internal systems.

An exact match could decode tiles into source projected coordinates and draw
directly in the pane. Otherwise inverse source projection, explicit datum
conversion to WGS84 and pane reprojection are needed, with domain clipping and
densification. Neither approach implements vector-tile styling: expressions,
zoom-dependent rules, glyphs, sprites, labels and collision handling remain
substantial work. This is research only; no tile-rendering feature was added.

## Performance-First Follow-Up

[Session 0017](../../session-logs/2026-11-04-0017-session-log.md) records each
separately measured change, exact bytes, reproduction commands, and caveats.
Buffered, dateline-split pane queries replace worldwide selection. Half-pixel
scale-derived geographic generalization replaces the fixed initial tolerance;
debounced area refreshes refine after a square-root-of-two zoom threshold or
leaving coverage. Stale/incomplete results retain the prior meshes.

Symbol batches contain bounded spatial chunks. Their projected-vertex bounds
are computed once using the existing shader and checked against each pane.
Visible ranges are GPU-compacted into a reusable scratch buffer: the fixture
uses twenty draws across four panes, not per-feature draws. Initial submitted
instances drop from 13.58 million to 1.69 million. Original buffers total
81.46MB, with a 38.28MB scratch buffer; GPU copies are not network transfers.

Final dev and production preview both measure 16.7ms median/p95 pan callback
intervals, versus the historical 116.6ms median. Production cold/warm transfer
is 7,495,950 / 35,815 bytes; measured pans issue no requests. Main remains at
16.7ms, with seven live views versus four panes and a different production
fixture setup. These are single samples, not GPU-present frame timings.

Startup remains unaccepted: final production completes at 83.8s cold / 69.6s
warm, dominated by about 68s of geometry preparation. Profiling identified
Terraformer ring-containment work. A disjoint-bounds prefilter saved about
eleven seconds while retaining the converter; it did not solve the bottleneck.
No fidelity work or heavy four-iframe investigation was performed. Existing
projection/stroke algorithms are unchanged. Keep this ADR provisional; smoother
panning alone does not establish replacement readiness or authorize deployment.

## Startup and Canonical-Query Follow-Up

[Session 0018](../../session-logs/2026-11-04-0018-session-log.md) replaces
Terraformer with orientation/point-in-polygon assignment, uses explicitly decoded
view quantization, computes conservative chunk bounds with CPU proj4 and draws
visible ranges without scratch copies. Startup no longer uses GPU readback.

[Session 0019](../../session-logs/2026-11-04-0019-session-log.md) promotes
uncontained counter-clockwise rings to independent clockwise outer polygons;
15 of the frozen 962 features still differ by more than 0.1% from the earlier
triangulation baseline. It runs layer setup, counts and geometry concurrently,
then admits whole layers against the aggregate budget in original input order.
Transient downloaded geometry can exceed the admitted aggregate budget, though
individual layer budgets remain enforced.

Tolerance floors to fixed square-root-of-two levels anchored at scale 1000000.
Buffered geographic footprints round outward to a 5-degree grid before dateline
splitting, with deterministic box ordering. Refinement compares those same
levels. Native geometry queries use GET; exact URL equality passes for cold/warm
and independent browser profiles. Standalone lengths are 730/958/758 ASCII bytes;
960x540 embeds use 726/954/754. Outward rounding and finer tolerance increase the
selected geometry, so performance is not an identical-workload comparison.

Current production standalone completion: 13.63s cold / 4.70s warm, with
3.63s / 3.66s preparation. Four independent embeds complete in 19.17s / 13.00s,
all with three rendered layers, one context, nonblank pixels and no GL errors.
Geometry buffers total 32,810,232 bytes standalone or 23,718,024 per smaller
embed, excluding framebuffer/driver memory. Startup has no GPU buffer copies
or readbacks; verification readPixels occurs after recorded completion.

A fresh-profile repeat against byte-identical geometry URLs completes in
13.42s standalone / 19.39s for four embeds. Cold wire responses show
`CONFIG_NOCACHE` and private cache policy, not a demonstrated shared-cache hit;
warm responses are browser-cache hits. Internal service/database caching cannot
be inferred from these headers or single-sample timings. The session log records
per-layer TTFB, complete phases, exact requests and the repaired duplicate-byte
accounting assertion. Known stroke/far-field fidelity defects and a real owner
WebMap remain acceptance gaps. Keep this ADR provisional; no current push,
merge, deployment or portal changes are authorized.
