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

## Local Development

Use one repository-backed dev instance at
`http://127.0.0.1:5173/usa-equal-area-map/`. Start it with `npm run dev` from
this repository. Port 5173 is strict: a second start fails instead of moving
to another port. URL options select the preview, projection and layout on
that same server. Do not serve copied source snapshots for ongoing work.

The temporary port-5174 server is stopped. Continue editing this repository,
including [src/main.js](src/main.js); publish only after owner review and
explicit approval. The production site has not been changed.

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

The local `?projection=albers` option selects the existing custom Albers
definitions for CONUS, PR/USVI, Alaska, the overview, Guam/CNMI, American
Samoa, and Hawaii. It also works with `?projection=albers&overview=globes`;
both options are forwarded to the drawer iframe. Missing or unknown projection
values retain Lambert. Saved centers retain their source spatial references,
so changing projection does not reinterpret Lambert meters as Albers meters.
Native browser checks and the production build passed for both projections.
The owner's current Albers Alaska meridian is -146 and the overview meridian
is -140 in both projections. Their regional cartographic suitability has not
been fully audited. This option
is not yet committed or published.

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
  Nothing has been committed or published.
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
