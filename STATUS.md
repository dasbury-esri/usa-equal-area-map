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

The drawer script still waits for `window.mainViewReady`, but the map module
no longer defines that promise. Drawer repair and dependency review remain
pending. The owner selected the tracking state and health above; they do not
represent runtime acceptance. Neither application was run during onboarding.

## Done

- [x] Compared the successor and predecessor source and Git history.
- [x] Established the owner-requested tracking fields.

## Next

Follow the authoritative `next_action` above. Preserve the predecessor as a
reference while verifying the repaired application.
