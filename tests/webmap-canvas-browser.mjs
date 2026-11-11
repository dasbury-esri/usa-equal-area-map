import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    if (process.argv.includes("--stroke-performance")) {
      assert.ok(process.env.CANVAS_BASELINE_URL, "Set CANVAS_BASELINE_URL to an isolated committed renderer server");
      const artifacts = mkdtempSync(join(tmpdir(), "usa-canvas-stroke-performance-"));
      await verifyStrokePerformance(browser, artifacts);
      console.log(`Stroke performance evidence: ${artifacts}`);
      return;
    }
    if (process.argv.includes("--stroke-fidelity")) {
      const artifacts = mkdtempSync(join(tmpdir(), "usa-canvas-strokes-"));
      for (const ratio of [1, 2]) {
        const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: ratio });
        await verifyStrokeFidelity(page, artifacts, ratio);
        await page.close();
      }
      console.log(`Stroke evidence: ${artifacts}`);
      return;
    }
    if (process.argv.includes("--city-symbols")) {
      const artifacts = mkdtempSync(join(tmpdir(), "usa-canvas-city-symbols-"));
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const previews = await verifyCitySymbols(page, artifacts);
      await verifyCitySymbolReference(browser, previews, artifacts);
      console.log(`City-symbol evidence: ${artifacts}`);
      return;
    }
    if (process.argv.includes("--main-layout")) {
      const artifacts = mkdtempSync(join(tmpdir(), "usa-canvas-layout-"));
      for (const projection of ["lambert", "albers"]) {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        await verifyMainLayout(page, projection, artifacts);
        await page.close();
      }
      console.log(`Layout evidence: ${artifacts}`);
      return;
    }
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
      await captureAreaBaseline(page);
      await verifyQuantization(page);
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

async function verifyStrokePerformance(browser, artifacts) {
  const results = [];
  const regressions = [];
  console.log(`Stroke performance evidence: ${artifacts}`);
  for (const viewport of [{ width: 1920, height: 1080, ratio: 1 }, { width: 2560, height: 1600, ratio: 2 }, { width: 390, height: 844, ratio: 2 }]) {
    for (const kind of ["baseline", "candidate", "candidate", "baseline"]) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.ratio });
      await page.addInitScript(() => {
        const textures = new WeakMap(), allocations = new Map(), contexts = new WeakSet();
        let nextTexture = 0;
        window.strokeMetrics = { contexts: 0, allocations };
        for (const prototype of [HTMLCanvasElement.prototype, globalThis.OffscreenCanvas?.prototype].filter(Boolean)) {
          const original = prototype.getContext;
          prototype.getContext = function(type, ...args) {
            const context = original.call(this, type, ...args);
            if (["webgl", "webgl2", "experimental-webgl"].includes(type) && context && !contexts.has(context)) {
              contexts.add(context); window.strokeMetrics.contexts++;
            }
            return context;
          };
        }
        const original = WebGL2RenderingContext.prototype.texImage2D;
        WebGL2RenderingContext.prototype.texImage2D = function(...args) {
          if (args.length === 9 && [this.R8, this.RGBA8].includes(args[2])) {
            const texture = this.getParameter(this.TEXTURE_BINDING_2D);
            if (!textures.has(texture)) textures.set(texture, ++nextTexture);
            allocations.set(textures.get(texture), { format: args[2], width: args[3], height: args[4], bytes: args[3] * args[4] * (args[2] === this.R8 ? 1 : 4) });
          }
          return original.apply(this, args);
        };
      });
      const url = kind === "baseline" ? process.env.CANVAS_BASELINE_URL : base;
      await page.goto(`${url}experiments/webmap-canvas/?layout=main&projection=albers&webmap=e46bd022bab240489506463e32fcc1bf`);
      await page.waitForFunction(() => window.webmapCanvas?.status === "ready", null, { timeout: 180000 });
      await page.locator("#regional-drawer-toggle").click();
      if (viewport.width >= 700) await page.locator("#pr-drawer-toggle").click();
      await page.waitForFunction(() => !window.webmapCanvas.refreshing && window.webmapCanvas.refreshCount > 0, null, { timeout: 180000 });
      const result = await page.evaluate(async () => {
        const renderer = window.webmapCanvas.renderer, gl = renderer.gl;
        renderer.onNavigate = undefined;
        const bytes = new TextEncoder().encode(JSON.stringify(window.webmapCanvas.datasets.map(dataset => ({ title: dataset.title,
          features: dataset.features.map(feature => ({ attributes: feature.attributes, geometry: feature.geometry.toJSON() })) }))));
        const geometrySHA256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        const center = [...renderer.panes[0].center], resolution = renderer.resolution();
        const draw = [], intervals = [];
        let previous;
        for (let frame = 0; frame < 150; frame++) {
          const timestamp = await new Promise(resolve => requestAnimationFrame(resolve));
          renderer.panes[0].center = [center[0] + Math.sin(frame / 30) * 80 * resolution, center[1]];
          const started = performance.now(); renderer.draw(); gl.finish();
          if (frame >= 30) {
            draw.push(performance.now() - started);
            intervals.push(timestamp - previous);
          }
          previous = timestamp;
        }
        renderer.panes[0].center = center; renderer.draw();
        const statistics = values => {
          const sorted = values.slice().sort((first, second) => first - second);
          return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
        };
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        return { geometrySHA256, contexts: window.strokeMetrics.contexts, live: window.getWebGLContextStats(), error: gl.getError(),
          browser: navigator.userAgent, gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          drawMs: statistics(draw), intervalMs: statistics(intervals),
          samples: { draw, intervals },
          strokeAllocations: [...window.strokeMetrics.allocations.values()].filter(allocation => allocation.format === gl.R8),
          declaredBytes: renderer.strokeTarget?.bytes ?? 0 };
      });
      results.push({ kind, viewport, ...result });
      writeFileSync(join(artifacts, "performance.json"), JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ kind, viewport, ...result, samples: undefined }));
      assert.equal(result.contexts, 1);
      assert.equal(result.live.live, 1);
      assert.equal(result.error, 0);
      if (kind === "candidate") {
        assert.equal(result.strokeAllocations.length, 1);
        assert.equal(result.strokeAllocations[0].bytes, viewport.width * viewport.height * viewport.ratio ** 2);
        assert.equal(result.declaredBytes, result.strokeAllocations[0].bytes);
        await page.screenshot({ path: join(artifacts, `${viewport.width}-${viewport.ratio}-${results.length}.png`) });
        await page.evaluate(() => {
          const target = window.webmapCanvas.renderer.strokeTarget;
          window.originalStrokeObjects = { texture: target.texture, framebuffer: target.framebuffer };
        });
        const resized = { width: Math.floor(viewport.width / 2), height: Math.floor(viewport.height / 2) };
        await page.setViewportSize(resized);
        await page.waitForFunction(({ width, height }) => {
          const target = window.webmapCanvas.renderer.strokeTarget;
          return target.width === width * devicePixelRatio && target.height === height * devicePixelRatio;
        }, resized);
        const reuse = await page.evaluate(() => {
          const renderer = window.webmapCanvas.renderer, target = renderer.strokeTarget;
          return { sameTexture: target.texture === window.originalStrokeObjects.texture,
            sameFramebuffer: target.framebuffer === window.originalStrokeObjects.framebuffer,
            allocations: [...window.strokeMetrics.allocations.values()].filter(allocation => allocation.format === renderer.gl.R8),
            contexts: window.strokeMetrics.contexts, error: renderer.gl.getError() };
        });
        results.at(-1).resize = reuse;
        writeFileSync(join(artifacts, "performance.json"), JSON.stringify(results, null, 2));
        assert.ok(reuse.sameTexture && reuse.sameFramebuffer);
        assert.equal(reuse.allocations.length, 1);
        assert.equal(reuse.allocations[0].bytes, resized.width * resized.height * viewport.ratio ** 2);
        assert.equal(reuse.contexts, 1);
        assert.equal(reuse.error, 0);
      }
      await page.close();
    }
    const group = results.slice(-4);
    assert.equal(new Set(group.map(row => row.geometrySHA256)).size, 1, "Benchmark geometry differs");
    const average = (kind, metric, statistic) => group.filter(row => row.kind === kind).reduce((sum, row) => sum + row[metric][statistic], 0) / 2;
    for (const metric of ["drawMs", "intervalMs"]) {
      if (average("candidate", metric, "median") > average("baseline", metric, "median") * 1.2 + 1)
        regressions.push({ viewport, metric, statistic: "median", baseline: average("baseline", metric, "median"), candidate: average("candidate", metric, "median") });
      if (average("candidate", metric, "p95") > average("baseline", metric, "p95") * 1.25 + 2)
        regressions.push({ viewport, metric, statistic: "p95", baseline: average("baseline", metric, "p95"), candidate: average("candidate", metric, "p95") });
    }
  }
  writeFileSync(join(artifacts, "regressions.json"), JSON.stringify(regressions, null, 2));
  assert.deepEqual(regressions, [], "Border buffer failed performance acceptance");
}

async function verifyStrokeFidelity(page, artifacts, ratio) {
  await page.goto(`${base}experiments/webmap-canvas/?panes=conus&prepare=inline&scale=1000000`);
  await page.waitForFunction(() => window.webmapCanvas?.status === "waiting");
  const rows = await page.evaluate(async () => {
    const { CanvasRenderer } = await import("/usa-equal-area-map/experiments/webmap-canvas/renderer.js");
    const renderer = new CanvasRenderer(document.querySelector("#map-canvas"), window.webmapCanvas.options, () => {});
    const pane = renderer.panes[0], gl = renderer.gl;
    Object.assign(pane.element.style, { position: "fixed", inset: "0", border: "0", width: "512px", height: "512px" });
    const center = [...pane.center], resolution = renderer.resolution();
    const rows = [];
    for (const blendMode of ["normal", "multiply"]) for (const alpha of [1, 0.5])
      for (const width of [0.25, 0.5, 1]) for (const split of [false, true]) {
      const vertices = (split ? [-60, 0, 60] : [-60, 60]).map(offset => pane.parameters.converter.inverse([center[0] + offset * resolution, center[1]]));
      const stroke = { type: "simple-line", style: "solid", color: [0, 0, 0, alpha], width };
      const polygon = [...vertices, ...[60, -60].map(offset => pane.parameters.converter.inverse([center[0] + offset * resolution, center[1] - 50 * resolution])), vertices[0]];
      const geometry = blendMode === "multiply" ? { type: "polygon", rings: [polygon] } : { type: "polyline", paths: [vertices] };
      const symbol = blendMode === "multiply" ? { type: "simple-fill", style: "none", outline: stroke } : stroke;
      await renderer.load([{ id: "stroke-probe", visible: true, opacity: 1, blendMode, ranges: [],
        renderer: { symbolFor: () => symbol },
        features: [{ attributes: {}, geometry }, { attributes: {}, geometry }] }]);
      for (const phase of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
        pane.center = [center[0], center[1] + phase * resolution];
        renderer.draw();
        const ratio = devicePixelRatio, pixels = new Uint8Array(32 * ratio * 16 * ratio * 4);
        gl.readPixels(240 * ratio, 248 * ratio, 32 * ratio, 16 * ratio, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const background = pixels[0];
        const columns = [];
        for (let column = 0; column < 32 * ratio; column++) {
          let ink = 0;
          for (let row = 0; row < 16 * ratio; row++) ink += (background - pixels[(row * 32 * ratio + column) * 4]) / background;
          columns.push(ink);
        }
        rows.push({ width, split, phase, blendMode, alpha, expected: width * 96 / 72 * ratio * alpha,
          minimum: Math.min(...columns), maximum: Math.max(...columns), mean: columns.reduce((sum, ink) => sum + ink, 0) / columns.length,
          error: gl.getError() });
      }
    }
    return rows;
  });
  writeFileSync(join(artifacts, `strokes-dpr${ratio}.json`), JSON.stringify(rows, null, 2));
  console.log(`Stroke DPR ${ratio}: ${artifacts}`, JSON.stringify({ cases: rows.length,
    maximumRelativeMeanError: Math.max(...rows.map(row => Math.abs(row.mean - row.expected) / row.expected)),
    minimumCoverageRatio: Math.min(...rows.map(row => row.minimum / row.expected)) }));
  for (const row of rows) {
    assert.equal(row.error, 0);
    assert.ok(Math.abs(row.mean - row.expected) <= 0.15 * row.expected + 0.02, `Stroke coverage varies with pixel position: ${JSON.stringify(row)}`);
    assert.ok(row.minimum >= 0.75 * row.expected, `Stroke has a gap: ${JSON.stringify(row)}`);
  }
}

export async function verifyCitySymbols(page, artifacts) {
  await page.addInitScript(() => {
    const known = new WeakSet();
    window.symbolContextCount = 0;
    for (const prototype of [HTMLCanvasElement.prototype, globalThis.OffscreenCanvas?.prototype].filter(Boolean)) {
      const original = prototype.getContext;
      prototype.getContext = function(type, ...args) {
        const context = original.call(this, type, ...args);
        if (["webgl", "webgl2", "experimental-webgl"].includes(type) && context && !known.has(context)) {
          known.add(context); window.symbolContextCount++;
        }
        return context;
      };
    }
  });
  await page.goto(`${base}experiments/webmap-canvas/?layout=main&projection=albers&webmap=e46bd022bab240489506463e32fcc1bf`);
  await page.waitForFunction(() => ["ready", "error"].includes(window.webmapCanvas?.status), null, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.webmapCanvas.status), "ready");
  const result = await page.evaluate(async () => {
    const before = window.symbolContextCount;
    const root = new URL("../../node_modules/@arcgis/core/", location.href);
    const { renderPreviewHTML } = await import(new URL("symbols/support/symbolUtils.js", root).href);
    const { fromJSON } = await import(new URL("symbols/support/jsonUtils.js", root).href);
    const layers = window.webmapCanvas.sources.layers.filter(layer => layer.renderer?.symbol?.type === "cim");
    const rows = [];
    for (const [index, layer] of layers.entries()) {
      const source = layer.renderer.symbol.toJSON();
      const element = await renderPreviewHTML(fromJSON(source), { scale: false });
      if (!element) throw new Error(`No preview for ${layer.title}`);
      element.id = `city-symbol-${index}`;
      Object.assign(element.style, { position: "fixed", left: `${40 + index * 160}px`, top: "100px", zIndex: "1000", background: "white" });
      document.body.append(element);
      let canvas = element instanceof HTMLCanvasElement ? element : element.querySelector("canvas");
      if (element instanceof HTMLImageElement) {
        await element.decode();
        canvas = document.createElement("canvas");
        canvas.width = element.naturalWidth;
        canvas.height = element.naturalHeight;
        canvas.getContext("2d").drawImage(element, 0, 0);
      }
      if (!canvas) throw new Error(`Unsupported preview element: ${element.outerHTML}`);
      const context = canvas.getContext("2d");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonblank = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset]) nonblank++;
      rows.push({ title: layer.title, renderer: layer.renderer.type, source, width: canvas.width, height: canvas.height,
        cssWidth: element.getBoundingClientRect().width, cssHeight: element.getBoundingClientRect().height, nonblank,
        png: canvas.toDataURL("image/png") });
    }
    return { before, after: window.symbolContextCount, contexts: window.getWebGLContextStats(), rows };
  });
  writeFileSync(join(artifacts, "preview-results.json"), JSON.stringify(result, null, 2));
  await page.screenshot({ path: join(artifacts, "previews.png") });
  console.log(JSON.stringify({ ...result, rows: result.rows.map(row => ({ title: row.title, renderer: row.renderer,
    width: row.width, height: row.height, cssWidth: row.cssWidth, cssHeight: row.cssHeight, nonblank: row.nonblank })) }, null, 2));
  assert.equal(result.before, 1);
  assert.equal(result.after, 1, "Symbol previews created another WebGL context");
  assert.equal(result.contexts.live, 1);
  assert.equal(result.rows.length, 2, "Expected both owner-map city symbols");
  for (const row of result.rows) assert.ok(row.nonblank > 0, `${row.title} preview is blank`);
  return result;
}

async function verifyCitySymbolReference(browser, previews, artifacts) {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page.goto(`${base}experiments/webmap-canvas/`);
  const references = await page.evaluate(async rows => {
    const root = new URL("../../node_modules/@arcgis/core/", location.href);
    const load = async path => (await import(new URL(path, root).href)).default;
    const [Map, MapView, Graphic, GraphicsLayer] = await Promise.all([
      "Map.js", "views/MapView.js", "Graphic.js", "layers/GraphicsLayer.js",
    ].map(load));
    const { fromJSON } = await import(new URL("symbols/support/jsonUtils.js", root).href);
    const host = document.createElement("div");
    Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "2000" });
    document.body.append(host);
    const layer = new GraphicsLayer();
    const view = new MapView({ container: host, map: new Map({ basemap: null, layers: [layer] }),
      center: [0, 0], scale: 1000000, spatialReference: { wkid: 3857 },
      constraints: { snapToZoom: false }, ui: { components: [] }, background: { color: "white" } });
    await view.when();
    const { whenOnce } = await import(new URL("core/reactiveUtils.js", root).href);
    const results = [];
    const measure = pixels => {
      let darkness = 0;
      const bounds = [32, 32, -1, -1];
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const weight = (765 - pixels[offset] - pixels[offset + 1] - pixels[offset + 2]) / 765;
        darkness += weight;
        if (weight > 0.02) {
          const x = offset / 4 % 32, y = Math.floor(offset / 4 / 32);
          bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
          bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
        }
      }
      return { darkness, bounds };
    };
    for (const row of rows) {
      layer.removeAll();
      layer.add(new Graphic({ geometry: { type: "point", x: 0, y: 0, spatialReference: { wkid: 3857 } }, symbol: fromJSON(row.source) }));
      await whenOnce(() => !view.updating);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const screenshot = await view.takeScreenshot({ width: 256, height: 256 });
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d");
      const image = new Image(); image.src = screenshot.dataUrl; await image.decode();
      context.drawImage(image, 112, 112, 32, 32, 0, 0, 32, 32);
      const nativePixels = context.getImageData(0, 0, 32, 32).data;
      const native = { ...measure(nativePixels), png: canvas.toDataURL() };
      const preview = new Image(); preview.src = row.png; await preview.decode();
      const candidates = [];
      for (const [mode, width, height, offset] of [["html-size", row.cssWidth, row.cssHeight, 0],
        ["natural-size", row.width, row.height, 0], ["padded-origin", row.width, row.height, -0.5]]) {
        context.fillStyle = "white"; context.fillRect(0, 0, 32, 32);
        context.drawImage(preview, 16 - width / 2 + offset, 16 - height / 2 + offset, width, height);
        const pixels = context.getImageData(0, 0, 32, 32).data;
        let difference = 0;
        for (let offset = 0; offset < pixels.length; offset++) if (offset % 4 !== 3) difference += Math.abs(pixels[offset] - nativePixels[offset]);
        candidates.push({ mode, offset, ...measure(pixels), difference, png: canvas.toDataURL() });
      }
      results.push({ title: row.title, native, candidates });
    }
    view.destroy();
    return results;
  }, previews.rows);
  writeFileSync(join(artifacts, "native-comparison.json"), JSON.stringify(references, null, 2));
  for (const [index, row] of references.entries()) {
    assert.ok(row.native.darkness > 0, "Native reference marker is blank");
    writeFileSync(join(artifacts, `native-${index}.png`), Buffer.from(row.native.png.split(",")[1], "base64"));
    for (const candidate of row.candidates) {
      writeFileSync(join(artifacts, `${candidate.mode}-${index}.png`), Buffer.from(candidate.png.split(",")[1], "base64"));
    }
  }
  console.log(JSON.stringify(references.map(row => ({ title: row.title, native: { ...row.native, png: undefined },
    candidates: row.candidates.map(candidate => ({ ...candidate, png: undefined })) })), null, 2));
  await page.close();
}

export async function verifyMainLayout(page, projection, artifacts) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const known = new WeakSet();
    window.layoutContextCount = 0;
    for (const prototype of [HTMLCanvasElement.prototype, globalThis.OffscreenCanvas?.prototype].filter(Boolean)) {
      const original = prototype.getContext;
      prototype.getContext = function(type, ...args) {
        const context = original.call(this, type, ...args);
        if (["webgl", "webgl2", "experimental-webgl"].includes(type) && context && !known.has(context)) {
          known.add(context); window.layoutContextCount++;
        }
        return context;
      };
    }
  });
  await page.goto(`${base}experiments/webmap-canvas/?layout=main&projection=${projection}&webmap=e46bd022bab240489506463e32fcc1bf`);
  await page.waitForFunction(() => ["ready", "error"].includes(window.webmapCanvas?.status), null, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.webmapCanvas.status), "ready");
  const navigation = () => page.evaluate(() => ({ scale: window.webmapCanvas.renderer.scale,
    center: [...window.webmapCanvas.renderer.panes[0].center] }));
  const closed = await navigation();
  await page.locator("#pr-drawer-toggle").click();
  assert.deepEqual(await navigation(), closed, "PR opening must not reframe CONUS");
  await page.locator("#pr-drawer-toggle").click();
  assert.deepEqual(await navigation(), closed, "PR closure must not reframe CONUS");
  await page.locator("#regional-drawer-toggle").click();
  await page.locator("#pr-drawer-toggle").click();
  await page.waitForFunction(() => !window.webmapCanvas.refreshing && window.webmapCanvas.refreshCount > 0, null, { timeout: 180000 });
  await page.locator("#diagnostics details").evaluate(element => { element.open = false; });
  await page.evaluate(() => { window.webmapCanvas.renderer.onNavigate = undefined; });
  const rows = [];
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const row = await page.evaluate(() => {
      const renderer = window.webmapCanvas.renderer;
      renderer.draw();
      const gl = renderer.gl;
      const panes = renderer.panes.map(pane => {
        if (pane.element.closest("[inert]")) return { id: pane.id, hidden: true };
        const bounds = pane.element.getBoundingClientRect();
        const width = Math.round(pane.element.clientWidth * devicePixelRatio);
        const height = Math.round(pane.element.clientHeight * devicePixelRatio);
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(Math.round((bounds.left + pane.element.clientLeft) * devicePixelRatio),
          gl.drawingBufferHeight - Math.round((bounds.top + pane.element.clientTop) * devicePixelRatio) - height,
          width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let changed = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (Math.abs(pixels[index] - 237) > 3 || Math.abs(pixels[index + 1] - 244) > 3) changed++;
        }
        const title = pane.element.querySelector("h2").getBoundingClientRect();
        const button = pane.element.querySelector("button").getBoundingClientRect();
        return { id: pane.id, width: pane.element.clientWidth, height: pane.element.clientHeight, changed,
          controlsFit: pane.id === "overview" || (button.left >= bounds.left && button.right <= bounds.right
            && (pane.id === "conus" || title.right <= button.left)), center: [...pane.center], scale: pane.scale ?? renderer.scale };
      });
      return { viewport: { width: innerWidth, height: innerHeight }, panes, contexts: window.getWebGLContextStats(),
        independentlyCreated: window.layoutContextCount, error: gl.getError(), overflow: document.documentElement.scrollWidth > innerWidth,
        rendered: renderer.layers.length };
    });
    assert.deepEqual(row.contexts, { live: 1, created: 1 });
    assert.equal(row.independentlyCreated, 1);
    assert.equal(row.error, 0);
    assert.equal(row.overflow, false);
    assert.equal(row.rendered, 4);
    for (const pane of row.panes) {
      if (pane.hidden) { assert.ok(viewport.width < 700); continue; }
      assert.ok(pane.controlsFit, `${projection}/${viewport.width}/${pane.id}: control overlap`);
      if (viewport.width >= 1920 || ["conus", "overview"].includes(pane.id)) {
        assert.ok(pane.changed > 3, `${projection}/${viewport.width}/${pane.id}: blank pane`);
      }
    }
    if (projection === "albers" && viewport.width === 1920) {
      assert.ok(Math.abs(row.panes[0].scale - 17444538.24388772) < 0.01, "Published main shared-scale reference");
      assert.ok(Math.abs(row.panes.find(pane => pane.id === "overview").scale - 81057512.0815336) < 0.01, "Published main overview-scale reference");
    }
    rows.push(row);
    await page.screenshot({ path: join(artifacts, `${projection}-${viewport.width}.png`) });
    if (viewport.width < 700) {
      const handles = await page.locator(".drawer-toggle").evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      }));
      assert.ok(handles[0].right <= handles[1].left || handles[1].right <= handles[0].left
        || handles[0].bottom <= handles[1].top || handles[1].bottom <= handles[0].top, "Mobile drawer handles overlap");
      await page.locator("#pr-drawer-toggle").click();
      assert.equal(await page.locator("#regional-drawer-toggle").getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator("#pr-drawer-toggle").getAttribute("aria-expanded"), "true");
      await page.locator("#regional-drawer-toggle").click();
      assert.equal(await page.locator("#pr-drawer-toggle").getAttribute("aria-expanded"), "false");
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const checks = await page.evaluate(() => {
    const renderer = window.webmapCanvas.renderer;
    const context = renderer.gl;
    const overview = renderer.panes.find(pane => pane.id === "overview");
    const originalOverview = { center: [...overview.center], scale: overview.scale };
    renderer.zoom(renderer.panes[0], 500000 / renderer.scale, innerWidth / 2, innerHeight / 2);
    const errors = renderer.panes.filter(pane => pane.airport).map(pane => Math.hypot(pane.center[0] - pane.airport[0], pane.center[1] - pane.airport[1]));
    renderer.pan("hi", 30, -20);
    const hawaii = renderer.panes.find(pane => pane.id === "hi");
    const manual = [...hawaii.center];
    renderer.zoom(renderer.panes[0], 2, innerWidth / 2, innerHeight / 2);
    const manualRetained = manual.every((value, index) => value === hawaii.center[index]);
    hawaii.element.querySelector("button").click();
    const recenterError = Math.hypot(hawaii.center[0] - hawaii.airport[0], hawaii.center[1] - hawaii.airport[1]);
    for (let index = 0; index < 4; index++) {
      document.querySelector("#regional-drawer-toggle").click();
      document.querySelector("#pr-drawer-toggle").click();
    }
    return { errors, manualRetained, recenterError, contextRetained: renderer.gl === context,
      overviewRetained: JSON.stringify(originalOverview) === JSON.stringify({ center: overview.center, scale: overview.scale }),
      contexts: window.getWebGLContextStats(), independentlyCreated: window.layoutContextCount };
  });
  assert.ok(checks.errors.every(error => error < 1e-6));
  assert.equal(checks.manualRetained, true);
  assert.ok(checks.recenterError < 1e-6);
  assert.equal(checks.contextRetained, true);
  assert.equal(checks.overviewRetained, true);
  assert.deepEqual(checks.contexts, { live: 1, created: 1 });
  assert.equal(checks.independentlyCreated, 1);
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, `${projection}-results.json`), JSON.stringify({ rows, checks }, null, 2));
  console.log(`PASS ${projection}: drawer states, desktop/mobile pixels, framing, airport zoom, manual pan, one retained context`);
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
