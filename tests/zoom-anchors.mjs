import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import defaults from "../src/view-defaults.js";
import { installWebGLProbe, measureWebGLContexts } from "./webgl-probe.mjs";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";
const anchors = {
  akViewDiv: defaults.alaska.zoomAnchor,
  hiViewDiv: defaults.hawaii.zoomAnchor,
  guViewDiv: defaults.guam.zoomAnchor,
  asViewDiv: defaults.americanSamoa.zoomAnchor,
  prViewDiv: defaults.puertoRico.zoomAnchor,
};
const sources = "&webmap=e46bd022bab240489506463e32fcc1bf&basemaps=conus:e46bd022bab240489506463e32fcc1bf,ak:74d4ae1d00664614b839d3aebc61a044,hi:99eafcf8471b47ad8a2784224a185d3d";
const cases = [
  ["lambert", "?projection=lambert"], ["albers", "?projection=albers"],
  ["lambert-globes", "?projection=lambert&overview=globes"], ["albers-globes", "?projection=albers&overview=globes"],
  ["tiles", `?projection=albers${sources}`], ["tiles-overview", `?projection=albers${sources}&overviewBasemap=conus`],
].filter(([name]) => !process.env.ZOOM_CASE || process.env.ZOOM_CASE === name);
const baselines = process.env.ZOOM_BASELINE ? JSON.parse(readFileSync(process.env.ZOOM_BASELINE)) : null;
const artifacts = mkdtempSync(join(tmpdir(), "usa-zoom-anchors-"));
const results = [];
console.log(`Artifacts: ${artifacts}`);
console.log(`Historical fit comparison: ${baselines ? process.env.ZOOM_BASELINE : "not requested (set ZOOM_BASELINE to an external matrix.json)"}`);
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function zoom(page, scale) {
  await page.evaluate(scale => { window.mainView.scale = scale; }, scale);
  await page.waitForFunction(scale => window.zoomViews().filter(view => view.container.id !== "overViewDiv")
    .every(view => view.ready && view.stationary && Math.abs(view.scale - scale) < 0.01), scale);
}

async function offsets(page, progress = 1, exclude = null) {
  const result = await page.evaluate(({ anchors, progress, exclude }) => window.zoomViews()
    .filter(view => anchors[view.container.id] && view.container.id !== exclude).map(view => {
      const airport = view.toScreen(new view.center.constructor({ ...window.zoomAirports[view.container.id], spatialReference: view.spatialReference }));
      const initial = window.zoomInitial.find(initial => initial.id === view.container.id);
      const home = view.toScreen(new view.center.constructor(initial.center));
      return { id: view.container.id, offset: Math.hypot(home.x + (airport.x - home.x) * progress - view.width / 2,
        home.y + (airport.y - home.y) * progress - view.height / 2) };
    }), { anchors, progress, exclude });
  for (const row of result) assert.ok(row.offset < 0.1, `${row.id}: expected center is ${row.offset.toFixed(2)}px away`);
  return result;
}

async function nativeCounts(page) {
  const result = await measureWebGLContexts(page);
  assert.equal(result.live, result.reported.live);
  return { live: result.live, created: result.reported.created };
}

try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1600 }]) {
    for (const [name, query] of cases) {
      const label = `${viewport.width}x${viewport.height}-${name}`;
      const context = await browser.newContext({ viewport });
      await context.addInitScript(installWebGLProbe);
      await context.addInitScript(() => {
        window.zoomLosses = [];
        document.addEventListener("webglcontextlost", event => window.zoomLosses.push(event.isTrusted), true);
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(base + query);
      await page.waitForFunction(() => window.framingPreviewReady, null, { timeout: 120000 });
      if (name === "albers" && viewport.width === 1920) {
        await page.evaluate(async () => { await window.framingPreviewReady; window.mainView.scale = 500000; });
        await page.locator("#pr-drawer-toggle").click();
        await page.evaluate(async () => { await window.viewsReady; });
        const lateOffset = await page.evaluate(anchor => {
          const view = window.prView;
          const target = view.toScreen(new view.center.constructor({ ...anchor, spatialReference: { wkid: 4326 } }));
          return Math.hypot(target.x - view.width / 2, target.y - view.height / 2);
        }, anchors.prViewDiv);
        assert.ok(lateOffset < 0.1, "A pane opened after deep zoom must start at its airport");
        await page.locator("#pr-drawer-toggle").click();
      }
      await page.locator("#drawer-toggle").click();
      await page.locator("#pr-drawer-toggle").click();
      await page.evaluate(async () => { await window.viewsReady; });
      await page.waitForFunction(() => [window.mainView, window.prView,
        ...document.querySelector("#drawer-iframe").contentWindow.drawerLifecycle.views]
        .every(view => view.ready && view.stationary && !view.updating), null, { timeout: 120000 });
      await page.waitForLoadState("networkidle");
      const initial = await page.evaluate(() => {
        window.zoomViews = () => [window.mainView, window.prView, ...document.querySelector("#drawer-iframe").contentWindow.drawerLifecycle.views];
        window.zoomOriginals = window.zoomViews();
        window.zoomInitial = window.zoomViews().map(view => ({ id: view.container.id, center: view.center.toJSON(), scale: view.scale }));
        return window.zoomInitial;
      });
      await page.evaluate(async anchors => {
        const source = await (await fetch(new URL("src/main.js", location.href))).text();
        const specifier = source.match(/import \* as projectOperator from "([^"]+)"/)[1];
        const operator = await import(specifier);
        window.zoomAirports = Object.fromEntries(window.zoomViews().filter(view => anchors[view.container.id]).map(view => [view.container.id,
          operator.execute(new window.mainView.center.constructor({ ...anchors[view.container.id], spatialReference: { wkid: 4326 } }),
            new window.mainView.spatialReference.constructor(view.spatialReference.toJSON())).toJSON()]));
      }, anchors);
      const counts = await nativeCounts(page);
      assert.equal(counts.live, initial.length, "Settled contexts must equal rendering views");
      if (baselines && ["albers", "tiles", "tiles-overview"].includes(name)) {
        const prior = baselines.find(record => record.label === `${viewport.width}x${viewport.height}-${name === "albers" ? "baseline" : name === "tiles" ? "tiles" : "overview"}`);
        for (const view of initial) {
          const original = prior.initial.views.find(original => original.id === view.id);
          assert.ok(Math.hypot(view.center.x - original.center.x, view.center.y - original.center.y) < 0.001, `${label}/${view.id}: initial framing changed`);
          assert.equal(view.scale, original.scale);
        }
      }
      const homeScale = initial[0].scale;
      await zoom(page, (homeScale + defaults.zoomAnchorScale) / 2);
      await offsets(page, 0.5);
      await zoom(page, defaults.zoomAnchorScale);
      const airportOffsets = await offsets(page);
      await page.waitForFunction(() => window.zoomViews().every(view => !view.updating), null, { timeout: 120000 });
      await page.screenshot({ path: join(artifacts, `${label}-airports.png`) });
      await zoom(page, 500000);
      await offsets(page);
      if (!name.startsWith("tiles")) {
        await page.mouse.move(viewport.width * 0.7, viewport.height * 0.35);
        await page.mouse.wheel(0, -280);
        await page.waitForFunction(() => window.mainView.scale < 500000 && window.mainView.stationary);
        await page.waitForFunction(() => window.zoomViews().filter(view => view.container.id !== "overViewDiv")
          .every(view => view.stationary && Math.abs(view.scale - window.mainView.scale) < 0.01));
        await offsets(page);
      }
      await zoom(page, homeScale);
      await offsets(page, 0);
      const overview = await page.evaluate(() => window.zoomViews().find(view => view.container.id === "overViewDiv")?.center.toJSON());
      if (overview) assert.deepEqual(overview, initial.find(view => view.id === "overViewDiv").center);
      await page.setViewportSize({ width: viewport.width - 80, height: viewport.height - 40 });
      await page.waitForFunction(() => window.zoomViews().every(view => view.width === view.container.clientWidth && view.height === view.container.clientHeight));
      await page.evaluate(async () => { (await window.framingPreviewReady).update(); });
      await page.waitForFunction(homeScale => window.zoomAnchorStates.get(window.mainView).homeScale !== homeScale, homeScale);
      await zoom(page, 500000);
      await offsets(page);
      await page.setViewportSize(viewport);
      await page.waitForFunction(() => window.zoomViews().every(view => view.width === view.container.clientWidth && view.height === view.container.clientHeight));
      await page.evaluate(async () => { (await window.framingPreviewReady).update(); });
      await page.waitForFunction(homeScale => Math.abs(window.mainView.scale - homeScale) < 0.01, homeScale);
      await offsets(page, 0);
      await zoom(page, 1000000);
      const hawaii = page.frameLocator("#drawer-iframe").locator("#hiViewDiv");
      const bounds = await hawaii.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2 + 35, bounds.y + bounds.height / 2 - 20, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => {
        const child = document.querySelector("#drawer-iframe").contentWindow;
        const view = child.drawerLifecycle.views.find(view => view.container.id === "hiViewDiv");
        return view.stationary && child.zoomAnchorStates.get(view).manualCenter && !child.zoomAnchorStates.get(view).panning;
      });
      const manual = await page.evaluate(() => window.zoomViews().find(view => view.container.id === "hiViewDiv").center.toJSON());
      await zoom(page, 500000);
      const manualError = await page.evaluate(manual => {
        const view = window.zoomViews().find(view => view.container.id === "hiViewDiv");
        return Math.hypot(view.center.x - manual.x, view.center.y - manual.y) / view.resolution;
      }, manual);
      assert.ok(manualError < 0.1, `${label}: manual pan was overridden`);
      await offsets(page, 1, "hiViewDiv");
      if (name.includes("globes")) {
        await hawaii.locator(".inset-recenter").click();
        await page.waitForFunction(() => window.zoomViews().every(view => view.stationary));
        await offsets(page);
      }
      assert.deepEqual(await nativeCounts(page), counts, `${label}: navigation allocated contexts`);
      assert.equal(await page.evaluate(() => window.zoomViews().every((view, index) => view === window.zoomOriginals[index])), true);
      if (name === "tiles-overview" && viewport.width === 1920) {
        await page.evaluate(() => {
          const child = document.querySelector("#drawer-iframe").contentWindow;
          const view = child.akView;
          window.zoomRecovery = window.zoomViews().map(view => ({ center: view.center.toJSON(), scale: view.scale }));
          const context = [...view.container.querySelectorAll("canvas")].map(canvas => child.webglProbe.canvasContexts.get(canvas)?.deref())
            .find(context => context && !context.isContextLost());
          context.getExtension("WEBGL_lose_context").loseContext();
        });
        await page.waitForFunction(() => document.querySelector("#drawer-iframe").contentWindow.zoomLosses.includes(true));
        await page.evaluate(() => {
          const child = document.querySelector("#drawer-iframe").contentWindow;
          child.document.dispatchEvent(new child.Event("visibilitychange"));
        });
        await page.waitForFunction(() => window.zoomViews().length === window.zoomOriginals.length
          && window.zoomViews()[2] !== window.zoomOriginals[2] && window.zoomViews().every(view => view.ready && view.stationary));
        assert.ok(await page.evaluate(() => window.zoomViews().every((view, index) => {
          const original = window.zoomRecovery[index];
          return Math.hypot(view.center.x - original.center.x, view.center.y - original.center.y) < 0.001
            && Math.abs(view.scale - original.scale) < 0.01;
        })), "Recovery changed saved navigation");
        await zoom(page, (homeScale + defaults.zoomAnchorScale) / 2);
        await offsets(page, 0.5, "hiViewDiv");
        await zoom(page, 500000);
        await offsets(page, 1, "hiViewDiv");
        assert.equal((await nativeCounts(page)).live, counts.live);
      }
      assert.deepEqual(errors, []);
      const result = { label, initial, airportOffsets, manualError, counts,
        wheel: name.startsWith("tiles") ? "excluded: unchanged with anchor watcher disabled" : "passed",
        recovery: name === "tiles-overview" && viewport.width === 1920 };
      results.push(result);
      writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
      console.log(`PASS ${label}: framing, interpolation, airport zoom, manual pan, resize${result.recovery ? ", recovery" : ""}; wheel ${result.wheel}`);
      await context.close();
    }
  }
} finally {
  writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
