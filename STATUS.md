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
updated: 2026-11-02
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
Dependency review is still pending; no dependencies were changed. The owner's
tracking fields and exact next action above are preserved. See
[session 0002](session-logs/2026-11-02-0002-session-log.md) for verification scope.

## Done

- [x] Compared the successor and predecessor source and Git history.
- [x] Established the owner-requested tracking fields.
- [x] Repaired drawer initialization, iframe packaging and scale synchronization.
- [x] Checked the development and production builds in a native browser.

## Next

Follow the authoritative `next_action` above. Preserve the predecessor as a
reference while verifying the repaired application.
