import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
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

export async function connectFramingPreview(mainView) {
  const frame = document.getElementById("drawer-iframe");
  const drawer = document.getElementById("drawer-container");
  const albers = new URLSearchParams(window.location.search).get("projection") === "albers";
  const bounds = albers ? albersBounds : lambertBounds;
  let alaskaView;
  let sizeHandle;
  const update = () => {
    if (![mainView, alaskaView].every(view => view?.ready && view.width > padding * 2
        && view.height > padding * 2 && view.resolution > 0)) return;
    const mainFit = fit(bounds.conus, mainView);
    const placement = fitPlacement({
      width: mainView.width,
      height: mainView.height,
      drawerWidth: drawer.getBoundingClientRect().width,
      alaskaWidth: alaskaView.width,
      alaskaHeight: alaskaView.height,
    }, bounds);
    const sharedScale = placement.resolution * alaskaView.scale / alaskaView.resolution;
    const isOpen = drawer.classList.contains("drawer-open");
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
      setCenter(overview, overviewFit);
    }
  };
  const initializeDrawer = async () => {
    while (frame.contentDocument?.readyState !== "complete"
        || new URL(frame.contentWindow.location.href).searchParams.get("framing") !== "preview") {
      await new Promise(resolve => frame.addEventListener("load", resolve, { once: true }));
    }
    await frame.contentWindow.mainViewReady;
    alaskaView = frame.contentWindow.akView;
    if (!alaskaView) throw new Error("Framing preview requires the Alaska view");
    await reactiveUtils.whenOnce(() => mainView.ready && mainView.resolution > 0);
    await alaskaView.when();
    sizeHandle?.remove();
    sizeHandle = reactiveUtils.watch(
      () => [mainView.width, mainView.height],
      update
    );
    update();
  };
  await initializeDrawer();
  const onLoad = () => initializeDrawer().catch(error => console.error("Could not reset framing preview", error));
  frame.addEventListener("load", onLoad);
  frame.addEventListener("framing-preview-resize", update);
  mainView.addHandles({ remove() {
    sizeHandle?.remove();
    frame.removeEventListener("load", onLoad);
    frame.removeEventListener("framing-preview-resize", update);
  } });
  return { update };
}
