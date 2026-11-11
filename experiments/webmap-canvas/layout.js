import { createElement, ChevronLeft, ChevronRight } from "lucide";
import { albersBounds, lambertBounds, fitPlacement, fitOverview } from "../framing-placement.js";
import defaults from "../../src/view-defaults.js";
import { projections } from "../../src/projections.js";
import { projectionParameters } from "./projection.js";
import { metersPerPixel, paneBounds } from "./coverage.js";

const defaultKeys = { ak: "alaska", hi: "hawaii", pr: "puertoRico", gu: "guam", as: "americanSamoa" };

export function mainFraming(width, height, drawerWidth, alaskaWidth, alaskaHeight, open, albers) {
  const bounds = albers ? albersBounds : lambertBounds;
  if (open) return fitPlacement({ width, height, drawerWidth, alaskaWidth, alaskaHeight }, bounds);
  return {
    resolution: Math.max((bounds.conus.xmax - bounds.conus.xmin) / Math.max(1, width - 32),
      (bounds.conus.ymax - bounds.conus.ymin) / Math.max(1, height - 32)),
    main: { x: (bounds.conus.xmin + bounds.conus.xmax) / 2, y: (bounds.conus.ymin + bounds.conus.ymax) / 2 },
  };
}

export function createMainLayout() {
  document.body.classList.add("main-layout");
  const host = document.querySelector("#panes");
  const pane = id => host.querySelector(`[data-pane="${id}"]`);
  const makeDrawer = (id, label, children) => {
    const drawer = document.createElement("aside");
    drawer.id = id;
    drawer.className = "map-drawer";
    const content = document.createElement("div");
    content.id = `${id}-content`;
    content.className = "drawer-content";
    content.inert = true;
    content.append(...children);
    const toggle = document.createElement("button");
    toggle.id = `${id}-toggle`;
    toggle.className = "drawer-toggle";
    toggle.setAttribute("aria-controls", content.id);
    const setOpen = open => {
      if (open && innerWidth < 700) {
        for (const other of host.querySelectorAll(".map-drawer.drawer-open")) {
          if (other !== drawer) other.querySelector(".drawer-toggle").click();
        }
      }
      if (!open && content.contains(document.activeElement)) toggle.focus();
      drawer.classList.toggle("drawer-open", open);
      content.inert = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", `${open ? "Hide" : "Show"} ${label}`);
      toggle.title = toggle.getAttribute("aria-label");
      toggle.replaceChildren(createElement((id === "regional-drawer") === open ? ChevronLeft : ChevronRight, { width: 20, height: 20 }));
      drawer.dispatchEvent(new CustomEvent("drawerchange", { bubbles: true }));
    };
    toggle.addEventListener("click", () => setOpen(!drawer.classList.contains("drawer-open")));
    drawer.addEventListener("keydown", event => {
      if (event.key === "Escape") { setOpen(false); toggle.focus(); }
    });
    drawer.append(content, toggle);
    host.append(drawer);
    setOpen(false);
  };
  const insets = document.createElement("div");
  insets.id = "regional-insets";
  insets.append(pane("gu"), pane("as"), pane("hi"));
  makeDrawer("regional-drawer", "inset maps", [pane("ak"), pane("overview"), insets]);
  makeDrawer("pr-drawer", "Puerto Rico and US Virgin Islands", [pane("pr")]);
  pane("overview").querySelector(".recenter").hidden = true;
  pane("overview").tabIndex = -1;
}

export function connectMainLayout(renderer) {
  const main = renderer.panes.find(pane => pane.id === "conus");
  const alaska = renderer.panes.find(pane => pane.id === "ak");
  const overview = renderer.panes.find(pane => pane.id === "overview");
  const drawer = document.querySelector("#regional-drawer");
  for (const pane of renderer.panes) {
    pane.inchesPerMeter = 39.37;
    const settings = defaults[defaultKeys[pane.id]];
    if (!settings) continue;
    const center = settings.center;
    const geographic = center.spatialReference?.wkid === 4326 ? [center.x, center.y]
      : projectionParameters(projections.lambert[pane.id]).converter.inverse([center.x, center.y]);
    pane.center = pane.parameters.converter.forward(geographic);
    pane.home = [...pane.center];
    pane.airport = pane.parameters.converter.forward([settings.zoomAnchor.x, settings.zoomAnchor.y]);
  }
  const centerAtScale = pane => {
    if (!pane.airport) return [...pane.home];
    const progress = Math.max(0, Math.min(1, (renderer.homeScale - renderer.scale) / Math.max(1, renderer.homeScale - defaults.zoomAnchorScale)));
    return pane.home.map((value, index) => value + (pane.airport[index] - value) * progress);
  };
  const fit = () => {
    if (innerWidth < 700 && drawer.classList.contains("drawer-open")
        && document.querySelector("#pr-drawer").classList.contains("drawer-open")) {
      document.querySelector("#pr-drawer-toggle").click();
    }
    const bounds = paneBounds(main);
    const alaskaBounds = paneBounds(alaska);
    const placement = mainFraming(bounds.width, bounds.height, drawer.getBoundingClientRect().width,
      alaskaBounds.width, alaskaBounds.height, drawer.classList.contains("drawer-open"), renderer.options.projection === "albers");
    renderer.scale = renderer.homeScale = placement.resolution / metersPerPixel(1, 39.37);
    main.center = main.home = [placement.main.x, placement.main.y];
    if (placement.alaska) alaska.home = [placement.alaska.x, placement.alaska.y];
    for (const pane of renderer.panes) {
      pane.manualCenter = null;
      if (pane.airport) pane.center = [...pane.home];
    }
    const overviewFit = fitOverview(paneBounds(overview), renderer.options.projection === "albers");
    overview.center = overview.home = [overviewFit.x, overviewFit.y];
    overview.scale = overviewFit.resolution / metersPerPixel(1, 39.37);
    overview.rotation = overviewFit.rotation;
    renderer.requestDraw();
  };
  document.querySelector("#panes").addEventListener("drawerchange", event => {
    if (event.target === drawer) fit();
    renderer.requestDraw();
    renderer.onNavigate?.();
  });
  renderer.onResize = fit;
  fit();
  return { centerAtScale, fit };
}
