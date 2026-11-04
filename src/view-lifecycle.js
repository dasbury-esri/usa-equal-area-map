import MapView from "@arcgis/core/views/MapView.js";
import Point from "@arcgis/core/geometry/Point.js";
import { releaseAfterDestroy } from "./webgl-contexts.js";

export function createViewGroup(factory, onDestroy = () => {}) {
  const saved = new Map();
  let active;
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
          const view = new MapView({ ...options, ...(snapshot ? {
            center: new Point(snapshot.center), scale: snapshot.scale, rotation: snapshot.rotation,
          } : {}) });
          run.views.push(view);
          if (snapshot?.home) window.framingPreviewCenters.set(view, new Point(snapshot.home));
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
      for (const view of run.views.toReversed()) {
        if (view.ready && view.center) saved.set(view.container.id, {
          center: view.center.toJSON(), scale: view.scale, rotation: view.rotation,
          home: window.framingPreviewCenters.get(view)?.toJSON(),
        });
        const releaseContexts = releaseAfterDestroy(view.container);
        view.map = null;
        view.destroy();
        releaseContexts();
      }
      onDestroy();
    },
  };
  return group;
}

export function connectViewLifecycle({ createMain, createPr, createDrawer }) {
  if (!document.getElementById("mainViewDiv")) {
    const drawer = createViewGroup(createDrawer, () => { window.akView = null; });
    window.drawerLifecycle = drawer;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) drawer.stop();
      else if (window.parent === window) drawer.start().catch(console.error);
    });
    if (window.parent === window && !document.hidden) return drawer.start();
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
  const stopUnused = () => {
    if (document.hidden || !prOpen()) pr.stop();
    if (document.hidden || !leftOpen()) drawer()?.stop();
    if (document.hidden) main.stop();
  };
  window.viewLifecycle = { main, pr, get drawer() { return drawer(); } };
  window.updateMapViews = ({ reframe = false } = {}) => {
    needsFraming ||= reframe;
    const current = ++revision;
    stopUnused();
    const wanted = () => current === revision && !document.hidden;
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
      stopUnused();
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
  document.addEventListener("visibilitychange", () => {
    window.updateMapViews().catch(error => console.error("Could not restore map views", error));
  });
  return window.updateMapViews();
}