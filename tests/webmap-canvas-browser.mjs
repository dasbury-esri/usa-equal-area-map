import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

export const itemIds = ["42430a34a2b44c0da678ce60ce20dd31", "bbda2d6bc77c495ab382e313f02888f1", "6100fd30484645e6b3ec7006d95aa7b8"];
export const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";

export function applyComparisonStyle(json, index) {
  const colors = [[230, 235, 231, 255], [202, 221, 211, 255], [255, 255, 255, 0]];
  const outlines = [[150, 161, 158, 255], [59, 104, 92, 255], [160, 80, 65, 255]];
  for (const layer of json.layers ?? []) {
    layer.blendMode = "normal";
    layer.effect = null;
    layer.featureEffect = null;
    layer.layerDefinition.drawingInfo.renderer = { type: "simple", symbol: { type: "esriSFS", style: "esriSFSSolid",
      color: colors[index], outline: { type: "esriSLS", style: "esriSLSSolid", color: outlines[index], width: 0.5 } } };
  }
  return json;
}

export async function comparisonStyles(page) {
  for (const [index, id] of itemIds.entries()) {
    await page.route(`**/sharing/rest/content/items/${id}/data*`, async route => {
      const response = await route.fetch();
      const json = applyComparisonStyle(await response.json(), index);
      await route.fulfill({ response, json });
    });
  }
}

export async function verifyMultiply(page) {
  const checks = await page.evaluate(async () => {
    const renderer = window.webmapCanvas.renderer, gl = renderer.gl, pane = renderer.panes.find(pane => pane.id === "conus");
    renderer.onNavigate = undefined;
    pane.center = pane.parameters.converter.forward([-97, 38]);
    const read = () => {
      renderer.draw();
      const bounds = pane.element.getBoundingClientRect(), pixel = new Uint8Array(4);
      gl.readPixels(Math.floor((bounds.x + bounds.width / 2) * devicePixelRatio),
        Math.floor((innerHeight - bounds.y - bounds.height / 2) * devicePixelRatio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    await renderer.load([]);
    const backdrop = read(), rows = [];
    for (const [opacity, alpha] of [[1, 1], [0.5, 1], [0.5, 0.5]]) {
      const symbol = { type: "simple-fill", style: "solid", color: [128, 64, 192, alpha] };
      const feature = { attributes: {}, geometry: { type: "polygon", rings: [[[-98, 37], [-98, 39], [-96, 39], [-96, 37], [-98, 37]]] } };
      await renderer.load([{ id: "multiply-probe", title: "multiply-probe", blendMode: "multiply", opacity, visible: true, ranges: [],
        features: [feature, feature], renderer: { symbolFor: () => symbol } }]);
      const effectiveAlpha = (1 - (1 - alpha) ** 2) * opacity;
      rows.push({ opacity, alpha, actual: read(), expected: backdrop.slice(0, 3).map((color, index) =>
        color * (1 - effectiveAlpha + symbol.color[index] / 255 * effectiveAlpha)), error: gl.getError() });
    }
    return rows;
  });
  for (const row of checks) {
    assert.equal(row.error, 0);
    row.expected.forEach((value, index) => assert.ok(Math.abs(row.actual[index] - value) <= 2, JSON.stringify(row)));
  }
  return checks;
}

async function run() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const selectedIds = process.env.CANVAS_TEST_LAYERS?.split(",") ?? itemIds;
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await comparisonStyles(page);
    await page.goto(`${base}experiments/webmap-canvas/?layers=${selectedIds.join(",")}&projection=${process.env.CANVAS_TEST_PROJECTION ?? "lambert"}`);
    await page.waitForFunction(() => ["loaded", "ready", "error"].includes(window.webmapCanvas?.status), null, { timeout: 180000 });
    const result = await page.evaluate(() => ({ status: window.webmapCanvas.status, errors: window.webmapCanvas.errors,
      rendered: window.webmapCanvas.renderer?.layers.length,
      reports: window.webmapCanvas.reports, contexts: window.getWebGLContextStats(), datasets: window.webmapCanvas.datasets?.map(data => ({
        itemId: data.layer.portalItem.id, title: data.title, count: data.count, pages: data.pages, vertices: data.vertices, outFields: data.outFields,
        positiveAleutianVertices: data.features.reduce((total, feature) => total + (feature.geometry?.rings ?? [])
          .reduce((sum, ring) => sum + ring.filter(([lon, lat]) => lon > 170 && lat > 50 && lat < 55).length, 0), 0),
      })) }));
    console.log(JSON.stringify(result, null, 2));
    assert.notEqual(result.status, "error");
    assert.equal(result.datasets.length, selectedIds.length);
    assert.equal(result.rendered, selectedIds.length);
    for (const data of result.datasets.filter(data => data.itemId !== itemIds[2])) assert.ok(data.positiveAleutianVertices > 0);
    const districts = result.datasets.find(data => data.itemId === itemIds[2]);
    if (districts) assert.equal(districts.positiveAleutianVertices, 0);
    assert.ok(result.contexts.live <= 1);
    if (process.argv.includes("--startup-check")) {
      await verifyQuantization(page);
      await captureAreaBaseline(page);
      return;
    }
    if (process.argv.includes("--performance-only")) {
      await verifyCulling(page);
      await verifyAreaDetail(page);
      await page.close();
      return;
    }
    if (result.status === "ready") await verifyRendering(page);
    await page.close();
    const synthetic = await browser.newPage({ viewport: { width: 800, height: 600 }, hasTouch: true });
    await verifySymbolsAndPinch(synthetic);
    await verifySwipe(synthetic);
    await synthetic.close();
  } finally { await browser.close(); }
}

export async function verifyRendering(page) {
  const initial = await page.evaluate(() => ({ scale: window.webmapCanvas.renderer.scale,
    centers: window.webmapCanvas.renderer.panes.map(pane => [...pane.center]),
    downloads: window.webmapCanvas.datasets.map(data => data.pages) }));
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const pixels = await page.evaluate(() => {
      const renderer = window.webmapCanvas.renderer;
      renderer.draw();
      const gl = renderer.gl;
      const result = renderer.panes.map(pane => {
        const bounds = pane.element.getBoundingClientRect();
        const width = Math.floor(bounds.width * devicePixelRatio);
        const height = Math.floor(bounds.height * devicePixelRatio);
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(Math.round(bounds.left * devicePixelRatio), gl.drawingBufferHeight - Math.round(bounds.bottom * devicePixelRatio), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let changed = 0;
        for (let index = 0; index < pixels.length; index += 4) if (Math.abs(pixels[index] - 237) > 3 || Math.abs(pixels[index + 1] - 244) > 3) changed++;
        const button = pane.element.querySelector("button").getBoundingClientRect();
        const title = pane.element.querySelector("h2").getBoundingClientRect();
        return { id: pane.id, changed, controlsFit: button.left >= bounds.left && button.right <= bounds.right && title.right <= button.left,
          barMeters: Number(pane.element.querySelector(".scale-bar").dataset.meters) };
      });
      return { panes: result, error: gl.getError(), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(pixels.error, 0);
    assert.equal(pixels.overflow, false);
    for (const pane of pixels.panes) {
      assert.ok(pane.changed > 3, `${viewport.width}/${pane.id}: blank pane`);
      assert.ok(pane.controlsFit, `${viewport.width}/${pane.id}: controls overlap`);
      assert.ok(pane.barMeters > 0);
    }
    await page.screenshot({ path: `/tmp/usa-map-canvas-${viewport.width}x${viewport.height}.png` });
    console.log("PIXELS", viewport, pixels);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  const bounds = await page.locator('[data-pane="ak"]').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -200);
  await page.waitForFunction(scale => window.webmapCanvas.renderer.scale < scale, initial.scale);
  const zoomed = await page.evaluate(() => window.webmapCanvas.renderer.scale);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  const panned = await page.evaluate(() => ({ scale: window.webmapCanvas.renderer.scale,
    centers: window.webmapCanvas.renderer.panes.map(pane => [...pane.center]) }));
  assert.equal(panned.scale, zoomed);
  assert.deepEqual(panned.centers[0], initial.centers[0]);
  assert.notDeepEqual(panned.centers[1], initial.centers[1]);
  await page.getByRole("button", { name: "Recenter Alaska", exact: true }).click();
  const final = await page.evaluate(() => ({ scale: window.webmapCanvas.renderer.scale,
    centers: window.webmapCanvas.renderer.panes.map(pane => [...pane.center]),
    downloads: window.webmapCanvas.datasets.map(data => data.pages), contexts: window.getWebGLContextStats() }));
  assert.equal(final.scale, zoomed);
  assert.deepEqual(final.centers[1], initial.centers[1]);
  assert.deepEqual(final.downloads, initial.downloads);
  assert.deepEqual(final.contexts, { live: 1, created: 1 });
  console.log("PASS shared zoom, independent pan, current-scale recenter, stable downloads/context");
}

export async function verifyQuantization(page) {
  const checks = await page.evaluate(async () => {
    const checks = [];
    for (const dataset of window.webmapCanvas.datasets) {
      const target = dataset.layer.portalItem.id === "6100fd30484645e6b3ec7006d95aa7b8" ? [-77, 39] : [-66, 18];
      let selected, nearest = Infinity;
      for (const feature of dataset.features) for (const ring of feature.geometry?.rings ?? []) {
        const point = ring[0];
        const distance = Math.hypot(point[0] - target[0], point[1] - target[1]);
        if (distance < nearest) { selected = feature; nearest = distance; }
      }
      const id = selected.attributes[dataset.layer.objectIdField];
      const service = new URL(dataset.layer.url);
      if (!/\/\d+\/?$/.test(service.pathname)) service.pathname = `${service.pathname.replace(/\/$/, "")}/${dataset.layer.layerId}`;
      service.pathname += "/query";
      service.search = new URLSearchParams({ f: "json", objectIds: String(id), outSR: "4326", returnGeometry: "true",
        outFields: dataset.layer.objectIdField, returnZ: "false", returnM: "false" });
      const response = await fetch(service);
      if (!response.ok) throw new Error(`Unquantized query HTTP ${response.status}`);
      const raw = await response.json();
      if (raw.error || raw.transform || raw.features?.length !== 1) throw new Error("Invalid unquantized control response");
      const ring = selected.geometry.rings.reduce((longest, ring) => ring.length > longest.length ? ring : longest, []);
      const samples = [ring[0], ring[Math.floor(ring.length / 3)], ring[Math.floor(ring.length * 2 / 3)]];
      const vertices = raw.features[0].geometry.rings.flat();
      checks.push({ item: dataset.layer.portalItem.id, id, tolerance: dataset.generalization,
        vertices: samples.map(point => {
          let error = Infinity, control;
          for (const vertex of vertices) {
            const difference = Math.max(Math.abs(point[0] - vertex[0]), Math.abs(point[1] - vertex[1]));
            if (difference < error) { error = difference; control = vertex; }
          }
          return { decoded: point, unquantized: control, maximumAxisError: error };
        }) });
    }
    return checks;
  });
  for (const check of checks) for (const vertex of check.vertices) {
    assert.ok(vertex.maximumAxisError <= check.tolerance * 0.51 + 1e-8, JSON.stringify(check));
  }
  console.log("QUANTIZATION", JSON.stringify(checks));
}

export async function captureAreaBaseline(page) {
  const datasets = await page.evaluate(async () => {
    const { polygonParts, triangulate } = await import("/usa-equal-area-map/experiments/webmap-canvas/geometry.js");
    return window.webmapCanvas.datasets.map(dataset => ({ item: dataset.layer.portalItem.id,
      features: dataset.features.map(feature => {
        let area = 0;
        for (const polygon of polygonParts(feature.geometry?.rings ?? [])) {
          const { vertices, indices } = triangulate(polygon);
          for (let index = 0; index < indices.length; index += 3) {
            const first = indices[index] * 2, second = indices[index + 1] * 2, third = indices[index + 2] * 2;
            area += Math.abs((vertices[second] - vertices[first]) * (vertices[third + 1] - vertices[first + 1])
              - (vertices[third] - vertices[first]) * (vertices[second + 1] - vertices[first + 1])) / 2;
          }
        }
        return { id: feature.attributes[dataset.layer.objectIdField], area, geometry: feature.geometry?.toJSON() ?? null };
      }) }));
  });
  const path = process.env.CANVAS_AREA_FIXTURE ?? "/tmp/usa-map-startup-areas.json";
  writeFileSync(path, JSON.stringify(datasets));
  console.log("AREA BASELINE", path, datasets.map(dataset => ({ item: dataset.item, features: dataset.features.length })));
}

export async function verifyCulling(page) {
  const memory = await page.evaluate(() => {
    const renderer = window.webmapCanvas.renderer, gl = renderer.gl;
    gl.copyBufferSubData = () => { throw new Error("Per-range rendering must not copy GPU buffers"); };
    const bytes = renderer.layers.reduce((sum, layer) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
      return sum + gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
    }, 0);
    return { bytes, declared: renderer.layers.reduce((sum, layer) => sum + layer.bytes, 0), hasScratch: "scratch" in renderer };
  });
  assert.equal(memory.hasScratch, false);
  assert.equal(memory.bytes, memory.declared);
  console.log("GPU GEOMETRY BUFFERS", memory);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const result = await page.evaluate(() => {
      const renderer = window.webmapCanvas.renderer;
      const capture = culling => {
        renderer.culling = culling;
        renderer.draw();
        const gl = renderer.gl;
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return { pixels, stats: { ...renderer.drawStats } };
      };
      const full = capture(false);
      const culled = capture(true);
      let differences = 0, changed = 0;
      for (let index = 0; index < full.pixels.length; index++) if (full.pixels[index] !== culled.pixels[index]) differences++;
      for (let index = 0; index < culled.pixels.length; index += 4) if (Math.abs(culled.pixels[index] - 237) > 3) changed++;
      return { differences, changed, full: full.stats, culled: culled.stats, error: renderer.gl.getError() };
    });
    assert.equal(result.error, 0);
    assert.equal(result.differences, 0, JSON.stringify({ viewport, result }));
    assert.ok(result.changed > 0);
    assert.ok(result.culled.instances < result.full.instances);
    assert.ok(result.culled.calls > result.full.calls);
    await page.screenshot({ path: `/tmp/usa-map-culling-${viewport.width}x${viewport.height}.png` });
    console.log("CULLING", viewport, result);
  }
}

export async function verifyAreaDetail(page) {
  const initial = await page.evaluate(() => ({ scale: window.webmapCanvas.coverage.scale,
    tolerance: window.webmapCanvas.coverage.generalization, layers: window.webmapCanvas.renderer.layers.length }));
  await page.evaluate(async () => {
    const state = window.webmapCanvas;
    await state.refresh();
  });
  await page.waitForFunction(() => !window.webmapCanvas.refreshing);
  const before = await page.evaluate(() => window.webmapCanvas.refreshCount);
  const zoom = async factor => page.evaluate(async factor => {
    const state = window.webmapCanvas, pane = state.renderer.panes[0], rect = pane.element.getBoundingClientRect();
    state.renderer.zoom(pane, factor, rect.x + rect.width / 2, rect.y + rect.height / 2);
    await state.refresh();
  }, factor);
  await zoom(0.97);
  assert.equal(await page.evaluate(() => window.webmapCanvas.refreshCount), before);
  await zoom(0.5);
  await page.waitForFunction(before => window.webmapCanvas.refreshCount > before && !window.webmapCanvas.refreshing,
    before, { timeout: 180000 });
  const final = await page.evaluate(() => ({ tolerance: window.webmapCanvas.coverage.generalization,
    layers: window.webmapCanvas.renderer.layers.length, contexts: window.getWebGLContextStats() }));
  assert.ok(final.tolerance <= initial.tolerance / 2);
  assert.equal(final.layers, initial.layers);
  assert.deepEqual(final.contexts, { live: 1, created: 1 });
  console.log("PASS zoom threshold and area detail", { initial, final });
}

export async function verifySymbolsAndPinch(page) {
  await page.goto(`${base}experiments/webmap-canvas/?panes=conus`);
  await page.waitForFunction(() => window.webmapCanvas?.status === "waiting");
  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import("/usa-equal-area-map/experiments/webmap-canvas/renderer.js");
    const renderer = new CanvasRenderer(document.querySelector("canvas"), window.webmapCanvas.options, () => {});
    window.webmapCanvas.renderer = renderer;
    const marker = { type: "simple-marker", style: "circle", color: [200, 30, 50, 1], size: 18,
      outline: { type: "simple-line", style: "solid", color: [20, 40, 60, 1], width: 2 } };
    const line = { type: "simple-line", style: "solid", color: [20, 90, 180, 1], width: 3 };
    const dataset = (id, symbol, geometry) => ({ id, title: id, visible: true, opacity: 0.7, ranges: [],
      renderer: { symbolFor: () => symbol }, features: [{ attributes: {}, geometry }] });
    await renderer.load([dataset("line", line, { type: "polyline", paths: [[[-100, 37], [-97, 38], [-94, 37]]] }),
      dataset("point", marker, { type: "point", x: -97, y: 38 })]);
    renderer.draw();
    const pixel = new Uint8Array(4);
    renderer.gl.readPixels(400, 278, 1, 1, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, pixel);
    return { pixel: [...pixel], modes: renderer.layers.flatMap(layer => layer.draws.map(draw => draw.mode)),
      contexts: window.getWebGLContextStats() };
  });
  assert.deepEqual(result.modes, [1, 2]);
  assert.ok(result.pixel[0] > result.pixel[1]);
  assert.equal(result.contexts.live, 1);
  const cdp = await page.context().newCDPSession(page);
  const scale = await page.evaluate(() => window.webmapCanvas.renderer.scale);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 350, y: 300, id: 1 }, { x: 450, y: 300, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 300, y: 300, id: 1 }, { x: 500, y: 300, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const final = await page.evaluate(() => ({ scale: window.webmapCanvas.renderer.scale, contexts: window.getWebGLContextStats() }));
  assert.ok(final.scale < scale);
  assert.equal(final.contexts.created, 1);
  await cdp.detach();
  console.log("PASS circle/line symbols and two-pointer pinch");
}

export async function verifySwipe(page) {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${base}experiments/webmap-canvas/?swipe=0,1`);
  await page.waitForFunction(() => window.webmapCanvas?.status === "waiting");
  await page.evaluate(async () => {
    const { CanvasRenderer, HOME_CENTERS } = await import("/usa-equal-area-map/experiments/webmap-canvas/renderer.js");
    const renderer = new CanvasRenderer(document.querySelector("canvas"), window.webmapCanvas.options, () => {});
    window.webmapCanvas.renderer = renderer;
    const features = Object.values(HOME_CENTERS).map(([longitude, latitude]) => ({ attributes: {}, geometry: { type: "polygon",
      rings: [[[longitude - 5, latitude - 5], [longitude - 5, latitude + 5], [longitude + 5, latitude + 5],
        [longitude + 5, latitude - 5], [longitude - 5, latitude - 5]]] } }));
    await renderer.load([[240, 20, 20, 1], [20, 40, 240, 1]].map((color, index) => ({ id: `layer-${index}`, title: `Layer ${index}`,
      visible: true, opacity: 1, ranges: [], features, renderer: { symbolFor: () => ({ type: "simple-fill", style: "solid", color }) } })));
  });
  const pixels = () => page.evaluate(() => {
    const renderer = window.webmapCanvas.renderer;
    renderer.draw();
    return renderer.panes.map(pane => {
      const bounds = pane.element.getBoundingClientRect();
      return [-4, 4].map(offset => {
        const pixel = new Uint8Array(4);
        const gl = renderer.gl;
        gl.readPixels(Math.round((bounds.left + bounds.width / 2 + offset) * devicePixelRatio),
          gl.drawingBufferHeight - Math.round((bounds.top + bounds.height / 2) * devicePixelRatio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      });
    });
  });
  for (const [left, right] of await pixels()) { assert.ok(left[0] > 200 && left[2] < 100); assert.ok(right[2] > 200 && right[0] < 100); }
  const slider = page.getByRole("slider", { name: "Swipe Alaska", exact: true });
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  assert.deepEqual(await page.getByRole("slider").evaluateAll(sliders => sliders.map(slider => slider.getAttribute("aria-valuenow"))), ["49", "49", "49", "49"]);
  await page.keyboard.press("Home");
  for (const pair of await pixels()) for (const pixel of pair) assert.ok(pixel[2] > 200 && pixel[0] < 100);
  await page.keyboard.press("End");
  for (const pair of await pixels()) for (const pixel of pair) assert.ok(pixel[0] > 200 && pixel[2] < 100);
  await page.evaluate(() => window.webmapCanvas.renderer.setSwipe(0.5));
  const centers = await page.evaluate(() => window.webmapCanvas.renderer.panes.map(pane => [...pane.center]));
  const bounds = await page.locator('[data-pane="ak"]').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height / 2);
  await page.mouse.up();
  const final = await page.evaluate(() => ({ fraction: window.webmapCanvas.renderer.swipeFraction,
    centers: window.webmapCanvas.renderer.panes.map(pane => [...pane.center]), contexts: window.getWebGLContextStats() }));
  assert.ok(Math.abs(final.fraction - 0.4) < 0.005);
  assert.deepEqual(final.centers, centers);
  assert.deepEqual(final.contexts, { live: 1, created: 1 });
  await page.screenshot({ path: "/tmp/usa-map-swipe.png" });
  console.log("PASS four-pane swipe pixels, synchronized keyboard/drag, unchanged centers and one context");
}

if (process.argv[1]?.endsWith("webmap-canvas-browser.mjs")) await run();
