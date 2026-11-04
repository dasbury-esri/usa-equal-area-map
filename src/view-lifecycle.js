import MapView from "@arcgis/core/views/MapView.js";
import Point from "@arcgis/core/geometry/Point.js";
import { hasLostWebGLContext, releaseAfterDestroy } from "./webgl-contexts.js";

export function createViewGroup(factory, onDestroy = () => {}) {
  const saved = new Map();
  let active;
  const saveNavigation = views => {
    for (const view of views) {
      const anchor = window.zoomAnchorStates?.get(view);
      if (view.center && !view.destroyed) saved.set(view.container.id, {
        center: view.center.toJSON(), scale: view.scale, rotation: view.rotation,
        home: window.framingPreviewCenters.get(view)?.toJSON(),
        zoomAnchor: anchor ? { homeCenter: anchor.homeCenter.toJSON(), homeScale: anchor.homeScale,
          manualCenter: anchor.manualCenter?.toJSON() ?? null } : null,
      });
    }
  };
  const group = {
    get views() { return active?.views ?? []; },
    start() {
      if (active) return active.ready;
      const run = { controller: new AbortController(), views: [] };
      active = run;
      const signal = run.controller.signal;
      const scope = {
        restored: id => saved.has(id),
        create(options) {
          signal.throwIfAborted();
          const snapshot = saved.get(options.container);
          const view = new MapView({ ...options, constraints: { snapToZoom: false, ...options.constraints }, ...(snapshot ? {
            center: new Point(snapshot.center), scale: snapshot.scale, rotation: snapshot.rotation,
          } : {}) });
          run.views.push(view);
          view.container.addEventListener("webglcontextlost", event => {
            if (!event.isTrusted || !hasLostWebGLContext(event.target) || run.contextLost) return;
            run.contextLost = true;
            saveNavigation(run.views);
            run.controller.abort();
          }, { capture: true, signal });
          if (snapshot?.home) window.framingPreviewCenters.set(view, new Point(snapshot.home));
          if (snapshot?.zoomAnchor) window.zoomAnchorStates.set(view, {
            homeCenter: new Point(snapshot.zoomAnchor.homeCenter), homeScale: snapshot.zoomAnchor.homeScale,
            manualCenter: snapshot.zoomAnchor.manualCenter ? new Point(snapshot.zoomAnchor.manualCenter) : null,
            panning: false,
          });
          return view;
        },
        wait(task) {
          return new Promise((resolve, reject) => {
            const abort = () => reject(signal.reason);
            signal.addEventListener("abort", abort, { once: true });
            Promise.resolve(task).then(value => {
              if (signal.aborted) reject(signal.reason);
              else resolve(value);
            }, reject).finally(() => signal.removeEventListener("abort", abort));
            if (signal.aborted) abort();
          });
        },
      };
      run.ready = Promise.resolve().then(() => factory(scope)).catch(error => {
        if (run.contextLost) return null;
        if (active === run) group.stop();
        if (error.name !== "AbortError") throw error;
        return null;
      });
      return run.ready;
    },
    stop() {
      const run = active;
      if (!run) return;
      active = null;
      run.controller.abort();
      if (!run.contextLost) saveNavigation(run.views);
      for (const view of run.views.toReversed()) {
        const releaseContexts = releaseAfterDestroy(view.container);
        view.map = null;
        view.destroy();
        releaseContexts();
      }
      onDestroy();
    },
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !active?.contextLost) return;
    group.stop();
    group.start().then(() => {
      for (const view of group.views) {
        const snapshot = saved.get(view.container.id);
        if (snapshot) view.set({
          center: new Point(snapshot.center), scale: snapshot.scale, rotation: snapshot.rotation,
        });
      }
      window.dispatchEvent(new Event("map-views-ready"));
    }).catch(error => console.error("Could not recover lost map contexts", error));
  });
  return group;
}

export function connectViewLifecycle({ createMain, createPr, createDrawer }) {
  if (!document.getElementById("mainViewDiv")) {
    const drawer = createViewGroup(createDrawer, () => { window.akView = null; });
    window.drawerLifecycle = drawer;
    if (window.parent === window) return drawer.start();
    return drawer;
  }
  const main = createViewGroup(createMain, () => { window.mainView = null; });
  const pr = createViewGroup(createPr, () => { window.prView = null; });
  const frame = document.getElementById("drawer-iframe");
  let drawerReady;
  let revision = 0;
  let needsFraming = false;
  const leftOpen = () => document.getElementById("drawer-container").classList.contains("drawer-open");
  const prOpen = () => document.getElementById("pr-drawer").classList.contains("drawer-open");
  const drawer = () => frame.contentWindow?.drawerLifecycle;
  const loadDrawer = () => drawerReady ??= new Promise((resolve, reject) => {
    frame.addEventListener("load", () => {
      Promise.resolve(frame.contentWindow.mainViewReady).then(resolve, reject);
    }, { once: true });
    frame.src = frame.dataset.src;
  });
  window.viewLifecycle = { main, pr, get drawer() { return drawer(); } };
  window.updateMapViews = ({ reframe = false } = {}) => {
    needsFraming ||= reframe;
    const current = ++revision;
    const wanted = () => current === revision;
    window.viewsReady = (async () => {
      if (!wanted()) return null;
      await main.start();
      if (!wanted()) return null;
      if (prOpen()) await pr.start();
      if (!wanted()) return null;
      if (leftOpen()) {
        await loadDrawer();
        if (!wanted()) return null;
        await drawer().start();
      }
      if (!wanted()) return null;
      if (needsFraming) {
        const framing = await window.framingPreviewReady;
        if (!wanted()) return null;
        framing.update();
        needsFraming = false;
      }
      window.dispatchEvent(new Event("map-views-ready"));
      return window.mainView;
    })();
    return window.viewsReady;
  };
  return window.updateMapViews();
}