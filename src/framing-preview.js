import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import Point from "@arcgis/core/geometry/Point.js";
import * as projectOperator from "@arcgis/core/geometry/operators/projectOperator.js";
import { projections } from "./projections.js";
import { albersBounds, lambertBounds, fitPlacement, fitOverview } from "../experiments/framing-placement.js";

const padding = 16;

function fit(bounds, view) {
  const resolution = Math.max(
    (bounds.xmax - bounds.xmin) / (view.width - padding * 2),
    (bounds.ymax - bounds.ymin) / (view.height - padding * 2)
  );
  return {
    x: (bounds.xmin + bounds.xmax) / 2,
    y: (bounds.ymin + bounds.ymax) / 2,
    resolution,
    scale: resolution * view.scale / view.resolution,
  };
}

function setCenter(view, center) {
  view.center = new view.center.constructor({
    x: center.x, y: center.y, spatialReference: view.spatialReference,
  });
  view.container.ownerDocument.defaultView.framingPreviewCenters?.set(view, view.center.clone());
}

export async function connectFramingPreview(mainView, restored = false) {
  const frame = document.getElementById("drawer-iframe");
  const drawer = document.getElementById("drawer-container");
  const albers = new URLSearchParams(window.location.search).get("projection") === "albers";
  const bounds = albers ? albersBounds : lambertBounds;
  const update = () => {
    if (!mainView.ready || mainView.destroyed || mainView.width <= padding * 2
        || mainView.height <= padding * 2 || mainView.resolution <= 0) return;
    const mainFit = fit(bounds.conus, mainView);
    const isOpen = drawer.classList.contains("drawer-open");
    if (!isOpen) {
      mainView.scale = mainFit.scale;
      setCenter(mainView, mainFit);
      return;
    }
    const alaskaView = frame.contentWindow?.akView;
    if (!alaskaView?.ready || alaskaView.destroyed || !alaskaView.resolution) return;
    const placement = fitPlacement({
      width: mainView.width,
      height: mainView.height,
      drawerWidth: drawer.getBoundingClientRect().width,
      alaskaWidth: alaskaView.width,
      alaskaHeight: alaskaView.height,
    }, bounds);
    const sharedScale = placement.resolution * alaskaView.scale / alaskaView.resolution;
    alaskaView.scale = sharedScale;
    mainView.scale = isOpen ? sharedScale : mainFit.scale;
    setCenter(alaskaView, placement.alaska);
    setCenter(mainView, isOpen ? placement.main : mainFit);
    const overview = Array.from(alaskaView.constructor.views)
      .find(view => view.container.id === "overViewDiv");
    if (overview?.ready && overview.width > 0 && overview.height > 0 && overview.resolution > 0) {
      const overviewFit = fitOverview(overview, albers);
      overview.scale = overviewFit.resolution * overview.scale / overview.resolution;
      overview.rotation = overviewFit.rotation;
      const center = frame.contentWindow.mapSourceDiagnostics?.options.overview
        ? projectOperator.execute(new Point({ x: overviewFit.x, y: overviewFit.y,
          spatialReference: { wkt: projections.albers.overview.wkt } }), overview.spatialReference)
        : overviewFit;
      setCenter(overview, center);
    }
  };
  mainView.addHandles(reactiveUtils.watch(() => [mainView.width, mainView.height], update));
  if (!restored) update();
  return { update };
}
