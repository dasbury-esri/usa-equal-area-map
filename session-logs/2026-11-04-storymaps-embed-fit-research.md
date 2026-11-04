# StoryMaps Embed Dimensions and Fit-Test Handoff

- Measured: 2026-11-04 01:26:49-08:00[America/Los_Angeles]
- Scope: public ArcGIS StoryMaps reader geometry, not USA map acceptance.
- Reader build: `dbs2kJs8TJE8KFIBo0U4A`.
- No application code, existing tests, ADR, published story, or deployment changed.

## Findings

Small, Medium, and Large inline URL embeds use the same nominal **16:9**
fallback when no source dimensions or custom aspect ratio are supplied. Their
internal block sizes are `standard`, `wide`, and `full`. These are width choices,
not three different aspect ratios.

The native media wrapper rounds width divided by aspect ratio to a pixel height,
then normally limits height to **91% of the viewport height minus the application
offset**: `0.91 * (viewportHeight - appOffset)`. Thus Medium and Large can become
wider than 16:9 on short screens. Custom iframe dimensions and provider-supplied
dimensions can override the fallback; these measurements are not universal for
video, rich embeds, fixed-height surveys, or custom iframe code.

Sidecar media embeds have **no fixed aspect ratio**. They fill the media panel.
Docked narrative width, browser dimensions, header/navigation space, breakpoints,
and scrollbars determine the remaining frame. Floating and slideshow layouts use
the full media area, with narrative content overlaid rather than subtracted from
the iframe width. An iframe cannot infer that external overlay from its viewport.

## Native Measurements

Values below are the actual iframe `innerWidth x innerHeight` in CSS pixels,
suitable for application viewport fixtures. They are not host browser dimensions.

| Placement | Host 1280x720 | Host 1920x1080 | Host 2560x1600 |
| --- | --- | --- | --- |
| Inline Small (`standard`) | 817x459 | 827x465 | 827x465 |
| Inline Medium (`wide`) | 1233x597 | 1248x702 | 1248x702 |
| Inline Large (`full`) | 1185x597 | 1825x925 | 2465x1387 |
| Docked, small narrative | 843x656 | 1345x1016 | 1985x1536 |
| Docked, medium narrative | 753x656 | 1185x1016 | 1825x1536 |
| Docked, large narrative | 625x656 | 945x1016 | 1265x1536 |
| Floating media | 1265x656 | 1905x1016 | 2545x1536 |
| Slideshow media | 1265x656 | 1905x1016 | 2545x1536 |

These observations used native Chrome with a 15px vertical scrollbar, a 64px
story header, no story navigation bar, and the public reference story's theme.
For example, the 1920x1080 Large inline frame has a fractional outer height of
924.546875px and a 925px internal viewport. Rounding is intentional in the table.
At the 1280px breakpoint, the different grid/gutter rules made Medium wider than
Large; do not impose a monotonic-width assertion across those names.

An unmodified public reference story with navigation independently measured a
599x640 docked media panel in a 1024x768 host viewport. This is additional evidence
that header/navigation and minimum narrative widths matter, not another default
iframe fixture. Theme and reader changes can alter these observations.

## Handoff to Fit-Test Agents

1. Add an optional StoryMaps viewport family using the table's iframe dimensions,
   not the host dimensions. Deduplicate equal dimensions, but retain placement
   labels in artifacts. These complement the existing ADR landscape matrix.
2. Start with the 1920x1080 column's seven unique viewport sizes, then add the
   smaller-host cases to expose minimum pane/control constraints. The 2560x1600
   column supplies the taller and more strongly portrait docked cases.
3. Exercise Lambert/Albers, overview/globes, and all four drawer states. Capture
   actual viewport and pane bounds, geographic coverage, linked regional scales,
   scale-bar/control clearance, and settled screenshots. Include resize and
   manual-navigation preservation using the existing test helpers.
4. Treat large-narrative docked cases as explicit portrait stress cases. The
   current ADR excludes portrait optimization: record failures separately until
   that acceptance scope is agreed; do not silently weaken geographic coverage
   or scale-linking requirements to pass them.
5. Direct viewport tests verify the map's own geometry only. A real StoryMaps host
   check is still needed for floating/slideshow narrative occlusion, host embed
   interaction/open controls, scrolling, and small-screen fallback behavior.
6. Current docs define small screens as 960px wide or smaller and allow Card,
   Image, or Live display. Test the host breakpoint and the author's selected
   fallback separately. A narrow iframe inside a desktop story is not equivalent
   to a mobile host. Mobile layout measurements remain outside this probe.

## Reproduce and Limits

Run from the repository root:

```sh
node experiments/storymaps-embed-sizes.mjs
```

The probe fetches the public reader HTML and replaces its story bootstrap data
only in an isolated browser response. It creates three inline and five Sidecar
fixtures without explicit embed dimensions, intercepts the embedded example
document, and measures the native reader's iframe bounds and internal viewport.
It makes no ArcGIS item writes and does not open the USA map. The existing
`tests/native-browser.mjs` helper launches a separate temporary Chrome profile.
It requires network access, installed project dependencies, and Google Chrome
(or `CHROME_PATH`).

All 24 geometry cases completed with positive, stable bounds. The JSON report
records source URL, build ID, timestamp, host/document dimensions, fractional
outer bounds, ratios, and integer iframe viewports in the printed temporary
artifact directory. `narrativeWidth` measures the outer narrative container;
for floating/slideshow it is not the visible overlaid text box width.

This is a reproducible sizing experiment, not a passing map-fit regression suite
or an assertion that every StoryMaps theme/version has identical sizes. The
synthetic block configuration is checked against the shipped embed schema;
numeric behavior is cross-checked against shipped ratio and height-cap rules.
The first integrated-browser interception stalled and was discarded; the native
Chrome run is the accepted evidence. A cross-origin viewport read was corrected
to use Playwright's frame context before the successful run.

## Sources

- [Official embed documentation](https://doc.esri.com/en/arcgis-storymaps/latest/author-and-share/add-embeds.html): three inline size controls and small-screen display choices.
- [Official Sidecar documentation](https://doc.esri.com/en/arcgis-storymaps/latest/author-and-share/add-sidecars.html): layouts, panel sizing, and responsive behavior.
- [Esri embed guidance](https://www.esri.com/arcgis-blog/products/arcgis-storymaps/constituent-engagement/enrich-your-story-maps-with-embedded-web-content): iframe dimensions can customize sizing. Its older mobile restrictions are superseded by the current documentation.
- [Esri Sidecar layout guidance](https://www.esri.com/arcgis-blog/products/arcgis-storymaps/constituent-engagement/employing-and-enjoying-sidecars-docked-and-floating-panel-layouts): docked versus overlaid media, including a 50% narrative example.
- [Public reference story](https://storymaps.arcgis.com/stories/73a4b40120b44a3fb9d6935d53d49330): native reader and theme used in the isolated fixture.
- [Reader ratio constants](https://storymaps.arcgis.com/_next/static/chunks/68236-30ebf6ec7735b58e.js): module 247464, default ratio rounded from 16/9 to four decimals.
- [Reader media wrapper](https://storymaps.arcgis.com/_next/static/chunks/88699.c48d05238a34e03a.js): module 441660, width-derived height and 0.91 height cap, bypassed for fill-parent media.
- [Reader embed component](https://storymaps.arcgis.com/_next/static/chunks/64138.1c17e19d854d38fa.js): fallback ratio and wrapper options.
- [Reader embed schema](https://storymaps.arcgis.com/_next/static/chunks/74256.960da767840c522e.js): `standard`, `wide`, `full`, `float` block sizes.

The hashed asset links identify the observed build, not stable public APIs.
`AGENTS.md` and `.github/copilot-instructions.md` were unavailable in this repo;
the existing STATUS and responsive-framing ADR guided the handoff scope.
