import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeBrowser } from "./native-browser.mjs";
import { applyComparisonStyle, comparisonStyles, base as devBase, itemIds } from "./webmap-canvas-browser.mjs";
import { measureAccuracy } from "./webmap-canvas-accuracy.mjs";

const base = process.env.COMPARISON_BASE ?? devBase;
const setupOnly = process.argv.includes("--setup");
const native = process.argv.includes("--native");
const fourOnly = process.argv.includes("--four-only");
if (!native) process.env.HEADLESS = "1";
const selectedIds = process.env.COMPARISON_LAYERS?.split(",") ?? itemIds;
const artifacts = mkdtempSync(join(tmpdir(), "usa-map-comparison-"));
console.log(`Artifacts: ${artifacts}`);
const browser = await launchNativeBrowser();
const runtimeMainFixture = process.env.COMPARISON_MAIN_RUNTIME === "1";
const results = { mode: native ? "native Chrome" : "headless Chrome", base, runtimeMainFixture,
  layers: selectedIds, scale: 24000000, loads: [], captures: [], errors: [] };

async function instrument(page) {
  await page.addInitScript(ids => { window.__webmapCanvasComparisonItems = ids; }, selectedIds);
  const cdp = await page.context().newCDPSession(page);
  let requests = new Map();
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  cdp.on("Network.requestWillBeSent", event => requests.set(event.requestId, { url: event.request.url, bytes: 0, cache: false }));
  cdp.on("Network.requestServedFromCache", event => { const request = requests.get(event.requestId); if (request) request.cache = true; });
  cdp.on("Network.responseReceived", event => { const request = requests.get(event.requestId); if (request) Object.assign(request,
    { status: event.response.status, cache: request.cache || event.response.fromDiskCache || event.response.fromServiceWorker || false }); });
  cdp.on("Network.loadingFinished", event => { const request = requests.get(event.requestId); if (request) request.bytes = event.encodedDataLength; });
  cdp.on("Network.loadingFailed", event => { const request = requests.get(event.requestId); if (request) request.failure = event.errorText; });
  cdp.on("Fetch.requestPaused", async event => {
    try {
      const index = itemIds.findIndex(id => event.request.url.includes(`/items/${id}/data`));
      if (index < 0 || event.responseStatusCode !== 200) { await cdp.send("Fetch.continueRequest", { requestId: event.requestId }); return; }
      const response = await cdp.send("Fetch.getResponseBody", { requestId: event.requestId });
      const json = JSON.parse(response.base64Encoded ? Buffer.from(response.body, "base64").toString() : response.body);
      await cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
        responseHeaders: (event.responseHeaders ?? []).filter(header => !["content-length", "content-encoding"].includes(header.name.toLowerCase())),
        body: Buffer.from(JSON.stringify(applyComparisonStyle(json, index))).toString("base64") });
    } catch (error) { results.errors.push(`Fixture interception: ${error.message}`); }
  });
  await cdp.send("Fetch.enable", { patterns: itemIds.map(id => ({ urlPattern: `*/items/${id}/data*`, requestStage: "Response" })) });
  return { cdp, reset: () => { requests = new Map(); }, snapshot: () => {
    const http = [...requests.values()].filter(request => /^https?:/.test(request.url));
    return { requests: http.length, bytes: http.reduce((sum, request) => sum + request.bytes, 0), cacheHits: http.filter(request => request.cache).length,
      failures: http.filter(request => request.failure || request.status >= 400), geometryRequests: http.filter(request => /\/query\?/.test(request.url)).length };
  } };
}

async function settle(page, kind) {
  await page.waitForFunction(kind => {
    if (kind === "prototype") return ["ready", "error"].includes(window.webmapCanvas?.status);
    const child = document.querySelector("#drawer-iframe")?.contentWindow;
    const views = [window.mainView, window.prView, ...(child?.drawerLifecycle?.views ?? [])];
    return views.length >= 6 && views.every(view => view?.ready && view.stationary && !view.updating);
  }, kind, { timeout: 240000 });
  if (kind === "prototype") {
    const state = await page.evaluate(() => ({ status: window.webmapCanvas.status,
      rendered: window.webmapCanvas.renderer?.layers.length, reports: window.webmapCanvas.reports }));
    assert.equal(state.status, "ready", JSON.stringify(state));
    assert.equal(state.rendered, selectedIds.length, JSON.stringify(state));
  }
}

async function configureMain(page) {
  await page.waitForFunction(() => window.mainView?.ready, null, { timeout: 120000 });
  await page.evaluate(async () => { await window.framingPreviewReady; });
  await page.locator("#pr-drawer-toggle").click();
  await page.evaluate(async () => { await window.viewsReady; });
  await page.locator("#drawer-toggle").click();
  await page.evaluate(async () => { await window.viewsReady; });
  if (runtimeMainFixture) await page.evaluate(async ({ ids, styles }) => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    const maps = new Set([window.mainView, window.prView, ...child.drawerLifecycle.views].map(view => view.map));
    for (const map of maps) {
      const layers = ids.map((id, index) => {
        const source = map.layers.find(layer => layer.portalItem?.id === id);
        if (!source) throw new Error(`Production fixture layer missing: ${id}`);
        const layer = source.clone();
        const symbol = styles[index];
        layer.renderer = { type: "simple", symbol: { type: "simple-fill", style: "solid", color: symbol.color,
          outline: { type: "simple-line", style: "solid", color: symbol.outline.color, width: symbol.outline.width } } };
        layer.blendMode = "normal";
        return layer;
      });
      const removed = map.layers.toArray();
      map.removeAll();
      map.addMany(layers);
      removed.forEach(layer => layer.destroy());
      await Promise.all(layers.map(layer => layer.load()));
    }
  }, { ids: selectedIds, styles: selectedIds.map(id => applyComparisonStyle({ layers: [{ layerDefinition: { drawingInfo: {} } }] },
    itemIds.indexOf(id)).layers[0].layerDefinition.drawingInfo.renderer.symbol) });
  await settle(page, "main");
  await alignMain(page);
}

async function alignMain(page) {
  await page.evaluate(async () => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    const centers = { conus: [-97, 38], ak: [-159, 62], hi: [-157, 20.7], pr: [-66.2, 18.2] };
    for (const view of [window.mainView, window.prView, ...child.drawerLifecycle.views]) {
      if (view.container.id === "overViewDiv") continue;
      view.scale = 24000000;
      view.rotation = 0;
      const pane = { mainViewDiv: "conus", akViewDiv: "ak", hiViewDiv: "hi", prViewDiv: "pr" }[view.container.id];
      if (!pane) continue;
      await view.goTo({ center: centers[pane], scale: 24000000, rotation: 0 }, { animate: false });
    }
  });
  await settle(page, "main");
}

async function panIntervals(page, kind) {
  return page.evaluate(kind => new Promise(resolve => {
    const intervals = [];
    const started = performance.now();
    let previous;
    const renderer = window.webmapCanvas?.renderer;
    const view = window.mainView;
    const tick = timestamp => {
      if (previous !== undefined) intervals.push(timestamp - previous);
      previous = timestamp;
      if (timestamp - started >= 5000) {
        const sorted = [...intervals].sort((first, second) => first - second);
        resolve({ duration: timestamp - started, frames: intervals.length, median: sorted[Math.floor(sorted.length / 2)],
          p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] });
        return;
      }
      if (kind === "prototype") renderer.pan("conus", 2, 0);
      else { const center = view.center.clone(); center.x -= view.resolution * 2; view.center = center; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), kind);
}

try {
  for (const kind of fourOnly ? [] : process.env.COMPARISON_KIND ? [process.env.COMPARISON_KIND] : ["main", "prototype"]) {
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    const network = await instrument(page);
    const url = projection => `${base}${kind === "prototype" ? `experiments/webmap-canvas/?layers=${selectedIds.join(",")}&` : "?"}projection=${projection}`;
    for (const cache of setupOnly || native ? ["cold"] : ["cold", "warm"]) {
      if (cache === "cold") await network.cdp.send("Network.clearBrowserCache");
      network.reset();
      await page.goto(url("lambert"));
      if (kind === "main") await configureMain(page);
      await settle(page, kind);
      const timing = await page.evaluate(kind => ({ firstCompleteMs: performance.now(), devicePixelRatio,
        contexts: kind === "prototype" ? window.getWebGLContextStats().live : window.getLiveWebGLContexts(),
        renderer: kind === "prototype" ? { layers: window.webmapCanvas.renderer.layers.length,
          timings: window.webmapCanvas.timings,
          symbolDraws: window.webmapCanvas.renderer.layers.reduce((sum, layer) => sum + layer.draws.length, 0),
          drawStats: window.webmapCanvas.renderer.drawStats,
          gpuGeometryBytes: window.webmapCanvas.renderer.layers.reduce((sum, layer) => {
            const gl = window.webmapCanvas.renderer.gl;
            gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
            return sum + gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
          }, 0),
          uploadBytes: window.webmapCanvas.renderer.layers.reduce((sum, layer) => sum + layer.bytes, 0),
          vertices: window.webmapCanvas.datasets.map(data => ({ item: data.layer.portalItem.id, count: data.count, vertices: data.vertices, pages: data.pages })) } : null }), kind);
      const load = { kind, cache, ...timing, network: network.snapshot() };
      if (!setupOnly && !native) {
        load.pan = await panIntervals(page, kind);
        const after = network.snapshot();
        load.panTransfer = { bytes: after.bytes - load.network.bytes, requests: after.requests - load.network.requests,
          queryRequests: after.geometryRequests - load.network.geometryRequests };
      }
      results.loads.push(load);
      console.log("LOAD", JSON.stringify(load));
    }
    if (native) for (const projection of ["lambert", "albers"]) {
      if (projection === "albers") { await page.goto(url(projection)); if (kind === "main") await configureMain(page); await settle(page, kind); }
      for (const size of [{ width: 1920, height: 1080 }, { width: 2560, height: 1600 }]) {
        await page.setViewportSize(size);
        if (kind === "main") { await page.evaluate(async () => { await window.updateMapViews({ reframe: true }); }); await alignMain(page); }
        else await page.evaluate(() => window.webmapCanvas.renderer.draw());
        await settle(page, kind);
        const state = await page.evaluate(kind => {
          if (kind === "prototype") return window.webmapCanvas.renderer.panes.map(pane => ({ id: pane.id, center: pane.center,
            scale: window.webmapCanvas.renderer.scale, width: pane.element.clientWidth, height: pane.element.clientHeight }));
          const child = document.querySelector("#drawer-iframe").contentWindow;
          return [window.mainView, window.prView, ...child.drawerLifecycle.views].map(view => ({ id: view.container.id,
            center: view.center.toJSON(), scale: view.scale, width: view.width, height: view.height,
            items: view.map.layers.map(layer => layer.portalItem?.id).toArray() }));
        }, kind);
        const file = `${kind}-${projection}-${size.width}x${size.height}.png`;
        await page.screenshot({ path: join(artifacts, file) });
        results.captures.push({ file, state });
      }
    }
    if (native && kind === "prototype") results.accuracy = await measureAccuracy(page);
    await page.close();
  }
  if (!setupOnly && !native && !process.argv.includes("--no-four")) {
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await comparisonStyles(page);
    await page.goto(`${base}experiments/webmap-canvas/four.html?layers=${selectedIds.join(",")}`);
    try {
      await page.waitForFunction(() => [...document.querySelectorAll("iframe")].length === 4
        && [...document.querySelectorAll("iframe")].every(frame => ["ready", "error"].includes(frame.contentWindow.webmapCanvas?.status)), null, { timeout: 120000 });
    } catch (error) { results.fourTimeout = error.message; }
    results.four = await page.evaluate(() => ({ cache: "disabled by Playwright routing", completeMs: performance.now(), children: [...document.querySelectorAll("iframe")].map(frame => ({
      status: frame.contentWindow.webmapCanvas?.status, rendered: frame.contentWindow.webmapCanvas?.renderer?.layers.length,
      reports: frame.contentWindow.webmapCanvas?.reports,
      contexts: frame.contentWindow.getWebGLContextStats?.(), firstRenderMs: frame.contentWindow.webmapCanvas?.firstRenderMs })) }));
    console.log("FOUR", JSON.stringify(results.four));
    assert.ok(results.four.children.every(child => child.status === "ready" && child.rendered === selectedIds.length && child.contexts.live === 1), JSON.stringify(results.four));
    await page.close();
  }
  if (results.accuracy) for (const row of results.accuracy.rows) assert.ok(row.maxPixels <= 1);
  assert.deepEqual(results.errors, []);
} finally {
  writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}