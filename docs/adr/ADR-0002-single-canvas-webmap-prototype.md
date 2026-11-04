# ADR 0002: Single-Canvas Web Map Prototype

- Status: Provisional
- Recorded: 2026-11-04 09:29:49+00:00[UTC]
- Scope: Unpublished `prototype/webmap-canvas`; no main merge or publication

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

Implementation, projection accuracy, performance and tile discovery results
are pending. No prototype acceptance or performance improvement is claimed.

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
