import * as THREE from "three";
import { geoEquirectangular, geoPath } from "d3-geo";
import land from "world-atlas/land-110m.json";
import { feature } from "topojson-client";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import * as projectOperator from "@arcgis/core/geometry/operators/projectOperator.js";
import SpatialReference from "@arcgis/core/geometry/SpatialReference.js";

const geographic = new SpatialReference({ wkid: 4326 });
let globeTexture;

function texture() {
  if (globeTexture) return globeTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  context.fillStyle = "#e3eef0";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const projection = geoEquirectangular().scale(1024 / (2 * Math.PI)).translate([512, 256]);
  context.beginPath();
  geoPath(projection, context)(feature(land, land.objects.land));
  context.fillStyle = "#81968b";
  context.fill();
  globeTexture = new THREE.CanvasTexture(canvas);
  globeTexture.colorSpace = THREE.SRGBColorSpace;
  return globeTexture;
}

function position(longitude, latitude, radius = 1) {
  const longitudeRadians = THREE.MathUtils.degToRad(longitude);
  const latitudeRadians = THREE.MathUtils.degToRad(latitude);
  return new THREE.Vector3(
    Math.cos(latitudeRadians) * Math.cos(longitudeRadians),
    Math.sin(latitudeRadians),
    -Math.cos(latitudeRadians) * Math.sin(longitudeRadians)
  ).multiplyScalar(radius);
}

export function addLocatorGlobe(view, label, homeCenter) {
  const host = document.createElement("div");
  host.className = "locator-globe";
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", `${label} location on the globe`);
  host.title = `${label} location`;
  view.container.append(host);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0.1, 10);
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.MeshBasicMaterial({ map: texture() })
  );
  scene.add(globe);
  const footprint = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: "#b53739" })
  );
  scene.add(footprint);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 8),
    new THREE.MeshBasicMaterial({ color: "#b53739" })
  );
  scene.add(marker);
  const render = () => {
    const center = projectOperator.execute(view.center, geographic);
    if (!center) return;
    camera.position.copy(position(center.x, center.y, 3));
    camera.lookAt(0, 0, 0);
    marker.position.copy(position(center.x, center.y, 1.02));
    const visibleArea = view.visibleArea && projectOperator.execute(view.visibleArea, geographic);
    const vertices = [];
    for (const ring of visibleArea?.rings ?? []) {
      for (let index = 1; index < ring.length; index++) {
        const start = position(...ring[index - 1]);
        const end = position(...ring[index]);
        for (let segment = 0; segment < 16; segment++) {
          vertices.push(...start.clone().lerp(end, segment / 16).normalize().multiplyScalar(1.012).toArray());
          vertices.push(...start.clone().lerp(end, (segment + 1) / 16).normalize().multiplyScalar(1.012).toArray());
        }
      }
    }
    footprint.geometry.dispose();
    footprint.geometry = new THREE.BufferGeometry();
    footprint.geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    renderer.render(scene, camera);
  };
  const resize = () => {
    const size = view.width < 180 ? 44 : 68;
    view.container.classList.toggle("compact-inset", Boolean(homeCenter) && view.width < 180);
    host.style.width = `${size}px`;
    host.style.height = `${size}px`;
    renderer.setSize(size, size);
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
    globe.geometry.dispose();
    globe.material.dispose();
    footprint.geometry.dispose();
    footprint.material.dispose();
    marker.geometry.dispose();
    marker.material.dispose();
    renderer.dispose();
    host.remove();
    view.container?.classList.remove("compact-inset");
  } });
  resize();
}