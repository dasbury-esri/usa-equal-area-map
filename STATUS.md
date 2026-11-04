---
schema_version: 2
id: usa-equal-area-map
name: USA Equal Area Map
domain: work
confidential: false
state: active
health: green
priority: 2
next_action: "fix the drawer and check for dependency updates. update dependencies as appropriate"
updated: 2026-11-04
extra:
  agents: [copilot-enterprise]
  predecessor: usa-equal-area-map-proto
---

# USA Equal Area Map

## Unpublished Single-Canvas Prototype

Work is isolated on `prototype/webmap-canvas`, one commit per numbered step.
No merge or publication is authorized. Step 0 retains the owner's -154 Alaska
Albers meridian edit and places Alaska's scale bar lower-right in both layouts,
with the globe raised to avoid overlap. Headless checks pass both projections,
layouts and requested sizes at three scales. The unchanged -146 framing presets
now clip the Albers panhandle by about 94px at 1920x1080 and 139px at 2560x1600;
Attu fits. This regression is documented, not retuned. See
[session 0014](session-logs/2026-11-04-0014-session-log.md).
Use headless checks during development to avoid disturbing the owner's desktop.
Step 1 centralizes all 14 projection definitions in `src/projections.js`;
numeric comparison against Step 0 and focused lint/syntax checks pass. See
[ADR-0002](docs/adr/ADR-0002-single-canvas-webmap-prototype.md) for the provisional
architecture and accumulating verification record.
Step 2 adds an unlinked experiment entry with validated URL inputs and anonymous
ArcGIS item loading. Node tests, lint and a headless public-item check pass;
Step 3 now implements bounded shared downloads and renderer validation; six
Node tests and the three-layer headless fixture pass. World and US/outlying
source geometry includes positive-longitude Aleutians; congressional geometry
does not. Default loading rejects the world item's blend mode and congressional
CIM symbols. Owner-approved test-only styles allow like-for-like comparison
without editing public items. Step 4 adds one WebGL2 canvas, ellipsoidal GPU
projection, tessellation, shared zoom/pinch, independent pan/recenter and
geodesic scale bars. Headless pixel/interaction checks and eight unit tests pass.
Independent ArcGIS comparisons at 1:1,000,000 and DPR 2 are below 0.04 device
pixels for all tested points/panes. Native visual/performance acceptance remains
pending. Explicit JSON geometry queries avoid an observed SDK coordinate-decoding
failure for the DC district; source data is not edited.
Step 5 adds synchronized A/B scissor clipping and accessible draggable dividers.
Headless four-pane pixel, keyboard and pointer tests pass with one context and
unchanged centers. Native comparison, performance and public tile research remain.
Step 6 captures both applications natively at both sizes/projections and records
cold/warm headless measurements. The numerical projection test passes, but
visual fidelity does not: broken subpixel outlines and a far-field polygon
artifact remain. Pan cadence is about 117ms versus 16.7ms for MapViews. The
four-iframe comparison harness is unresolved; the owner approved recording that
limitation and continuing. All 649 build budgets and built-entry smoke checks
pass. This is an unpublished investigation, not an accepted replacement.
Step 7 records [public vector-tile sources](docs/vector-tile-sources.md).
Inspected Albers candidates differ by datum; LAEA candidates differ by center.
No exact complete-CRS match is established. All numbered work is recorded, with
the documented rendering/performance/iframe acceptance gaps still open.

Performance follow-up in [session 0017](session-logs/2026-11-04-0017-session-log.md)
adds buffered area queries, scale-dependent detail, symbol batching and chunk
culling. Final dev and production-preview pan intervals are 16.7ms versus the
historical 116.6ms, with no requests during measured pans. Production cold
transfer is about 7.50MB. Startup is still a major regression: about 84 seconds
cold and 70 seconds warm, dominated by ring-containment/geometry preparation.
These gains do not establish overall readiness. Fidelity and heavy-iframe gaps
remain; no new production deployment is authorized.

Startup follow-up in [session 0018](session-logs/2026-11-04-0018-session-log.md)
supersedes those startup/iframe results: view quantization, explicit decoding,
orientation-based hole assignment, CPU proj4 chunk bounds and per-range draws
reduce production-preview completion to 18.64s cold / 4.93s warm. Preparation is
3.37s / 3.33s. Four 960x540 embeds all render three layers with one context each,
completing in 20.92s cold / 11.76s warm. Geometry GPU buffers are 30.28MB for the
standalone framing or 21.40MB per smaller embed, excluding framebuffer/driver
memory. Startup uses no GPU readback or scratch copies. Nine sampled decoded
vertices pass independent unquantized-query checks. The identical-input area
audit listed 24 of 962 features differing by more than 0.1%; fidelity is still
unaccepted. See the current follow-up below; STATUS `next_action` is unchanged.

[Session 0019](session-logs/2026-11-04-0019-session-log.md) promotes uncontained
counter-clockwise rings to outer polygons, reducing frozen-input exceptions to
15. Layers and their counts load concurrently, with deterministic admission
order. Generalization uses fixed square-root-of-two levels and footprints round
outward to a 5-degree grid. Native geometry queries are GET with identical
repeat URLs: 730/958/758 bytes standalone, 726/954/754 per smaller embed.
Production completion is 13.63s cold / 4.70s warm standalone and 19.17s / 13.00s
for four embeds. A separate fresh-profile repeat is 13.42s / 19.39s respectively.
Warm queries hit browser cache; cold repeats return `CONFIG_NOCACHE` and private
cache policy, with no demonstrated ArcGIS Online shared-cache hit. Internal
service caching remains unobservable. Geometry buffers are 32.81MB standalone
or 23.72MB per smaller embed, with all three layers and one context each.
Known fidelity defects remain. Work uses the isolated `usa-equal-area-map-canvas`
Git worktree to avoid the other agent's checkout; its production preview remains
on port 5175. The owner subsequently authorized pushing these four measured
commits and a `[skip ci]` session closeout to the prototype branch only.
No merge or deployment is authorized by that closeout.

[Session 0020](session-logs/2026-11-04-0020-session-log.md) adds concurrent
service-sized pages and shared OR-filter geometry downloads including hidden
layers. The unmodified owner-map benchmark completes in 5.01s cold / 2.60s warm
standalone and 6.50s / 5.22s with four embeds, but remains partial rendering:
multiply, CIM and imagery are unsupported. Fetching previously skipped layers
increases requests; this is not a demonstrated like-for-like speedup.

A separately committed `tiles=` experiment decodes the supplied CONUS/Alaska
Albers PBF sources using their NAD83 CRS before the existing pane shader, with
plain symbols, tile-edge clipping and optional Guam. Eight independent coastline
comparisons at 1:1000000 and 1:500000 have subpixel medians, but sampled maximum
offsets exceed one pixel at San Juan, Honolulu and Guam. Anchorage passes both.
Desktop/mobile rendering, pan/zoom, source routing, 24 contracts and 651 chunk
budgets pass. Existing line/fidelity gaps remain. These four follow-up commits
remain local: no new push, merge or deployment is authorized.

## Local Development

Use one repository-backed dev instance at
`http://127.0.0.1:5173/usa-equal-area-map/`. Start it with `npm run dev` from
this repository. Port 5173 is strict: a second start fails instead of moving
to another port. URL options select the preview, projection and layout on
that same server. Do not serve copied source snapshots for ongoing work.

The temporary port-5174 server is stopped. Continue editing this repository,
including [src/main.js](src/main.js); publish only after owner review and
explicit approval. The approved release below is now live; subsequent local
edits still require a separately approved production push.

Before a clean dependency install, stop the port-5173 Vite process, run `npm ci`,
restart `npm run dev`, and reload every open local tab. A clean install removes
the optimizer cache; old browser modules can otherwise keep requesting deleted
hashed chunks. Do not exclude the ArcGIS SDK merely because stale URLs fail.

## Published Tooling Warning Fixes

Published in session 0011: explicit install-script decisions allow only esbuild 0.25.3
and deny Vaadin/fsevents scripts. A clean install reports no unreviewed scripts
and zero vulnerabilities. The build separates date/sanitizer libraries, reducing
the shared main chunk from 1.508 MB to 1.414 MB. A measured 1.45 MB SDK warning
ceiling is paired with enforced per-chunk budgets, retaining a 500 KB default
for other chunks. This does not claim a comparable reduction in total startup
JavaScript or split the SDK's large individual modules.

Builds and budget checks pass on Node 22/26. Both built-output and refreshed-dev
native suites pass eight cases and 40 tab switches each. The stale local tabs
were reloaded; current loader chunks return HTTP 200. Only the canonical dev
server remains running. See [session 0008](session-logs/2026-11-03-0008-session-log.md).
These changes were initially committed with `[skip ci]` without deployment in
[session 0009](session-logs/2026-11-03-0009-session-log.md). They are now published
with the view-retention release in session 0011.

## Verification Scope

Match verification to the affected behavior. Documentation and install-script
policy changes need focused checks, not rendering suites. Small UI/configuration
changes need the affected browser case; bundle splitting needs a built-output
smoke check. Broaden coverage for shared map/projection/lifecycle changes or a
concrete failure. Reuse earlier results when the tested code is unchanged.
For publication, run one final regression rather than repeatedly testing the
same candidate. Do not rerun full dev and built rendering matrices merely for
reassurance. This scope follows the owner's feedback in session 0009.

## Globe Scale Bar Release

Published with owner approval in [session 0013](session-logs/2026-11-03-0013-session-log.md):
removed the globe-layout `bottom: 76px`
override that raised the CNMI/Guam, American Samoa and Hawaii scale bars.
Visible bars now use the normal 5px lower-left inset. Focused Lambert/Albers
checks passed at two sizes and three scales without globe overlap; compact-pane
hiding is unchanged. See [session 0012](session-logs/2026-11-03-0012-session-log.md).
The Node 22 build and all 578 chunk budgets passed. Pages deployment succeeded;
both live entry points, both main bundles and CSS match the verified local build.

## View Retention Release

Published with owner approval in [session 0011](session-logs/2026-11-03-0011-session-log.md):
ordinary tab visibility changes and drawer
closure no longer destroy map views. Drawers still create their views lazily
on first open, then retain them. Only a trusted `webglcontextlost` event on a
tracked, actually lost canvas context marks its group for recovery. On the
next tab-visible transition, that group rebuilds with saved center, scale and
rotation; unaffected groups remain intact.

Native Chrome verification passed 12 two-tab and 18 three-tab switches at
different sizes and URL options. Every switch retained all view identities:
`created` stayed `9,8` or `9,8,9`, respectively. DevTools Protocol Network
capture recorded zero new layer-query requests during every switch. Main,
PR and drawer native context-loss recovery also passed, with exact navigation
restoration. Focused lint/syntax checks and the Node 22 production build,
dependency checks and all 578 chunk budgets passed. Older full rendering
matrices were not repeated. See [session 0010](session-logs/2026-11-03-0010-session-log.md)
for per-switch evidence, the repaired synthetic-event fixture and test limits.

This behavior supersedes the destroy-on-hidden/close policy below. The final
publication regression passed eight projection/layout/viewport cases and 40
two-tab stress switches. Pages deployment succeeded, and 28 live entry points,
key JavaScript bundles and styles matched the verified build byte-for-byte.

## Earlier Performance Changes

Canvas 2D locator globes replace Three.js; globe layouts skip overview creation.
The earlier release created drawer/PR views on first open, destroyed them on
close, and destroyed hidden tabs' views before restoring navigation on return.
Session 0011 supersedes that destruction policy with retained views and actual-
loss-only recovery. Console diagnostics still report live document/iframe WebGL
contexts; contexts from genuinely destroyed views are explicitly released.

Unsupported `sharedViews` options are removed. Regional maps omit graticules;
only the standard overview owns them and its separate retained layer clones.
All four projection/layout combinations passed native Chrome at 1920x1080 and
2560x1600 for each implementation step. Final two-tab globe stress passed
40 switches with no context accumulation or context-limit warning. The build
passed. Dependency audit findings are resolved by the work below;
the large-bundle warning remains.

See [session 0004](session-logs/2026-11-03-0004-session-log.md) for counts,
validation limitations and the proposed, unimplemented iframe migration.
Published with owner approval in session 0007; production regression checks passed.

## Published Scale Bar and Dependency Repairs

Published: all seven ScaleBar construction sites now use the installed
4.32 `arcgis-scale-bar` component, with explicit view-owned cleanup. Globe mode
still creates only six bars. Dual units, positions, true line lengths and compact
pane hiding match the former widgets across all ten ADR landscape sizes and
both projections/layouts. Final native checks passed 40 cases at three scales,
panel/tab lifecycle checks, and the existing eight-case browser regression suite.

A fresh `npm ci` and `npm audit` report zero vulnerabilities, down from 18.
The deprecated `node-domexception` dependency is absent. Compatible security
updates, an owner-approved ESLint 10/React lint migration and two targeted
overrides resolve the dependency issues without changing ArcGIS or React runtime
versions. Dependency tests and production builds pass on Node 22.22.0 and
26.13.0; the fresh installation used Node 26.13.0/npm 11.20.0.

The updated lint configuration reports 16 findings in untouched CSS/reference
code; changed JavaScript passes. npm still reports three install-script approval
warnings. No blanket script approval was added. These results supersede the
historical pending-audit statements below, not the production release record.
See [session 0006](session-logs/2026-11-03-0006-session-log.md) for exact versions,
override rationale, evidence and limitations. Publication is verified;
see [session 0007](session-logs/2026-11-03-0007-session-log.md) for the release outcome.

## Published Release

- Runtime commit: `2b7585a9ac9bc3ddf01c14fe0e77db0f8c8da7ea`.
- Pages deployment `7537722075` succeeded at
  2026-11-03 20:14:07-08:00[America/Los_Angeles] in
  [run 41771815447](https://github.com/dasbury-esri/usa-equal-area-map/actions/runs/41771815447).
- [Production](https://dasbury-esri.github.io/usa-equal-area-map/) and
  [Albers](https://dasbury-esri.github.io/usa-equal-area-map/?projection=albers)
  now use responsive framing without an opt-in parameter.
- Focused globe scale-bar checks passed both projections at 1280x800 and
  1920x1080, each at three scales. Earlier broad regression and retention/recovery
  evidence is retained in sessions 0010/0011; those suites were not rerun for
  this CSS-only runtime change.
- Both live HTML entry points, both main JavaScript bundles and the stylesheet
  match the verified build byte-for-byte. See
  [session 0013](session-logs/2026-11-03-0013-session-log.md) for current publication
  evidence; sessions 0007/0011 retain the earlier release records.

## Current state

The project is an unfinished Vite/npm modernization of the expanded overview
implementation in its [predecessor repository](https://github.com/dasbury-esri/usa-equal-area-map-proto).
The predecessor remains a historical reference, not a second active project.
The migration copied the predecessor's `overview/js/map2.js` byte-for-byte
in commit `a8ca91f`, then moved the application to ArcGIS 4.32 ES modules.

The local drawer repair gives Vite both HTML entry points, initializes only
the maps belonging to each page, and synchronizes scales through origin- and
source-checked iframe messages. The toggle works independently of map loading;
recentring preserves zoom. ArcGIS popup initialization and scale watchers now
follow the installed SDK's lazy-popup and reactive APIs.

Build and native browser checks verified drawer toggling, inset rendering,
two-way scale changes and a narrow-screen layout. The earlier background and
state-boundary item failures were superseded by the owner's replacement items;
both current layers loaded in the production smoke checks.
Dependency review was left pending in that repair; this session adds the
globe-rendering dependencies described below without resolving the audit. The owner's
tracking fields and exact next action above are preserved. See
[session 0002](session-logs/2026-11-02-0002-session-log.md) for verification scope.

An opt-in `?overview=globes` experiment replaces the middle overview pane with
small locator globes and recenter labels. The default URL retains the existing
layout. The experiment adds rendering dependencies but does not perform the
pending dependency audit or add pan limits. See
[session 0003](session-logs/2026-11-02-0003-session-log.md).

The local `?projection=albers` option selects the existing custom Albers
definitions for CONUS, PR/USVI, Alaska, the overview, Guam/CNMI, American
Samoa, and Hawaii. It also works with `?projection=albers&overview=globes`;
both options are forwarded to the drawer iframe. Missing or unknown projection
values retain Lambert. Saved centers retain their source spatial references,
so changing projection does not reinterpret Lambert meters as Albers meters.
Native browser checks and the production build passed for both projections.
The owner's current Albers Alaska meridian is -146 and the overview meridian
is -140 in both projections. Their regional cartographic suitability has not
been fully audited. This option is included in the published release above.

Responsive framing is now the default, with no `framing=preview` flag required.
The plain URL remains Lambert; `?projection=albers` selects Albers, and either
works with `overview=globes`. The active 1920x1080 Albers Alaska/overview captures
are saved in [experiments/framing-placement.js](experiments/framing-placement.js).
Lambert and Albers have independent overview presets. Alaska's Albers footprint
fits both pane dimensions; CONUS constraints can enlarge the shared footprint
to prevent clipping. The older construction defaults remain in
[src/view-defaults.js](src/view-defaults.js), but responsive initialization now
overrides the main/Alaska/overview framing. Closing or resizing resets the fit;
globe inset recenter buttons restore regional centers at the current scale.
The owner's `6 / 9` drawer ratio and default closed drawer states are preserved.

Alaska's default was subsequently updated to the owner's adjusted view. Its
bold label is at the upper left and its scale bar at the lower left in both
layouts, with the globe trial retaining its recenter action and scale ratio.
All plain frame labels now share the same top-left anchor, 5-pixel padding,
12-pixel bold type, and tight line spacing. The overview is labeled "The
United States" instead of a numeric scale, with its distance bar at the lower
right. The trial's recenter labels are consistently upper-left and left-aligned.

The non-globe overview now has dynamic leader lines from each island panel's
quarter-width top-edge anchor to its displayed extent rectangle's east-edge
midpoint. They follow extent changes, overview navigation, and resizing;
offscreen attachment points hide their lines. The overlays do not intercept
map input.

The globe trial now shows numeric scale ratios beside each inset name. A
trial-only width constraint was compressing distance bars without changing
their labels; that constraint is removed. Island bars sit above the globes
and are hidden in panes narrower than 180 pixels, where Alaska's shared bar
and the individual ratios remain visible. Native wheel-zoom checks verified
bidirectional scale synchronization and true rendered bar lengths.

Zoom anchors now transition the four insets from their saved regional centers
to Anchorage, Honolulu, Pago Pago, and Guam airport-area centers by
1:1000000. Earlier city anchors were superseded. The latest manual-pan change
tracks a separate user-selected center per inset and is intended to preserve
it on subsequent zooms; reload or a trial recenter button restores automatic
following. **Native pan-then-zoom validation for those four insets is incomplete.** Preserve this
as a work-in-progress checkpoint, not a fully verified navigation fix. See
the session log for the remaining drag-event investigation and test gaps.

PR/USVI now uses the same zoom-anchor helper, retaining its original starting
center and scale and reaching Luis Munoz Marin International Airport (SJU) by
1:1000000. A native landscape browser test verified a real PR drag followed
by CONUS-driven zoom and local wheel zoom with no center drift. The other
four airport anchors also passed regression checks; this does not certify
their previously incomplete manual-pan, keyboard, or touch cases.

The PR/USVI drawer now extends from the standard island-row top (79%) to the
viewport bottom in both layouts. The globe preview adds a PR/USVI locator
globe and current-scale recenter control, and places the CONUS globe above
the closed right-hand tab. Landscape geometry, globe pixels/movement, and
recenter checks passed at 1024x600, 1280x800, and 1920x1080.

The overview receives PR/USVI extent geometry from the parent page through
origin/source-checked messages, with a ready handshake for iframe reloads.
It now has four extent rectangles, retaining the three existing leader lines
and no PR leader. Rectangle updates no longer automatically navigate the
overview; its current extent is preserved through linked pan/zoom updates.

The requested World Countries context item
`42430a34a2b44c0da678ce60ce20dd31` now sits beneath congressional
districts in both layouts, retaining its saved colors with normal blending and
popups disabled. Native checks confirmed eastern-hemisphere Aleutian land in
this context layer; the current congressional service omits that geometry.

The United States and Outlying Areas item
`bbda2d6bc77c495ab382e313f02888f1` sits between that country context and
districts, temporarily styled red with popups disabled. Its saved geographic
filter is preserved. Native pixel checks confirmed red eastern-hemisphere
Aleutian land; the service returns all seven country/territory groups in the
filter. The layer is present in both layouts, including the original overview.

## Done

- [x] Compared the successor and predecessor source and Git history.
- [x] Established the owner-requested tracking fields.
- [x] Repaired drawer initialization, iframe packaging and scale synchronization.
- [x] Checked the development and production builds in a native browser.

## Layout Validation Scope

- [Provisional ADR 0001](docs/adr/ADR-0001-responsive-landscape-map-framing.md)
  formalizes 16:9 and 16:10 as primary design targets, with 21:9 and common
  ultrawide variants as edge cases across multiple CSS-pixel resolutions.
- The proposed direction replaces fixed-scale initial framing with a
  viewport- and drawer-aware fit, aiming for broad regional coverage, minimal
  unused margin, and reduced duplicated geography when both drawers are open.
  The overview is exempt from the non-duplication goal. Alaska's fit is computed
  while the left drawer is closed, then supplies the shared scale on opening;
  CONUS recenters without clipping and linked zoom is enforced while open.
  Preserve Alaska's north and panhandle; western Aleutian clipping may be
  accepted in both layouts, including globe mode without an overview. When
  the standard overview is present, retain the complete chain there. Tight
  geographic margins are accepted rather than imposing a universal minimum. PR/USVI
  toggles leave CONUS unchanged; minimal reference-tab overlap is accepted.
  Exact geographic targets and acceptance tolerances remain provisional.
- Responsive framing is now the normal startup/navigation behavior.
  Existing `framing=preview` links remain compatible, but the parameter is not
  needed with `projection=albers`, `overview=globes`, or both. Actual pane sizes
  drive the Alaska-led fit, constrained to keep CONUS visible with its upward
  placement and tight edge allowance. Closing or resizing resets framing;
  airport-following is disabled. Globe inset recenter buttons restore regional
  centers at the current scale. Other manual-navigation/resize policies remain
  outside this change.
- The isolated Lambert/standard-layout probe passed Alaska-led scale-fit
  checks at 1920x1080 and 2560x1600 without clipping CONUS at the left drawer
  or viewport edges or clipping the selected Alaska boundary. Composition
  is not yet accepted: centered open framing duplicates part of Alaska, and
  centered closed framing hides Florida behind the PR/USVI panel. The ADR
  records these measurements and the next placement experiments.
- The owner accepts initial closed-drawer CONUS framing at both reference
  aspect ratios and has manually adjusted open-drawer references. The ADR
  preserves all seven views' centers, scales, rotations, extents, and pane
  sizes for 1920x1080 and 2560x1600. These indicate a shared upward CONUS
  placement intent, but different Alaska coverage/scale choices; they are
  reference evidence, not new runtime defaults.
- The default URLs passed 16 native checks: all four projection/
  layout combinations at 1280x800, 1920x1080, 2560x1600 and 3440x1440. Selected
  boundary checks found no open CONUS clipping, PR overlap, or duplicated
  Alaska/Hawaii; full Alaska remains in standard overviews. Globe rendering,
  movement, inset recentering and reference-size navigation/resize checks passed.
  The build passed. Fixed-scale/airport-following tests of the former default
  are superseded. The closed PR overlap and wider untested matrix remain
  limitations. Only repository-backed port 5173 runs. The current -146 Albers
  Alaska reference and independent -140 overview presets were captured and
  validated; a 0.2% Lambert overview allowance preserves its northern coverage.
  Owner layer changes are preserved.
  The approved implementation is committed and published as the release above.
- Portrait/mobile-portrait rendering, screenshots, and layout optimization
  are not required checks or release gates. Revisit only when the owner
  explicitly brings that work back into scope.
- Use the ADR's proposed viewport matrix for future framing work. Earlier
  checks at 1024x600, 1280x800, and 1920x1080 remain historical evidence, not
  proof of acceptance under the new framing goals.
- Earlier portrait results in session logs are historical observations, not
  continuing requirements. General accessibility and resizing still apply.

## Next

Follow the authoritative `next_action` above. Preserve the predecessor as a
reference while verifying the repaired application.
