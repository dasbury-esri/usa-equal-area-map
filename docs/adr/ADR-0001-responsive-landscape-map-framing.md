# ADR 0001: Responsive Landscape Map Framing

- Status: Proposed / provisional
- Recorded: 2026-11-03 12:43:24-08:00[America/Los_Angeles]
- Scope: Initial composition of CONUS and regional inset maps
- Implementation: Responsive framing is the local default; not published

## Context

The prototype starts its linked regional views at a fixed scale of
1:24,000,000 and uses saved centers, including an offset CONUS center when
the left drawer opens. Those values provided a useful starting point, but
do not adapt the initial composition to differing viewport dimensions or
the space obscured by drawers and controls.

The owner now prioritizes 16:9 and 16:10 landscape layouts, with 21:9 as an
ultrawide edge case, across multiple resolutions. The intent is to show as
much relevant geography and thematic content as possible on initial load,
with minimal unnecessary margin. When both drawers are open, CONUS should
ideally avoid showing geography already assigned to a regional inset. The
overview is intentionally exempt from that non-duplication goal.

The owner cited 1920x1080 and 2560x1600 reference views as 16:9 and 16:10 test sizes. Treat the described
reference compositions as visual intent, not verified aspect-ratio evidence
or a pixel-exact specification.

## Provisional Decision

### Supported Viewports

- Design primarily for 16:9 and 16:10 landscape application viewports.
- Test 21:9 and common near-21:9 ultrawide viewports as edge cases.
- Measure the application's actual CSS-pixel viewport, not monitor resolution,
  screenshot bitmap dimensions, or dimensions including browser/editor chrome.
- Portrait optimization remains outside the current acceptance scope.

### Initial Framing

- Replace the fixed initial scale as a design constraint with a fit derived
  from the selected projection, target geographic coverage, pane dimensions,
  and unobscured usable area. The existing scale remains only an implementation
  baseline until the responsive behavior is built.
- Fit relevant regional geography, not the global bounds or feature count of
  an arbitrary loaded layer. Worldwide context layers must not force a world
  extent into a regional pane.
- Prioritize agreed regional coverage and readable, unobstructed controls;
  then maximize useful geographic content and minimize unnecessary margins.
  Do not obtain a tighter-looking fit by silently clipping priority geography.
- While the left drawer is closed, fit CONUS to the full viewport independently
  of Alaska. Precompute Alaska's regional fit from its intended open-pane
  dimensions, viewport, and projection while the drawer is still closed.
- Opening the left drawer applies the precomputed shared scale to CONUS and
  the regional insets and recenters CONUS in the unobscured area. Start with
  Alaska's preferred framing, increasing the scale denominator if required
  to fit CONUS beside the drawer at the selected vertical anchor. Compute
  this constraint before opening; do not crop required CONUS geography.
- Once the left drawer is open, enforce linked scales for subsequent user
  zooms across CONUS and the regional insets. The overview remains independently
  scaled. Closing/reopening after manual navigation requires a separate policy.
- Shared scale can prevent every pane from having equally tight margins.
  Record that tradeoff during evaluation; independent inset scales are not
  authorized while the left drawer is open.
- Tight geographic margins are an accepted tradeoff. The earlier 16-pixel
  trial margin is not a required minimum, and equal margins across every
  aspect ratio/resolution are not an acceptance requirement. Continue checking
  required geographic coverage and control accessibility.
- Evaluate Lambert and the opt-in Albers mode independently. Preserve target
  geographic coverage rather than reusing projected coordinates or assuming
  the two projections should have identical numeric scales or extents.

### Drawers and Geographic Ownership

- Account for closed, left-open, right-open, and both-open drawer states.
  Both-open is the principal composition case for reviewing non-duplication;
  this does not change which drawers open by default.
- Opening or closing PR/USVI does not change CONUS center or scale. The minimal
  PR/USVI tab overlap with Florida in the owner's reference views is accepted;
  this does not authorize arbitrary coverage by the drawer panel. Do not
  reserve an entire right-hand strip just to eliminate that small overlap.
- Account for the left drawer and controls when composing the open-drawer
  CONUS view. Use actual pane footprints rather than a blanket right inset.
- The main view owns the contiguous United States; regional views own Alaska,
  Hawaii, Guam/CNMI, American Samoa, and PR/USVI respectively. Exact geographic
  target envelopes and treatment of peripheral islands remain to be agreed.
- Alaska's initial fit must preserve its northern extent and eastern panhandle.
  Prefer the entire Aleutian chain; if a compromise is needed, western Aleutian
  clipping is allowed in both standard and globe layouts. When an overview is
  present, retain the complete chain there; its absence in globe mode does not
  prohibit western clipping. Do not trade away the north or panhandle.
  The owner explicitly accepted the no-overview fallback on
  2026-11-03 14:22:53-08:00[America/Los_Angeles].
- Prefer framing that avoids exposing those inset-owned U.S. geographies in
  the main view when both drawers are open. This is a composition goal, not
  a reason to crop required CONUS coverage or hide data silently.
- The overview may repeat all regions. Neighboring countries, ocean, and
  other contextual geography may appear in multiple panes. Compare visible
  geographic footprints, not merely feature IDs from multipart/global layers.
- If positioning alone cannot satisfy coverage and non-duplication, document
  the residual overlap. Region-specific clipping or filtering requires a
  separate implementation decision; it is not prescribed by this ADR.

### Interaction Boundaries

- Responsive initialization must not continuously override a user's pan or
  zoom. Distinguish automatic fit state from user-controlled navigation.
- Drawer transitions and resizing must preserve access to controls and avoid
  obscuring priority geography while automatic fit is active. The exact
  reframe policy after manual navigation remains an implementation question.
- Revisit drawer logic keyed to the old fixed scale and airport-anchor
  interpolation based on that scale. A viewport-derived starting scale must
  not accidentally initialize an inset at its airport instead of its region.
- Keep initial fit, user zoom synchronization, and current-scale recenter
  actions distinct. No change to those controls is implemented here.

## Proposed Validation Matrix

| Viewport family | CSS-pixel test sizes | Role |
| --- | --- | --- |
| 16:9 | 1280x720, 1920x1080, 2560x1440 | Primary |
| 16:10 | 1280x800, 1920x1200, 2560x1600 | Primary |
| Exact 21:9 | 2520x1080, 3360x1440 | Ultrawide edge |
| Common ultrawide | 2560x1080, 3440x1440 | Near-21:9 edge |

The matrix supersedes earlier example dimensions as the proposed design
target; previous checks at other landscape sizes remain historical evidence.
Exercise both overview/globe layouts and Lambert/Albers projections. Review
all four drawer states, emphasizing both-open composition, and repeat
representative resize and manual-navigation transitions.

For each evaluated case, capture the actual viewport and pane bounds,
projection, drawer state, resulting centers/scales, and a settled screenshot.
Check target coverage within unobscured pane areas, duplicated regional
geography, unused margin, and control/label overlap. Document the limiting
pane when shared scale introduces extra margin elsewhere. Missing remote
layers or incomplete rendering cannot count as successful coverage checks.

Acceptance requires agreed coverage targets and tolerances, no broken or
inaccessible controls, and no unexpected reset of manual navigation.
Quantitative coverage, duplication, and margin thresholds remain provisional;
this record does not claim that current layouts satisfy them.

## Consequences and Open Questions

- Initial scale will vary with viewport, layout, drawer state, and projection;
  a single fixed-scale screenshot is no longer the universal baseline.
- Select geographic target data that includes the full Aleutian chain on both
  sides of the antimeridian. Define Hawaii and other peripheral-island coverage;
  Alaska's north/east priorities and western fallback in both layouts are agreed.
- Measure geographic/control clearance without imposing a universal geographic
  padding minimum; tight margins are accepted, while control access remains required.
- Evaluate whether shared scale yields acceptable coverage and margins at
  the smallest primary viewport; escalate conflicts instead of silently
  changing the comparative-scale behavior.
- The reference dimensions are confirmed as 1920x1080 and 2560x1600. Resolve
  the closing/reopening and resize policy after manual navigation, and whether
  PR/USVI continues following CONUS scale while the left drawer is closed.
- No runtime, projection-parameter, layer-filter, default drawer-state, or
  publication change is authorized or performed by recording this proposal.

## Initial Feasibility Evidence

An isolated native-Chrome experiment on 2026-11-03 tested Lambert with the
standard overview layout, using a provisional 16-CSS-pixel geographic margin.
It queried the existing World_Countries feature service, layer 0, with
`ISO_CC = 'USA'` (four records), and selected CONUS, Alaska, and Hawaii rings
by geographic region. The Alaska selection includes positive-longitude
Aleutian coordinates across the antimeridian. This is a working target dataset,
not final acceptance of the geographic inventory.

Alaska's fit was computed while the left drawer was closed. The experiment
then applied that scale to CONUS and Alaska and positioned CONUS at the center
of the area beside the open left drawer. It did not change application code
or implement the proposed closed/open scale-linking state machine.

| CSS viewport | Closed CONUS fit | Alaska-derived shared scale | CONUS edge clipping | Selected Alaska clipping |
| --- | --- | --- | --- | --- |
| 1920x1080 | 1:10,145,650 | 1:20,006,052 | None | None |
| 2560x1600 | 1:6,843,075 | 1:13,292,222 | None | None |

Scales are rounded observations, not new constants. Native screen-coordinate
checks and independent polygon intersection/difference checks agreed that
CONUS fits beside the drawer at these scales. The Alaska selection, including
the north, panhandle, and full selected Aleutian chain, fits without using the
western-clipping fallback. Its boundary also fits the existing overview.

This establishes scale feasibility, not complete composition acceptance:

- Centering CONUS in the remaining rectangle still exposes part of Alaska
  near the top of the main view. Independent intersection measured about
  84,098 and 81,799 square kilometers respectively; Hawaii did not duplicate.
- The centered closed-drawer fits put about 47,470 and 21,604 square kilometers
  of CONUS geometry behind the PR/USVI panel, plus tab overlap. This exceeds
  the agreed tab-only allowance and is not accepted. The open-drawer candidate
  has no measured CONUS overlap with that panel or tab.
- PR/USVI opening preserved CONUS center/scale. The probe did not certify
  all other regional fits, all controls, full duplication prevention, manual
  navigation transitions, Albers, globe mode, or the wider viewport matrix.

Next, evaluate corner-aware placement for the independent closed CONUS fit
and vertical placement at the unchanged Alaska-derived open scale. Do not
solve residual duplication by silently filtering or clipping layers. The
independent checker uses polygon-clipping, Terraformer ring conversion, and
d3-polygon planar areas, with rectangle/hole/overlap/difference controls;
all dependencies and probe artifacts remain outside the repository.

## Default Responsive Framing

Use the single repository-backed dev server at
`http://127.0.0.1:5173/usa-equal-area-map/` (`npm run dev`). Port 5174 and its
temporary source snapshot are retired; all URL combinations use port 5173.
Changes are reviewed locally before an explicitly approved production push.

Responsive framing now runs without an opt-in parameter. Supported URLs are:

- The plain application URL: Lambert, standard overview.
- `?projection=albers`
- `?overview=globes`
- `?projection=albers&overview=globes`

All recognized flags are forwarded to the drawer. Missing/unknown projection
values retain Lambert; missing/unknown overview values retain the standard
layout. Existing `framing=preview` URLs remain compatible aliases; the flag is
no longer required and does not select a separate startup behavior.

- Left closed: CONUS uses its full-viewport fit; Alaska and the other left
  insets retain their precomputed shared scale. PR/USVI follows CONUS.
- Left open: CONUS recenters beside the drawer with its boundary-envelope
  midpoint at 38% of viewport height. The shared scale starts with the owner's
  Alaska framing, subject to CONUS width/height constraints with 2-pixel edge
  allowances. It uses actual pane sizes, including the taller globe-mode Alaska.
  Lambert retains its north/east alignment; Albers retains its saved center and
  fits the captured footprint by both width and height, protecting its panhandle
  in the taller globe pane. Western clipping remains accepted. Subsequent
  scale changes are linked in both directions across the regional views.
- PR/USVI toggles do not reframe CONUS. Closing the left drawer or resizing
  resets the fit, rather than preserving manual navigation. This is the current
  adopted behavior; changing that interaction policy would be a separate decision.
- Airport-following is disabled to prevent the old fixed-scale interpolation
  from displacing the regional centers. Globe inset recenter controls restore
  their regional centers at the
  current scale, including Alaska's most recent automatic fit.
- The accepted Lambert closed fit retains its 16-pixel allowance. CONUS and
  Lambert Alaska use measured projected envelopes, not relabeled coordinates.
  Bounds were measured from the same World_Countries query and region selection
  described above: four USA records, 5527 CONUS rings and 7110 Alaska rings,
  including positive-longitude Aleutians. Albers Alaska instead uses the captured
  reference below; its obsolete -150-meridian envelope was removed. There is no
  new runtime boundary query.
- Standard overviews have independent Lambert and Albers presets, not one
  shared center interpreted in two projections. Albers uses the owner's active
  reference below; Lambert retains its own center and a 0.2% zoom-out allowance
  to contain northern Alaska at its current -140 meridian. Both rotations remain
  20 degrees. Hidden globe-mode overviews are not fitted or awaited.
- See [framing-preview.js](../../src/framing-preview.js) for integration and
  [framing-placement.js](../../experiments/framing-placement.js) for bounds and
  the fit calculation. Projection parameter changes require remeasuring bounds.

### Adopted Albers Reference

Captured at 2026-11-03 14:57:13-08:00[America/Los_Angeles], with both shared tabs
settled and their left drawers open. The active 1920x1080 tab is the canonical
reference, not an average of the two independently adjusted views. Its Alaska
and overview footprints are reproduced at their reference pane sizes and scaled
responsively elsewhere. The 2560x1600 captures are retained as comparison evidence.

Coordinates are projected meters in WGS84 Albers, with zero false offsets.
Alaska: central meridian -146, standard parallels 55/65, origin latitude 50.
Overview: central meridian -140, standard parallels 29.5/45.5, origin latitude 23.
These owner projection definitions are preserved. Alaska rotation is 0 degrees;
overview rotation is 20 degrees. Overview SDK extents alone do not describe the
rotated visible footprint, so its center, resolution and rotation are also retained.

| Reference / view | Native pane | Center x, y | Scale denominator | Resolution |
| --- | --- | --- | --- | --- |
| Active 1920x1080 / Alaska | 719x453 | -601787.4469695078, 1417319.4019033893 | 17444538.24388772 | 4615.543308115242 |
| Active 1920x1080 / overview | 719x399 | 19020.2579054083, 1993265.05938231 | 81057512.0815336 | 21446.509631258363 |
| Comparison 2560x1600 / Alaska | 1066x671 | -602490.5688749773, 1423071.8197813754 | 11777013.151238654 | 3116.007628280484 |
| Comparison 2560x1600 / overview | 1066x591 | 9361.697306635053, 2277944.2295240066 | 54724107.14133995 | 14479.115639377475 |

| Reference / view | SDK extent: xmin, ymin, xmax, ymax |
| --- | --- |
| Active / Alaska | -2261075.2662369376, 371898.8426152868, 1057500.3722979217, 2462739.9611914917 |
| Active / overview | -7690999.954531972, -2285313.6120537333, 7729040.47034279, 6271843.730818354 |
| Comparison / Alaska | -2263322.634748475, 377651.26049327303, 1058341.4969985206, 2468492.379069478 |
| Comparison / overview | -7708006.938481559, -2000634.4419120369, 7726730.333094829, 6556522.9009600505 |

### Default-URL Validation

Native Chrome checks without `framing=preview` passed for all four combinations at 1280x800, 1920x1080,
2560x1600 and 3440x1440 (16 combinations). Independent full-boundary polygon
checks found no open-layout CONUS edge clipping, PR-panel/tab overlap, or
duplicated Alaska/Hawaii in these cases. Alaska's north/east/south bounds stayed
inside its pane, with permitted western clipping; standard overviews retained
the full selected Alaska boundary. The unchanged closed fit retains its earlier
PR-panel overlap limitation. This is not completion of the full proposed matrix
or acceptance of every region's peripheral-island inventory.

At both reference sizes, PR toggles, bidirectional linked zoom, closed-drawer
independence and resizing to 1280x800 passed in every mode. Globe pixels,
movement and all five inset recenter controls passed; smaller/reference/ultrawide
screenshots were inspected. Exact numeric checks reproduce the active Albers
Alaska extent and overview center/resolution/rotation. Editor diagnostics and
the production build passed. Old fixed-24M/airport-following normal-mode checks
are superseded by this default behavior, not claimed as passing regressions.
The large-bundle warning remains. No publication occurred.

## Owner-Adjusted References

Captured without moving, resizing, or reloading either preview at
2026-11-03 13:48:51-08:00[America/Los_Angeles]. Both drawers were open, both
viewports had devicePixelRatio 1, and all views were stationary and not updating.
The actual CSS viewports were 1920x1080 and 2560x1600. The owner accepts the
initial closed-drawer CONUS framing and scale at both aspect ratios; preserve
that initial behavior while refining the open-drawer composition. This feedback
does not convert the earlier PR-panel overlap measurement into a tab-only result.

The 16:9 shared scale changed from 1:20,006,052 to 1:17,173,614: its denominator
decreased 14.16%, making geography larger. CONUS moved upward on screen; Alaska
moved east/south in projected coordinates, preserving its north and panhandle
while clipping the western chain. The 16:10 shared scale and Alaska center
remain the preview defaults, while CONUS received a similar upward shift.
Both overviews were independently reframed and retain 20-degree rotation.
PR/USVI and the three lower insets retain their geographic centers; their
scales follow the linked group.

### Captured Centers and Scales

Coordinates below are projected meters, not longitude/latitude. All references
use the app's WGS84 Lambert azimuthal equal-area definitions, meter units,
and zero false easting/northing. Projection origins (longitude, latitude):
CONUS (-99, 40), Alaska (-148, 64), overview (-148, 17.25), PR/USVI (-65.5, 18),
Guam/CNMI (145, 16), American Samoa (-170, -14), Hawaii (-156, 20).

| View | 1920x1080 center x, y | 2560x1600 center x, y |
| --- | --- | --- |
| CONUS | -1472669.3867375536, -784388.9643921833 | -1718533.6849443405, -813444.880903829 |
| Alaska | -428469.1623874029, -138990.10330874327 | -686275.8698254115, -67649.69566501735 |
| Overview | 482982.65986522695, 1773639.360344211 | 523145.72421023436, 1669207.291147061 |
| PR/USVI | 0, 0 | 0, 0 |
| Guam/CNMI | -220904.09442749288, 19239.560462744863 | -220904.09442749288, 19239.560462744863 |
| American Samoa | 0, 22127.685937255887 | 0, 22127.685937255887 |
| Hawaii | -208614.32477877635, 56598.85142393029 | -208614.32477877635, 56598.85142393029 |

| Property | 1920x1080 | 2560x1600 |
| --- | --- | --- |
| Linked scale denominator | 17173613.79904554 | 13292222.374467164 |
| Linked resolution, meters/CSS pixel | 4543.861072052943 | 3516.9075370595115 |
| Overview scale denominator | 81057512.0815336 | 59916351.3675908 |
| Overview resolution, meters/CSS pixel | 21446.509631258363 | 15852.899671807743 |
| Rotation | Overview 20 degrees; other views 0 | Overview 20 degrees; other views 0 |
| Left drawer CSS width | 720 | 1066.65625 |
| Alaska native view size | 719x453 | 1066x671 |
| Overview native view size | 719x399 | 1066x591 |
| Each lower inset native view size | 239x227 | 355x336 |
| PR/USVI native view size | 378x225 | 378x334 |

Native view dimensions differ slightly from CSS border-box dimensions. At
2560x1600 the lower insets report scale 13292222.374467162, differing from the
parent group only by floating-point rounding.

### Captured SDK Extents

Values are xmin, ymin, xmax, ymax in each view's projection. Preserve rotation
alongside the overview extent; do not treat that extent alone as its rotated
visible footprint.

| View | 1920x1080 extent |
| --- | --- |
| CONUS | -5834776.015908379, -3238073.9433007725, 2889437.2424332723, 1669296.0145164058 |
| Alaska | -2061987.217790436, -1168174.6361287348, 1205048.89301563, 890194.4295112484 |
| Overview | -7227037.552572154, -2504939.3110918324, 8193002.872302608, 6052218.031780254 |
| PR/USVI | -858789.7426180063, -511184.3706059561, 858789.7426180063, 511184.3706059561 |
| Guam/CNMI | -763895.4925378195, -496488.6712152642, 322087.30368283385, 534967.7921407539 |
| American Samoa | -542991.3981103267, -493600.5457407531, 542991.3981103267, 537855.9176152649 |
| Hawaii | -751605.7228891031, -459129.3802540788, 334377.07333155035, 572327.0831019393 |

| View | 2560x1600 extent |
| --- | --- |
| CONUS | -6220175.332380515, -3626970.910551438, 2783107.962491834, 2000081.1487437803 |
| Alaska | -2560787.5870781313, -1247572.1743484833, 1188235.847427308, 1112272.7830184489 |
| Overview | -7926449.800863292, -3015324.5618721275, 8972741.24928376, 6353739.144166249 |
| PR/USVI | -664695.5245042477, -587323.5586889384, 664695.5245042477, 587323.5586889384 |
| Guam/CNMI | -845155.1822555561, -571600.905763253, 403346.9934005703, 610080.0266887428 |
| American Samoa | -624251.0878280632, -568712.780288742, 624251.0878280632, 612968.1521632537 |
| Hawaii | -832865.4126068396, -534241.6148020676, 415636.7630492868, 647439.3176499282 |

### Reusable Intent, Not New Defaults

Using the experiment's geographic envelopes, CONUS's footprint midpoint is
at 50.14%/50.26% of the width beside the drawer and 37.26%/38.37% of viewport
height. Its footprint occupies 83.94%/87.15% of that available width. These
suggest horizontal centering and an upward composition anchor near 38%,
subject to geographic/occlusion checks, rather than copying literal centers.

Alaska's 16:9 north/east margins are approximately 1.88/16.08 CSS pixels, with
the full-envelope western bound 97.39 pixels outside the pane. Its 16:10
north/east margins are approximately 65.58/16 pixels, with the full envelope
inside. The 1.88-pixel northern clearance is tight across rounding and data
differences. The owner subsequently accepted tight tolerances; this observation
does not impose a larger minimum margin on later experiments.

A calculation fitting the same 16:9 Alaska extent into the 16:10 Alaska pane
yields approximately 1:11,594,109. At that shared scale the CONUS envelope
needs 1492.08 pixels of the 1493.34-pixel width beside the drawer, leaving only
1.27 pixels total. It cannot retain the trial's 16-pixel margin on each side.
This is a calculated cross-aspect constraint, not a new browser-tested candidate.
The owner's less-zoomed 16:10 composition avoids this conflict.

Preserve the accepted initial framing. Use these adjusted open-drawer states
as reference compositions for a constraint-based fit; do not install either
captured scale/extent as a universal default. No runtime source was changed
when recording this feedback, and both reference tabs were left untouched.

## Related Records

- [Project status](../../STATUS.md)
- [Session 0003](../../session-logs/2026-11-02-0003-session-log.md)
- Current baselines: [view defaults](../../src/view-defaults.js),
  [drawer navigation](../../src/drawer.js), and [map initialization](../../src/main.js).
