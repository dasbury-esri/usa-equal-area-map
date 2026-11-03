import { geoOrthographic, geoPath } from "d3-geo";
import land from "world-atlas/land-110m.json";
import { feature } from "topojson-client";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import * as projectOperator from "@arcgis/core/geometry/operators/projectOperator.js";
import SpatialReference from "@arcgis/core/geometry/SpatialReference.js";

const geographic = new SpatialReference({ wkid: 4326 });
const landGeometry = feature(land, land.objects.land);

export function addLocatorGlobe(view, label, homeCenter) {
  const host = document.createElement("div");
  host.className = "locator-globe";
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", `${label} location on the globe`);
  host.title = `${label} location`;
  view.container.append(host);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  const projection = geoOrthographic().clipAngle(90);
  const path = geoPath(projection, context);
  host.append(canvas);
  const render = () => {
    if (!view.center || view.destroyed) return;
    const center = projectOperator.execute(view.center, geographic);
    if (!center) return;
    const size = canvas.width / pixelRatio;
    context.clearRect(0, 0, size, size);
    projection.rotate([-center.x, -center.y]).translate([size / 2, size / 2]).scale(size / 2.2);
    context.beginPath();
    path({ type: "Sphere" });
    context.fillStyle = "#e3eef0";
    context.fill();
    context.beginPath();
    path(landGeometry);
    context.fillStyle = "#81968b";
    context.fill();
    const visibleArea = view.visibleArea && projectOperator.execute(view.visibleArea, geographic);
    context.beginPath();
    path({ type: "MultiLineString", coordinates: visibleArea?.rings ?? [] });
    context.strokeStyle = "#b53739";
    context.lineWidth = 1;
    context.stroke();
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2.2 * 0.035, 0, 2 * Math.PI);
    context.fillStyle = "#b53739";
    context.fill();
  };
  const resize = () => {
    const size = view.width < 180 ? 44 : 68;
    view.container.classList.toggle("compact-inset", Boolean(homeCenter) && view.width < 180);
    host.style.width = `${size}px`;
    host.style.height = `${size}px`;
    canvas.width = Math.round(size * pixelRatio);
    canvas.height = Math.round(size * pixelRatio);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(view.container);
  const handle = reactiveUtils.watch(() => [view.center, view.scale, view.rotation], render);
  let button;
  if (homeCenter) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "inset-recenter";
    button.title = `Recenter ${label} at the current scale`;
    button.setAttribute("aria-label", button.title);
    const icon = document.createElement("span");
    icon.className = "esri-icon-locate";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "inset-recenter-text";
    const name = document.createElement("span");
    name.textContent = label;
    const scaleReadout = document.createElement("span");
    scaleReadout.className = "inset-scale-readout";
    scaleReadout.id = `${view.container.id}-scale`;
    button.setAttribute("aria-describedby", scaleReadout.id);
    text.append(name, scaleReadout);
    view.addHandles(reactiveUtils.watch(() => view.scale, (scale) => {
      scaleReadout.textContent = `1:${Math.round(scale).toLocaleString()}`;
    }, { initial: true }));
    button.append(icon, text);
    button.addEventListener("click", () => {
      const target = typeof homeCenter === "function" ? homeCenter() : homeCenter.clone();
      view.goTo({ center: target, scale: view.scale }, { animate: false }).catch((error) => {
        if (error.name !== "AbortError") console.error("Could not recenter inset", error);
      });
    });
    view.ui.add(button, "top-left");
  }
  view.addHandles({ remove() {
    observer.disconnect();
    handle.remove();
    if (button) view.ui.remove(button);
    host.remove();
    view.container?.classList.remove("compact-inset");
  } });
  resize();
}