# Layer Repair and Scale Bar Migration Plan

Recorded: 2026-11-03 15:33:55-08:00[America/Los_Angeles]

## Completed Layer Repair

- Replaced `backgroundLayer` with public item
  `acc8fccf06d74364bffe6a9bd0dfded7`, World Country Boundary, resolving to
  `WOR_Boundaries_2024/FeatureServer/1`.
- Replaced `usStatesLayer` with public item
  `2816c6a03f0740e9b13d563b93e60b9d`, World First Order Administrative
  Boundaries, resolving to `WOR_Boundaries_2024/FeatureServer/2`.
- The new administrative item has no saved geographic filter. Explicitly
  preserved the old item's `COUNTRYAFF = 'United States'` expression.
  Existing renderers, layer order, popup settings, and other layers are unchanged.
- The old country item returned "Item does not exist or is inaccessible."
  Anonymous access cannot distinguish deletion from restricted access. The old
  states item was public but its 2022 service root and sublayer returned ArcGIS
  error 400, "Invalid URL", inside HTTP-200 responses.
- Verified the new portal metadata and service schemas independently, then
  checked the working-tree app at port 5173: both layers loaded and created
  LayerViews in the parent and drawer maps. Queries returned 651 country
  features and 148 filtered administrative features. Neither map had a layer
  with failed load status. Editor diagnostics reported no errors in main.js.
- Port 5174 did not adopt the source change during the check and was not used
  as acceptance evidence. No manual page reload or navigation was performed.
- This validates loading and queries, not cartographic equivalence or complete
  geographic coverage. No dependency or Scale Bar implementation changed.

## Deferred Scale Bar Plan

Status: Planned only. Start after the other agent's overlapping work settles.

### Scope and Preconditions

1. Coordinate ownership of `src/main.js` and `src/style.css`; reread the current
   diff, status, and framing ADR before editing. Do not revert concurrent work.
2. Record the settled dependency versions and baseline screenshots, bar labels,
   rendered lengths, and positions. The inspected installation has core 4.32.10
   and map-components 4.32.14; no package upgrade is needed for this migration.
3. Keep all seven MapViews, projections, centers, framing, layer definitions,
   scale synchronization, and drawer behavior unchanged. Converting the map
   containers to arcgis-map is outside this task.

### Implementation

1. Import `@arcgis/map-components/components/arcgis-scale-bar` through the shared
   module so it registers in both the parent and drawer documents.
2. First replace only the CONUS widget with an `arcgis-scale-bar` element,
   assign its existing MapView through `view`, retain `unit = 'dual'`, and
   position it with `view.ui.add()`. Verify component readiness, native
   rendering, and updates after zoom before replacing the remaining widgets.
3. Apply the verified pattern to PR/USVI, Alaska, overview, Guam/CNMI,
   American Samoa, and Hawaii. Preserve bottom-left placement except for the
   overview's bottom-right placement. Remove the ScaleBar widget import only
   after every construction site is replaced.
4. Preserve CSS where possible: the installed 4.32 component uses light DOM,
   existing esri-scale-bar classes, and ScaleBarViewModel. Verify rather than
   assume compatibility of label sizing, line borders, compact-pane hiding,
   and clearance above locator globes. Do not constrain bar width independently
   of its calculated distance. If style is configured, use `barStyle`, not the
   HTMLElement `style` property; dual units use the line style.
5. Account for automatic destruction on DOM removal. Ordinary CSS drawer
   hiding should not require disabling cleanup. Test removal/recreation if
   the settled app actually performs it; avoid adding unused lifecycle code.

### Acceptance

- Run JavaScript syntax checks, editor diagnostics, and the production build.
  There is currently no automated test suite behind `npm test`.
- Verify each of the seven bars is associated with its intended view; confirm
  metric/imperial labels and measured pixel lengths across representative zoom
  levels. Compare with the baseline, not just component presence.
- Exercise Lambert and Albers in standard and globe layouts, all drawer
  states, linked zoom, manual navigation, and representative resize transitions.
  Confirm the independently scaled overview stays independent.
- Follow ADR 0001's landscape viewport matrix, including 16:9, 16:10, and
  ultrawide cases. Portrait optimization remains outside acceptance scope.
- Check compact-pane hiding, globe clearance, label overlap, and hidden-drawer
  reopen behavior. Preserve native bar lengths and existing numeric readouts.
- Confirm the ScaleBar widget deprecation warning is gone, no new component
  lifecycle errors appear, and the repaired layers still load in both documents.
- Review the final diff for unrelated edits. Record exact versions, test URLs,
  viewport sizes, evidence, and remaining gaps before calling migration complete.

## Separate Dependency Upgrade Task

Do not combine dependency updates with the Scale Bar migration. After the
component migration is accepted, inventory direct/transitive versions, peer
requirements, security advisories, and official SDK/Vite/React release notes.
Propose a compatible target set and scope before changing package manifests or
the lockfile. Validate that upgrade separately, including component API/CSS
changes, production packaging, projection behavior, and the landscape matrix.
No target version or upgrade acceptance is claimed here.

## References

- [ScaleBar widget deprecation](https://developers.arcgis.com/javascript/latest/references/core/widgets/ScaleBar/)
- [Scale Bar component and gradual MapView association](https://developers.arcgis.com/javascript/latest/references/map-components/components/arcgis-scale-bar/)
- [Landscape framing ADR](../docs/adr/ADR-0001-responsive-landscape-map-framing.md)
- Installed 4.32.14 component implementation and controller were inspected to
  verify light DOM, existing CSS classes, direct view association, and cleanup;
  latest online documentation alone is not a version-specific guarantee.
