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
updated: 2026-11-03
extra:
  agents: [copilot-enterprise]
  predecessor: usa-equal-area-map-proto
---

# USA Equal Area Map

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
two-way scale changes and a narrow-screen layout. Existing background and
state-boundary layers reported remote loading errors and remain unresolved.
Dependency review was left pending in that repair; this session adds the
globe-rendering dependencies described below without resolving the audit. The owner's
tracking fields and exact next action above are preserved. See
[session 0002](session-logs/2026-11-02-0002-session-log.md) for verification scope.

An opt-in `?overview=globes` experiment replaces the middle overview pane with
small locator globes and recenter labels. The default URL retains the existing
layout. The experiment adds rendering dependencies but does not perform the
pending dependency audit or add pan limits. See
[session 0003](session-logs/2026-11-02-0003-session-log.md).

The captured non-globe views are saved in
[src/view-defaults.js](src/view-defaults.js). The five inset/overview views
use the captured centers, scales, and rotations on load. CONUS starts centered
at longitude -97, latitude 38 and uses its captured offset position when the
drawer opens at the default scale; closing restores the centered position.
Both layouts use these defaults; the trial recenter buttons use the saved
inset centers. The owner's `6 / 9` drawer ratio is preserved. At the captured
window and pane sizes, opening the drawer reproduces all six saved extents.

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
map input or change the existing overview navigation behavior.

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
following. **Native pan-then-zoom validation is incomplete.** Preserve this
as a work-in-progress checkpoint, not a fully verified navigation fix. See
the session log for the remaining drag-event investigation and test gaps.

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

## Next

Follow the authoritative `next_action` above. Preserve the predecessor as a
reference while verifying the repaired application.
