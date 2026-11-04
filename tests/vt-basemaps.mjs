import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { installWebGLProbe, measureWebGLContexts } from "./webgl-probe.mjs";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";
const artifacts = mkdtempSync(join(tmpdir(), "usa-vt-basemaps-"));
const webmap = "e46bd022bab240489506463e32fcc1bf";
const basemaps = `conus:${webmap},ak:74d4ae1d00664614b839d3aebc61a044,hi:99eafcf8471b47ad8a2784224a185d3d`;
const raw = await (await fetch(`https://www.arcgis.com/sharing/rest/content/items/${webmap}/data?f=json`)).json();
writeFileSync(join(artifacts, "webmap.json"), JSON.stringify(raw, null, 2));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
console.log(`Artifacts: ${artifacts}`);

async function settle(page) {
  await page.waitForFunction(() => window.testViews?.().every(view => view.ready && view.stationary && !view.updating
    && view.layerViews.length > 0), null, { timeout: 180000 });
  await page.waitForLoadState("networkidle");
}

async function snapshot(page) {
  const contexts = await measureWebGLContexts(page);
  return page.evaluate(({ live, reported }) => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    return { live, reported,
      views: window.testViews().map(view => ({ id: view.container.id, sr: view.spatialReference.toJSON(),
        center: view.center.toJSON(), scale: view.scale, resolution: view.resolution,
        width: view.width, height: view.height, basemap: view.map.basemap?.baseLayers.map(layer => ({ id: layer.id,
          visible: layer.visible, status: layer.loadStatus, sr: layer.tileInfo?.spatialReference.toJSON() })).toArray(),
        layers: view.map.layers.map(layer => ({ id: layer.id, visible: layer.visible, status: layer.loadStatus,
          parent: layer.parent === view.map, definitionExpression: layer.definitionExpression,
          renderer: layer.renderer?.toJSON(), type: layer.type })).toArray(),
      })), diagnostics: [window.mapSourceDiagnostics, child.mapSourceDiagnostics],
      distinctMaps: new Set(window.testViews().map(view => view.map)).size,
      distinctLayers: new Set(window.testViews().flatMap(view => view.map.layers.toArray())).size,
    };
  }, contexts);
}

try {
  for (const viewport of process.env.VT_EDGE_ONLY ? [] : [{ width: 1920, height: 1080 }, { width: 2560, height: 1600 }]) {
    let baseline;
    for (const mode of ["baseline", "tiles", "overview"]) {
      const label = `${viewport.width}x${viewport.height}-${mode}`;
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await context.addInitScript(installWebGLProbe);
      const page = await context.newPage();
      const requests = [];
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => {
        if (/\/tile\/\d+\/\d+\/\d+\.pbf/i.test(response.url())) requests.push({ url: response.url(), status: response.status() });
      });
      const params = new URLSearchParams({ projection: "albers", webmap });
      if (mode !== "baseline") params.set("basemaps", basemaps);
      if (mode === "overview") params.set("overviewBasemap", "conus");
      await page.goto(`${base}?${params}`);
      await page.waitForFunction(() => window.framingPreviewReady, null, { timeout: 180000 });
      await page.evaluate(async () => { await window.framingPreviewReady; });
      await page.locator("#drawer-toggle").click();
      await page.locator("#pr-drawer-toggle").click();
      await page.evaluate(async () => { await window.viewsReady; });
      await page.evaluate(() => {
        window.testViews = () => [window.mainView, window.prView, ...document.querySelector("#drawer-iframe").contentWindow.drawerLifecycle.views];
      });
      await settle(page);
      const initial = await snapshot(page);
      assert.equal(initial.views.length, 7);
      assert.equal(initial.distinctMaps, 7);
      assert.equal(initial.distinctLayers, raw.operationalLayers.length * 7);
      assert.equal(initial.live, initial.reported.live);
      assert.equal(initial.live, initial.views.length);
      for (const view of initial.views) {
        assert.deepEqual(view.layers.map(layer => layer.id), raw.operationalLayers.map(layer => layer.id));
        for (const layer of view.layers) {
          const original = raw.operationalLayers.find(source => source.id === layer.id);
          assert.equal(layer.visible, original.visibility ?? initial.views[0].layers.find(first => first.id === layer.id).visible);
          assert.equal(layer.parent, true);
          assert.equal(layer.status, "loaded");
          if (original.layerDefinition?.definitionExpression) assert.equal(layer.definitionExpression, original.layerDefinition.definitionExpression);
          if (original.layerDefinition?.drawingInfo?.renderer) {
            const renderer = original.layerDefinition.drawingInfo.renderer;
            assert.equal(layer.renderer.type, renderer.type);
            if (renderer.symbol) assert.deepEqual(layer.renderer.symbol, renderer.symbol);
          }
        }
      }
      if (mode === "baseline") baseline = initial;
      else {
        assert.equal(initial.live, baseline.live, "Basemaps must not add live contexts");
        for (const view of initial.views.filter(view => view.id !== "overViewDiv")) {
          assert.equal(view.scale, baseline.views.find(original => original.id === view.id).scale);
        }
        const expected = { mainViewDiv: 5070, akViewDiv: 3338, hiViewDiv: 102007 };
        if (mode === "overview") expected.overViewDiv = 5070;
        for (const [id, wkid] of Object.entries(expected)) {
          const view = initial.views.find(view => view.id === id);
          assert.equal(view.sr.latestWkid ?? view.sr.wkid, wkid);
          assert.ok(view.basemap.length);
        }
      }
      await page.screenshot({ path: join(artifacts, `${label}.png`) });
      const tileRequestsAtFit = requests.length;
      await page.getByRole("button", { name: "Operational layers", exact: true }).click();
      const toggle = page.locator('[data-layer-id="1a1a845d1d5-layer-341"] .esri-layer-list__visible-toggle');
      await toggle.waitFor({ state: "visible" });
      await page.screenshot({ path: join(artifacts, `${label}-layers.png`) });
      await toggle.click();
      await page.waitForFunction(() => window.testViews().every(view => !view.map.findLayerById("1a1a845d1d5-layer-341").visible));
      await toggle.click();
      await page.waitForFunction(() => window.testViews().every(view => view.map.findLayerById("1a1a845d1d5-layer-341").visible));
      const afterToggle = await snapshot(page);
      assert.equal(afterToggle.live, initial.live);
      await page.getByRole("button", { name: "Collapse", exact: true }).click();
      results.push({ label, initial, toggles: true, tileRequestsAtFit, requests, errors });
      writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ label, contexts: initial.live, tileRequestsAtFit, errors }));
      await context.close();
    }
  }
  const edgeContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  for (const [label, params, message] of [
    ["wrong-projection", "projection=albers&basemaps=conus:51c0a6ea859b406987e873e5c1a0915d", "unrecognized tile projection"],
    ["wrong-region", `projection=albers&basemaps=ak:${webmap}`, "does not match"],
    ["malformed", "projection=albers&webmap=bad", "32-character"],
  ]) {
    const page = await edgeContext.newPage();
    await page.goto(`${base}?${params}`);
    await page.waitForFunction(message => document.querySelector("#map-source-diagnostics")?.textContent.includes(message), message, { timeout: 180000 });
    assert.equal(await page.evaluate(() => Boolean(window.mainView)), false);
    await page.screenshot({ path: join(artifacts, `${label}.png`) });
    results.push({ label, refused: true });
    await page.close();
  }
  const lambert = await edgeContext.newPage();
  await lambert.goto(`${base}?projection=lambert&webmap=${webmap}&basemaps=invalid&overviewBasemap=conus`);
  await lambert.waitForFunction(() => window.framingPreviewReady, null, { timeout: 180000 });
  assert.match(await lambert.locator("#map-source-diagnostics").textContent(), /Basemaps ignored/);
  assert.equal(await lambert.evaluate(() => window.mainView.map.basemap), null);
  await lambert.evaluate(() => { window.mainView.map.findLayerById("1a1a845d1d5-layer-341").visible = false; });
  await lambert.locator("#drawer-toggle").click();
  await lambert.locator("#pr-drawer-toggle").click();
  await lambert.evaluate(async () => { await window.viewsReady; });
  assert.equal(await lambert.evaluate(() => [window.mainView, window.prView,
    ...document.querySelector("#drawer-iframe").contentWindow.drawerLifecycle.views]
    .every(view => !view.map.findLayerById("1a1a845d1d5-layer-341").visible)), true);
  await lambert.screenshot({ path: join(artifacts, "lambert-ignored-lazy-toggle.png") });
  results.push({ label: "lambert-ignored-lazy-toggle", passed: true });
  await lambert.close();
  const defaults = await edgeContext.newPage();
  await defaults.goto(base);
  await defaults.waitForFunction(() => window.framingPreviewReady, null, { timeout: 180000 });
  assert.equal(await defaults.evaluate(() => window.mainView.map.layers.length), 8);
  assert.equal(await defaults.locator(".esri-layer-list").count(), 0);
  results.push({ label: "no-url-defaults", passed: true });
  await edgeContext.close();
  console.log("Projection refusals, Lambert fallback, lazy layer visibility and default layers passed");
} finally {
  writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}