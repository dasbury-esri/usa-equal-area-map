# Plan: Staged Dependency Modernization

## Goal and Decisions

Upgrade usa-equal-area-map to current stable dependencies in independently validated stages, without changing map behavior. David selected current stable major versions and removal of verified-unused React scaffolding/direct fetch-blob. Planning only: no files, packages, browsers, or deployment were changed in this turn.

Wait for the other agent's overlapping work to settle. Complete and accept the separately planned Scale Bar component migration on the existing SDK before changing SDK dependencies. No broad conversion of MapView to arcgis-map. No prototype-repo changes. No commit, push, publication, workflow dispatch, or branch creation without explicit authorization. Main-branch pushes currently trigger Pages deployment.

## Verified Baseline

- Root: /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map
- Current package/lock resolutions include @arcgis/core 4.32.10, @arcgis/map-components 4.32.14, Vite 6.3.3, ESLint/@eslint/js 9.25.1, Playwright 1.64.1, React/ReactDOM 19.1.0, React Query 5.74.4, fetch-blob 4.0.0, prettier 3.5.3.
- map-components 4.32.14 peers on core ~4.32.0 and Calcite ^3.0.3. The current CSS separately imports the 4.32 CDN stylesheet.
- Vite config enables React plugin 4.4.1 (peers through Vite 6), preserves base /usa-equal-area-map/, and has index.html and drawer.html build inputs. Current server has strictPort: true, port 5173.
- App imports show no React, ReactDOM, React Query, or direct fetch-blob usage; verify again at handoff. React tooling remains in Vite/ESLint configuration. map-components is reserved for Scale Bar, not a removal candidate. Current package.json no longer declares Three.js; globes use D3 and canvas. Do not reintroduce obsolete dependencies from prior logs.
- Existing tests/browser-smoke.mjs uses Playwright Chrome, TEST_URL, four projection/layout variants, and 1920x1080 plus 2560x1600. It covers framing, layers, linked zoom, drawer behavior, and 2D globe pixels. It is not complete Scale Bar or full landscape-matrix coverage. npm test remains a placeholder; npm run test:browser is real.
- Pages workflow uses Node 22, npm ci, npm run build, and automatically deploys pushes to main. No browser gate currently in that workflow.
- No AGENTS.md or .github/copilot-instructions.md exists in this repo. STATUS and ADR govern landscape acceptance and explicit publication approval.

## Verified Target Direction

Primary npm registry and official release/migration docs agree on the following candidates at research time:
- @arcgis/core 5.1.27 and @arcgis/map-components 5.1.27 together. map-components peers on core ^5.1.0 and Calcite ^5.1.1; resolve a compatible Calcite 5.x instead of independently selecting an incompatible latest major.
- Vite 8.3.5, Node requirement ^20.19.0 || >=22.12.0.
- ESLint 10.14.0, Node requirement ^20.19.0 || ^22.13.0 || >=24; choose compatible @eslint/js and @eslint/css releases.
- Retain the Node 22 LTS line initially, with an explicit minimum of 22.13.0 for these candidates and use its latest supported patch. Recheck every retained package's engine constraints; any higher requirement is an explicit runtime decision, not an ignored engine warning. Record the npm version used locally and in CI.
- For globals, prettier, playwright, d3-geo, topojson-client, and world-atlas, resolve current stable non-prerelease versions at implementation preflight, retaining unchanged versions if already current. Record exact package versions, peers, engines, advisories, and release-note URLs in a target table before installation. No exact versions for these secondary targets were verified in this planning turn.
- Revalidate latest tags before implementation; do not silently cross an additional major beyond these reviewed target lines without revising the plan. Use exact direct versions for this migration and a committed reviewed lockfile to keep checkpoints reproducible.

## Steps and Dependencies

### Phase 0: Ownership, Baseline, and Inventory

1. Wait for overlapping work and the separately accepted Scale Bar migration; reread current source, status, ADR, tests, and diff. Freeze the accepted baseline without reverting another agent's edits. Use an isolated candidate directory with its own node_modules and free explicit ports rather than installing into the live working tree.
2. Record Node/npm, package and lock versions, npm ls --all, npm outdated --json, npm audit --json, and npm audit --omit=dev --json. Audit may send package metadata to the configured registry: use the approved registry only. Distinguish tool failure from a clean audit and report dependency paths/reachability, not only severity counts. No audit results are claimed yet; do not run npm audit fix --force.
3. Run baseline clean installation, lint without autofix, build, and test:browser; capture existing lint/config failures separately. Record bundle output and browser-loaded asset sizes, not just static entry size, plus console/network failures and representative screenshots. Preserve exact baseline manifest/lock/config/source artifacts for rollback. Steps 2 and target release-note research may run in parallel; baseline runs depend on the frozen candidate.

### Phase 1: Dependency Removal

4. Depends on baseline. Recheck static/dynamic imports, config, tests, both HTML entries, and any intended React work with the settled tree. Remove react, react-dom, @tanstack/react-query, fetch-blob, @vitejs/plugin-react, eslint-plugin-react, and eslint-plugin-react-hooks only when still unused. Remove their config imports/plugins at the same time. Keep transitive packages required by retained dependencies; do not force-remove them.
5. Keep vanilla ESM Vite setup and simplify ESLint to JavaScript/CSS, browser globals for app source, Node globals for tests/config, and generated/vendor exclusions. First use existing tooling versions to isolate cleanup from upgrades. Correct config defects only as needed; do not mass-format or fix unrelated historical lint findings. Run build, lint comparison, and browser smoke before proceeding.

### Phase 2: Build and Developer Tooling

6. Depends on Phase 1. Upgrade Vite to the verified stable 8.x target independently of ArcGIS. Review both 6-to-7 and 7-to-8 guides. Move build.rollupOptions to build.rolldownOptions as appropriate; retain both HTML inputs, base URL, ESM paths, and no React plugin. Test Rolldown/Oxc minification, dependency optimization, workers/WASM, dynamic imports, and data JSON imports with the existing SDK. Do not add blanket compatibility overrides to suppress genuine failures.
7. Upgrade ESLint/@eslint/js/@eslint/css/globals as a compatible group. Upgrade Prettier and Playwright in separate small checkpoints; don't downgrade already-current packages. Keep Chrome availability explicit for channel:chrome and record browser version. Add clear lint/check scripts as needed; do not replace the placeholder npm test with a browser command that silently assumes a running server. No repo-wide formatting churn.
8. Gate each checkpoint on appropriate focused checks, followed by build/browser smoke when runtime packaging can change. Independent release-note research is parallelizable, but manifest/lock edits and candidate tests are serialized. Record explicit Node minimum compatible with all selected packages; retain CI Node 22 unless new evidence requires an approved change.

### Phase 3: ArcGIS Runtime

9. Depends on accepted Scale Bar work and tooling gate. Upgrade core and map-components together to 5.1.27 (or reviewed newer stable patch on 5.1); satisfy Calcite peer requirements. Review 4.33, 4.34, 5.0, and 5.1 breaking changes against used APIs before installation. Upgrade directly to the target; intermediate versions are diagnostic steps only if a regression needs localization.
10. Replace the stale 4.32 CDN CSS import with CSS imported from the installed SDK where supported, keeping JS and styles aligned. Validate fonts, icons, workers, WASM and locale assets under the Pages base in parent and iframe. Do not broadly self-host all SDK assets unless required by a concrete deployment failure.
11. Recheck Scale Bar view binding, current component DOM/CSS and lifecycle. Do not assume 4.32 light-DOM styling remains unchanged at 5.1. The component position property was removed in favor of slots for component layouts; existing MapView.ui.add(element, position) is a separate API and must be tested, not mechanically replaced by slots. Retain dual units and truthful rendered lengths.
12. Handle demonstrated SDK compatibility issues only: removed APIs, popup behavior, geographic projection/SR serialization, and extent watchers. Attribution is no longer governed by ui.components in SDK 5; verify required attribution and its space in small panes rather than hiding it indiscriminately to imitate the old empty UI. Escalate layout/legal-content conflicts. Do not change projection parameters, centers, framing policies, layer IDs/filters/renderers, or the repaired services just to pass tests. No MapView-wide component conversion or beta popup migration.

### Phase 4: Globe Dependencies and Consolidation

13. Depends on runtime acceptance. Update d3-geo/topojson-client/world-atlas only where newer stable releases exist and are compatible, with a separate checkpoint. Review data/license changes if world-atlas changes. Test native 2D canvas pixels, extent outlines, movement, and recenter behavior, including the Aleutian/antimeridian cases; do not add Three.js.
14. Fresh npm ci from final manifest/lock in isolation, dependency-tree/peer validation, audit comparison, full build and acceptance suite. Block new regressions and unmitigated exploitable high/critical advisories; document existing/unfixable findings and obtain explicit acceptance rather than claiming zero risk. Recheck runtime and dependency licensing notices where changed.
15. Update STATUS and the established session log with exact versions, audited findings, baseline/candidate results, known residuals, and deployment instructions. Review only intended changes and leave production untouched. Roll back a failed candidate to its last accepted isolated checkpoint, never by resetting the user's working tree. Commit/push/deploy remain separate explicit approvals.

## Critical Files

- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/package.json: removals, versions, engines, check scripts.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/package-lock.json: deterministic reviewed dependency resolution, no manual edits.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/vite.config.js: React removal, two HTML input entries, base, Rolldown options.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/eslint.config.js: remove React configurations, JS/CSS compatibility, environment scopes.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/src/style.css: SDK CSS import and only necessary migrated component styling.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/src/main.js: existing MapViews, connectScaleViews, popup handling, projectOperator and Scale Bar association; compatibility-only changes.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/src/locator-globe.js: reference D3/topojson/canvas behavior; change only for dependency compatibility.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/tests/browser-smoke.mjs: reuse settled(), TEST_URL, projection/layout loops, canvas assertions; add missing upgrade gates here rather than inventing another harness.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/.github/workflows/deploy-pages.yml: runtime alignment only if needed; preserve deployment permissions/triggers and no dispatch during testing. GitHub Action major upgrades are outside this npm scope unless required for the selected runtime.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/STATUS.md and /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/session-logs/2026-11-03-layer-repair-scale-bar-plan.md: update final verified state after ownership coordination.
- /Users/davi6569/srv/Github-dasbury-esri/usa-equal-area-map/docs/adr/ADR-0001-responsive-landscape-map-framing.md: reference acceptance, not a redesign target.

## Verification Commands and Acceptance

- In isolated candidate: npm ci; npm ls --all; npm audit --json and --omit=dev --json; ./node_modules/.bin/eslint src tests vite.config.js eslint.config.js (compare baseline failures; no autofix); npm run build.
- Launch candidate via npm run dev -- --port <free-port>; set TEST_URL=http://127.0.0.1:<port>/usa-equal-area-map/ for npm run test:browser. Never reuse another agent's port or terminate its server.
- Serve built output via the installed Vite preview on another free port, same base, and rerun browser checks. Both index and drawer entries, assets, fonts/icons, dynamic SDK chunks and globe data must load without failures.
- Reuse the current eight smoke cases, extending the existing harness to cover all expected layers in parent and iframe and all active views: seven in standard layout, six in globe mode. Add console errors/layerview-create-error and failed asset checks, distinguish live-service outages from application regressions.
- Preserve repaired background/admin portal items and COUNTRYAFF filter; verify actual native rendering and queries, not just ready or loadStatus.
- Scale Bar metric/imperial labels and actual lengths across zooms, correct view assignment, compact hiding, drawer reopen, overview independent scale; no accidental width compression.
- Lambert/Albers x standard/globes x four drawer states; manual pan then linked zoom, current-scale recenter, resize and iframe reload handshake; popup interaction and attribution/controls non-overlap.
- ADR landscape matrix: 1280x720, 1920x1080, 2560x1440; 1280x800, 1920x1200, 2560x1600; 2520x1080, 3360x1440; 2560x1080, 3440x1440. Record CSS-pixel sizes. Portrait remains excluded. Do not silently relax geographic assertions to accommodate upgrade drift.
- Native Chrome automated checks; representative native Safari/macOS and Firefox desktop smoke for SDK/CSS/bundler changes. Explicitly report any unavailable browser check, never count it as passed.
- Capture baseline/candidate output size and network-loaded JS totals; investigate regressions rather than invent an arbitrary budget. No new unexplained browser errors or asset 404s; no WebGL context exhaustion.

## Sources and Limits

- https://registry.npmjs.org/@arcgis/core/latest
- https://registry.npmjs.org/@arcgis/map-components/latest
- https://registry.npmjs.org/vite/latest
- https://registry.npmjs.org/eslint/latest
- https://developers.arcgis.com/javascript/latest/release-notes/
- https://developers.arcgis.com/javascript/latest/v5-0/
- https://vite.dev/guide/migration
- https://nodejs.org/en/about/previous-releases

No audit, package install, build, or browser acceptance was run in this planning turn. Versions are verified candidates, not proven-compatible results. Transitive engine/peer resolution, exact secondary package targets, historical lint baseline, and 4.33/4.34 API review are explicit pre-install checks, not claims of completed validation.
