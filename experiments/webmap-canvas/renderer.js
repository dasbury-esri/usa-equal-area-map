import geodesic from "geographiclib-geodesic";
import { createElement, LocateFixed, GripVertical } from "lucide";
import { projections } from "../../src/projections.js";
import { MIN_SCALE, MAX_SCALE, PANE_NAMES, resolveSwipe } from "./config.js";
import { visibleAtScale } from "./data.js";
import { prepareGeometry, visibleRanges } from "./geometry.js";
import { projectionGLSL, projectionParameters, projectChunkBounds, createProgram, setProjection } from "./projection.js";

export const HOME_CENTERS = Object.freeze({ conus: [-97, 38], ak: [-159, 62], hi: [-157, 20.7], pr: [-66.2, 18.2] });
const metersPerPixel = scale => scale * 0.0254 / 96;

const vertexSource = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 first;
layout(location=1) in vec2 second;
layout(location=2) in vec2 third;
uniform vec2 uCenter;
uniform vec2 uViewport;
uniform float uResolution;
uniform int uMode;
uniform float uWidth;
uniform float uSize;
out vec2 local;
flat out float segmentLength;
${projectionGLSL}
void main() {
  vec2 position;
  local = vec2(0.0);
  segmentLength = 0.0;
  float firstLon = relativeLongitude(first.x);
  float secondLon = relativeLongitude(second.x);
  float thirdLon = relativeLongitude(third.x);
  bool crossesCut = max(firstLon, max(secondLon, thirdLon)) - min(firstLon, min(secondLon, thirdLon)) > PI;
  if (crossesCut) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (uMode == 0) {
    vec2 geographic = gl_VertexID == 0 ? first : gl_VertexID == 1 ? second : third;
    position = (project(geographic) - uCenter) / uResolution;
  } else {
    vec2 corner = vec2(gl_VertexID >= 2 ? 1.0 : -1.0, gl_VertexID % 2 == 1 ? 1.0 : -1.0);
    vec2 start = (project(first) - uCenter) / uResolution;
    if (uMode == 1) {
      vec2 finish = (project(second) - uCenter) / uResolution;
      vec2 delta = finish - start;
      segmentLength = length(delta);
      vec2 direction = segmentLength > 0.00001 ? delta / segmentLength : vec2(1.0, 0.0);
      float radius = uWidth * 0.5 + 1.0;
      local = vec2(corner.x < 0.0 ? -radius : segmentLength + radius, corner.y * radius);
      position = start + direction * local.x + vec2(-direction.y, direction.x) * local.y;
    } else {
      local = corner * (uSize * 0.5 + uWidth * 0.5 + 1.0);
      position = start + local;
    }
  }
  gl_Position = vec4(position * 2.0 / uViewport, 0.0, 1.0);
}
`;

const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
uniform int uMode;
uniform float uWidth;
uniform float uSize;
uniform vec4 uColor;
uniform vec4 uOutline;
in vec2 local;
flat in float segmentLength;
out vec4 color;
void main() {
  color = uColor;
  if (uMode == 1) {
    float along = max(max(-local.x, local.x - segmentLength), 0.0);
    float distance = length(vec2(along, local.y));
    float coverage = 1.0 - smoothstep(uWidth * 0.5 - fwidth(distance) * 0.5, uWidth * 0.5 + fwidth(distance) * 0.5, distance);
    if (coverage <= 0.0) discard;
    color.a *= coverage;
  } else if (uMode == 2) {
    float distance = length(local);
    float radius = (uSize + uWidth) * 0.5;
    float coverage = 1.0 - smoothstep(radius - fwidth(distance) * 0.5, radius + fwidth(distance) * 0.5, distance);
    if (coverage <= 0.0) discard;
    if (uWidth > 0.0 && distance > (uSize - uWidth) * 0.5) color = uOutline;
    color.a *= coverage;
  }
}
`;

export class CanvasRenderer {
  constructor(canvas, options, report) {
    this.canvas = canvas;
    this.options = options;
    this.scale = options.scale;
    this.report = report;
    this.layers = [];
    this.culling = true;
    this.swipeSelection = options.swipe;
    this.swipeFraction = 0.5;
    this.frame = null;
    this.frameTimes = [];
    this.gl = canvas.getContext("webgl2", { alpha: false, antialias: true, stencil: true });
    if (!this.gl) throw new Error("WebGL2 is unavailable.");
    this.program = createProgram(this.gl, vertexSource, fragmentSource);
    this.uniforms = Object.fromEntries(["uResolution", "uCenter", "uViewport", "uMode", "uWidth", "uSize", "uColor", "uOutline"]
      .map(name => [name, this.gl.getUniformLocation(this.program, name)]));
    this.vao = this.gl.createVertexArray();
    this.scratch = this.gl.createBuffer();
    this.scratchBytes = 0;
    this.panes = options.panes.map(id => {
      const parameters = projectionParameters(projections[options.projection][id]);
      return { id, parameters, center: parameters.converter.forward(HOME_CENTERS[id]),
        element: document.querySelector(`[data-pane="${id}"]`) };
    });
    canvas.addEventListener("webglcontextlost", () => report("Renderer", "WebGL context lost. Reload to restore rendering."));
    this.observer = new ResizeObserver(() => { this.requestDraw(); this.onNavigate?.(); });
    this.panes.forEach(pane => { this.observer.observe(pane.element); this.bindPane(pane); });
  }

  async load(datasets, { isCurrent = () => true } = {}) {
    const budget = { vertices: 0, instances: 0 };
    const layers = [];
    for (const dataset of datasets) {
      const before = { ...budget };
      let buffer;
      try {
        const mesh = await prepareGeometry(dataset, budget);
        buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, mesh.values, this.gl.STATIC_DRAW);
        if (this.gl.getError() !== this.gl.NO_ERROR) throw new Error("GPU upload failed");
        projectChunkBounds(this.gl, buffer, mesh.draws.flatMap(draw => draw.chunks), this.panes);
        layers.push({ dataset, buffer, draws: mesh.draws, instances: mesh.instances, bytes: mesh.values.byteLength });
      } catch (error) {
        if (buffer) this.gl.deleteBuffer(buffer);
        Object.assign(budget, before);
        this.report(dataset.title, `Rejected before rendering: ${error.message}`);
      }
    }
    if (!isCurrent() || (this.layers.length && layers.length !== datasets.length)) {
      for (const layer of layers) this.gl.deleteBuffer(layer.buffer);
      return false;
    }
    for (const layer of this.layers) this.gl.deleteBuffer(layer.buffer);
    this.layers = layers;
    const scratchBytes = layers.reduce((maximum, layer) => layer.draws.reduce((size, draw) => Math.max(size, draw.count * 24), maximum), 0);
    if (scratchBytes > this.scratchBytes) {
      this.gl.bindBuffer(this.gl.COPY_WRITE_BUFFER, this.scratch);
      this.gl.bufferData(this.gl.COPY_WRITE_BUFFER, scratchBytes, this.gl.DYNAMIC_COPY);
      this.scratchBytes = scratchBytes;
    }
    this.budget = budget;
    this.swipePair = resolveSwipe(this.layers.map(layer => layer.dataset), this.swipeSelection);
    if (this.swipePair) this.panes.filter(pane => !pane.element.querySelector(".swipe-divider")).forEach(pane => this.bindSwipe(pane));
    this.draw();
    await new Promise(resolve => requestAnimationFrame(() => { this.gl.finish(); resolve(); }));
    return true;
  }

  requestDraw() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.draw(); });
  }

  draw() {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const started = performance.now();
    this.drawStats = { calls: 0, instances: 0, availableInstances: 0, copiedBytes: 0 };
    const ratio = devicePixelRatio;
    const width = Math.round(innerWidth * ratio);
    const height = Math.round(innerHeight * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.clearColor(0.929, 0.957, 0.961, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const location = name => this.uniforms[name];
    gl.uniform1f(location("uResolution"), metersPerPixel(this.scale));
    for (const pane of this.panes) {
      const bounds = pane.element.getBoundingClientRect();
      const rect = { x: Math.round(bounds.left * ratio), y: height - Math.round(bounds.bottom * ratio),
        width: Math.round(bounds.right * ratio) - Math.round(bounds.left * ratio), height: Math.round(bounds.bottom * ratio) - Math.round(bounds.top * ratio) };
      gl.viewport(rect.x, rect.y, rect.width, rect.height);
      gl.scissor(rect.x, rect.y, rect.width, rect.height);
      setProjection(gl, this.program, pane.parameters);
      gl.uniform2fv(location("uCenter"), pane.center);
      gl.uniform2f(location("uViewport"), bounds.width, bounds.height);
      const layers = this.swipePair ? [...this.layers.filter(layer => !this.swipePair.includes(layer.dataset)),
        ...this.swipePair.map(dataset => this.layers.find(layer => layer.dataset === dataset))] : this.layers;
      for (const layer of layers) {
        if (!visibleAtScale(layer.dataset, this.scale)) continue;
        const side = this.swipePair?.indexOf(layer.dataset) ?? -1;
        const split = Math.round(rect.width * this.swipeFraction);
        gl.scissor(rect.x + (side === 1 ? split : 0), rect.y,
          side === 0 ? split : side === 1 ? rect.width - split : rect.width, rect.height);
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
        for (const draw of layer.draws) {
          if (!draw.count) continue;
          const padding = ((draw.size ?? 0) + (draw.width ?? 0) + 4) * metersPerPixel(this.scale);
          const halfWidth = bounds.width * 0.5 * metersPerPixel(this.scale) + padding;
          const halfHeight = bounds.height * 0.5 * metersPerPixel(this.scale) + padding;
          const viewport = [pane.center[0] - halfWidth, pane.center[1] - halfHeight,
            pane.center[0] + halfWidth, pane.center[1] + halfHeight];
          this.drawStats.availableInstances += draw.count;
          const ranges = visibleRanges(draw, pane.id, viewport, this.culling);
          if (!ranges.length) continue;
          gl.uniform1i(location("uMode"), draw.mode);
          gl.uniform1f(location("uWidth"), draw.width ?? 0);
          gl.uniform1f(location("uSize"), draw.size ?? 0);
          gl.uniform4fv(location("uColor"), draw.color);
          gl.uniform4fv(location("uOutline"), draw.outline ?? [0, 0, 0, 0]);
          if (draw.mode === 1) {
            gl.clear(gl.STENCIL_BUFFER_BIT);
            gl.enable(gl.STENCIL_TEST);
            gl.stencilFunc(gl.EQUAL, 0, 255);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
          }
          let offset = draw.offset;
          let count = draw.count;
          const complete = ranges.length === 1 && ranges[0].offset === draw.offset && ranges[0].count === draw.count;
          if (!complete) {
            gl.bindBuffer(gl.COPY_READ_BUFFER, layer.buffer);
            gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.scratch);
            count = 0;
            for (const range of ranges) {
              gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, range.offset * 24, count * 24, range.count * 24);
              count += range.count;
            }
            this.drawStats.copiedBytes += count * 24;
            offset = 0;
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, complete ? layer.buffer : this.scratch);
          for (let index = 0; index < 3; index++) {
            gl.enableVertexAttribArray(index);
            gl.vertexAttribPointer(index, 2, gl.FLOAT, false, 24, offset * 24 + index * 8);
            gl.vertexAttribDivisor(index, 1);
          }
          gl.drawArraysInstanced(draw.mode === 0 ? gl.TRIANGLES : gl.TRIANGLE_STRIP, 0, draw.mode === 0 ? 3 : 4, count);
          this.drawStats.calls++;
          this.drawStats.instances += count;
          gl.disable(gl.STENCIL_TEST);
        }
      }
      this.updateScaleBar(pane, bounds);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
    document.querySelector("#scale").textContent = `1:${Math.round(this.scale).toLocaleString("en-US")}`;
    this.frameTimes.push(performance.now() - started);
    if (this.frameTimes.length > 1000) this.frameTimes.shift();
  }

  updateScaleBar(pane, bounds) {
    const output = pane.element.querySelector(".scale-bar");
    const maximum = Math.min(120, bounds.width - 20);
    const resolution = metersPerPixel(this.scale);
    const distance = width => {
      const startX = pane.id === "ak" ? bounds.width - 8 - width : 8;
      const projected = x => [pane.center[0] + (x - bounds.width / 2) * resolution,
        pane.center[1] - (bounds.height / 2 - 8) * resolution];
      const first = pane.parameters.converter.inverse(projected(startX));
      const second = pane.parameters.converter.inverse(projected(startX + width));
      return geodesic.Geodesic.WGS84.Inverse(first[1], first[0], second[1], second[0]).s12;
    };
    const available = distance(maximum);
    if (!Number.isFinite(available) || available <= 0 || maximum < 20) { output.hidden = true; return; }
    output.hidden = false;
    const power = 10 ** Math.floor(Math.log10(available));
    const target = [5, 2, 1].find(value => value * power <= available) * power;
    let low = 0;
    let high = maximum;
    for (let iteration = 0; iteration < 20; iteration++) {
      const middle = (low + high) / 2;
      if (distance(middle) < target) low = middle; else high = middle;
    }
    output.style.width = `${(low + high) / 2}px`;
    output.textContent = target >= 1000 ? `${target / 1000} km` : `${target} m`;
    output.dataset.meters = target;
  }

  zoom(pane, factor, clientX, clientY) {
    const oldResolution = metersPerPixel(this.scale);
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));
    const difference = oldResolution - metersPerPixel(this.scale);
    const bounds = pane.element.getBoundingClientRect();
    pane.center[0] += (clientX - bounds.left - bounds.width / 2) * difference;
    pane.center[1] -= (clientY - bounds.top - bounds.height / 2) * difference;
    this.requestDraw();
    this.onNavigate?.();
  }

  pan(id, deltaX, deltaY) {
    const pane = this.panes.find(value => value.id === id);
    pane.center[0] -= deltaX * metersPerPixel(this.scale);
    pane.center[1] += deltaY * metersPerPixel(this.scale);
    this.requestDraw();
    this.onNavigate?.();
  }

  setSwipe(fraction) {
    this.swipeFraction = Math.max(0, Math.min(1, fraction));
    for (const pane of this.panes) {
      const divider = pane.element.querySelector(".swipe-divider");
      if (!divider) continue;
      const percentage = Math.round(this.swipeFraction * 100);
      divider.style.left = `${this.swipeFraction * 100}%`;
      divider.setAttribute("aria-valuenow", percentage);
      divider.setAttribute("aria-valuetext", `${this.swipePair[0].title} ${percentage}%, ${this.swipePair[1].title} ${100 - percentage}%`);
    }
    this.requestDraw();
  }

  bindSwipe(pane) {
    const divider = document.createElement("div");
    divider.className = "swipe-divider";
    divider.tabIndex = 0;
    divider.setAttribute("role", "slider");
    divider.setAttribute("aria-label", `Swipe ${PANE_NAMES[pane.id]}`);
    divider.setAttribute("aria-orientation", "horizontal");
    divider.setAttribute("aria-valuemin", "0");
    divider.setAttribute("aria-valuemax", "100");
    divider.title = `${this.swipePair[0].title} / ${this.swipePair[1].title}`;
    divider.append(createElement(GripVertical, { width: 24, height: 32 }));
    pane.element.append(divider);
    const move = event => {
      const bounds = pane.element.getBoundingClientRect();
      this.setSwipe((event.clientX - bounds.left) / bounds.width);
    };
    divider.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      divider.focus();
      divider.setPointerCapture(event.pointerId);
      move(event);
    });
    divider.addEventListener("pointermove", event => { if (divider.hasPointerCapture(event.pointerId)) move(event); });
    divider.addEventListener("keydown", event => {
      const step = event.shiftKey ? 0.1 : 0.01;
      const values = { ArrowLeft: this.swipeFraction - step, ArrowRight: this.swipeFraction + step, Home: 0, End: 1 };
      if (!Object.hasOwn(values, event.key)) return;
      event.preventDefault();
      this.setSwipe(values[event.key]);
    });
    this.setSwipe(this.swipeFraction);
  }

  bindPane(pane) {
    const button = pane.element.querySelector(".recenter");
    button.replaceChildren(createElement(LocateFixed, { width: 16, height: 16 }));
    button.setAttribute("aria-label", `Recenter ${PANE_NAMES[pane.id]}`);
    button.disabled = false;
    button.addEventListener("click", () => {
      pane.center = pane.parameters.converter.forward(HOME_CENTERS[pane.id]);
      this.requestDraw(); this.onNavigate?.();
    });
    pane.element.addEventListener("wheel", event => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.element.clientHeight : 1);
      this.zoom(pane, Math.exp(Math.max(-1, Math.min(1, delta * 0.001))), event.clientX, event.clientY);
    }, { passive: false });
    const pointers = new Map();
    pane.element.addEventListener("pointerdown", event => {
      if (event.target.closest("button,[role=slider]") || event.button !== 0) return;
      pane.element.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });
    pane.element.addEventListener("pointermove", event => {
      if (!pointers.has(event.pointerId)) return;
      const before = [...pointers.values()];
      const previous = pointers.get(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const after = [...pointers.values()];
      if (after.length === 1) this.pan(pane.id, event.clientX - previous.x, event.clientY - previous.y);
      else if (after.length === 2) {
        const distance = pair => Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (distance(after) > 0) this.zoom(pane, distance(before) / distance(after),
          (after[0].x + after[1].x) / 2, (after[0].y + after[1].y) / 2);
      }
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) pane.element.addEventListener(type, event => pointers.delete(event.pointerId));
  }
}
