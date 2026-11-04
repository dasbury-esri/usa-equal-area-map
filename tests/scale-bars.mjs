import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeBrowser } from "./native-browser.mjs";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";
const focusGlobes = process.env.SCALE_BAR_FOCUS === "globes";
const focusAlaska = process.env.SCALE_BAR_FOCUS === "alaska";
const capture = process.env.CAPTURE_SCALE_BASELINE;
const baseline = process.env.SCALE_BASELINE
  ? JSON.parse(readFileSync(process.env.SCALE_BASELINE, "utf8")) : null;
const sizes = focusAlaska ? [[1920, 1080], [2560, 1600]] : focusGlobes ? [[1280, 800], [1920, 1080]] : [[1280, 720], [1920, 1080], [2560, 1440], [1280, 800], [1920, 1200],
  [2560, 1600], [2520, 1080], [3360, 1440], [2560, 1080], [3440, 1440]];
const artifacts = mkdtempSync(join(tmpdir(), "usa-map-scale-bars-"));
const samples = {};
const framing = {};
const browser = await launchNativeBrowser();
console.log(`Artifacts: ${artifacts}`);

async function settled(page) {
  await page.waitForFunction(() => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    const views = [window.mainView, window.prView, ...(child.drawerLifecycle?.views ?? [])];
    return views.length >= 6 && views.every(view => view?.ready && view.stationary
      && !view.updating && view.container.querySelectorAll(".esri-scale-bar__label").length === 2);
  }, null, { timeout: 90000 });
}

async function measure(page) {
  return page.evaluate(() => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    return [window.mainView, window.prView, ...child.drawerLifecycle.views].map(view => {
      const root = view.container.querySelector(".esri-scale-bar");
      const component = view.container.querySelector("arcgis-scale-bar");
      const bounds = root.getBoundingClientRect();
      const container = view.container.getBoundingClientRect();
      const globe = view.container.querySelector(".locator-globe")?.getBoundingClientRect();
      return { id: view.container.id, scale: view.scale,
        component: Boolean(component), associated: component?.view === view,
        position: component?.position, hidden: getComputedStyle(root).display === "none",
        compact: view.container.classList.contains("compact-inset"),
        lines: [...root.querySelectorAll(".esri-scale-bar__line")].map(line => ({
          width: line.getBoundingClientRect().width, calculated: Number.parseFloat(line.style.width),
        })),
        labels: [...root.querySelectorAll(".esri-scale-bar__label")].map(label => label.textContent.trim()),
        left: bounds.left - container.left, right: container.right - bounds.right,
        bottom: container.bottom - bounds.bottom,
        fits: bounds.left >= container.left - 1 && bounds.right <= container.right + 1
          && bounds.top >= container.top - 1 && bounds.bottom <= container.bottom + 1,
        globeClear: !globe || bounds.right <= globe.left || bounds.left >= globe.right
          || bounds.bottom <= globe.top || bounds.top >= globe.bottom,
      };
    });
  });
}

try {
  for (const query of ["", "?projection=albers", "?overview=globes", "?projection=albers&overview=globes"]) {
    if (focusGlobes && !query.includes("globes")) continue;
    const page = await browser.context.newPage();
    const errors = [];
    const deprecations = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (/ScaleBar.*deprecat|deprecat.*ScaleBar/i.test(message.text())) deprecations.push(message.text());
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.bringToFront();
    await page.goto(base + query);
    await page.waitForFunction(() => window.mainView?.ready);
    await page.evaluate(async () => { await window.framingPreviewReady; });
    await page.locator("#pr-drawer-toggle").click();
    await page.evaluate(async () => { await window.viewsReady; });
    await page.locator("#drawer-toggle").click();
    await page.evaluate(async () => { await window.viewsReady; });
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => {
        const child = document.querySelector("#drawer-iframe").contentWindow;
        return [window.mainView, window.prView, ...child.drawerLifecycle.views].every(view =>
          Math.abs(view.width - view.container.clientWidth) <= 1
          && Math.abs(view.height - view.container.clientHeight) <= 1);
      });
      await page.evaluate(async () => { await window.updateMapViews({ reframe: true }); });
      await settled(page);
      const overviewScale = await page.evaluate(() => document.querySelector("#drawer-iframe")
        .contentWindow.drawerLifecycle.views.find(view => view.container.id === "overViewDiv")?.scale ?? null);
      for (const scale of [null, 5000000, 1000000]) {
        if (scale) await page.evaluate(scale => { window.mainView.scale = scale; }, scale);
        await settled(page);
        const key = `${query || "default"}/${width}x${height}/${scale ?? "initial"}`;
        const bars = await measure(page);
        assert.equal(bars.length, query.includes("globes") ? 6 : 7, key);
        for (const bar of bars) {
          if (!capture) {
            assert.ok(bar.component && bar.associated, `${key}/${bar.id}: view association`);
            assert.equal(bar.position, ["overViewDiv", "akViewDiv"].includes(bar.id) ? "bottom-right" : "bottom-left");
          }
          assert.match(bar.labels[0], /\d.*(?:km|m|cm|mm)$/);
          assert.match(bar.labels[1], /\d.*(?:mi|ft|in)$/);
          assert.equal(bar.hidden, query.includes("globes") && bar.compact);
          if (!bar.hidden) {
            assert.ok(bar.fits && bar.globeClear, `${key}/${bar.id}: bounds or globe overlap`);
            if (bar.id === "akViewDiv") assert.ok(bar.right >= 0 && bar.right <= 6 && bar.bottom >= 0 && bar.bottom <= 6,
              `${key}: Alaska lower-right anchoring`);
            if (query.includes("globes") && ["guViewDiv", "asViewDiv", "hiViewDiv"].includes(bar.id)) {
              assert.ok(bar.left >= 0 && bar.left <= 6 && bar.bottom >= 0 && bar.bottom <= 6,
                `${key}/${bar.id}: lower-left anchoring ${JSON.stringify({ left: bar.left, bottom: bar.bottom })}`);
            }
            for (const line of bar.lines) assert.ok(Math.abs(line.width - line.calculated) < 1);
          }
          if (bar.id === "overViewDiv") assert.equal(bar.scale, overviewScale);
          else if (scale) assert.ok(Math.abs(bar.scale - scale) < 1);
          if (baseline) {
            const previous = baseline[key].find(value => value.id === bar.id);
            assert.ok(Math.abs(bar.scale - previous.scale) < 1, `${key}/${bar.id}: baseline scale ${bar.scale} != ${previous.scale}`);
            assert.deepEqual(bar.labels, previous.labels, `${key}/${bar.id}: labels`);
            for (let index = 0; index < bar.lines.length; index++) {
              assert.ok(Math.abs(bar.lines[index].width - previous.lines[index].width) <= 1,
                `${key}/${bar.id}: baseline line length`);
            }
            for (const edge of ["left", "right", "bottom"]) {
              assert.ok(Math.abs(bar[edge] - previous[edge]) <= 1, `${key}/${bar.id}: ${edge}`);
            }
          }
        }
        samples[key] = bars;
        if (focusAlaska && scale === null) {
          framing[key] = await page.evaluate(async () => {
            const child = document.querySelector("#drawer-iframe").contentWindow;
            const view = child.akView;
            const Point = view.center.constructor;
            const operator = await import("/usa-equal-area-map/node_modules/@arcgis/core/geometry/operators/projectOperator.js");
            const { default: SDKPoint } = await import("/usa-equal-area-map/node_modules/@arcgis/core/geometry/Point.js");
            const { default: SpatialReference } = await import("/usa-equal-area-map/node_modules/@arcgis/core/geometry/SpatialReference.js");
            await operator.load();
            const spatialReference = new SpatialReference(view.spatialReference.toJSON());
            const screenPoint = (lon, lat) => {
              try {
                const projected = operator.execute(new SDKPoint({ x: lon, y: lat, spatialReference: { wkid: 4326 } }), spatialReference);
                return view.toScreen(new Point(projected.toJSON()));
              } catch (error) {
                throw new Error(`Native toScreen ${lon},${lat}: ${error.message}; ${error.stack}`);
              }
            };
            const params = new URLSearchParams({ f: "json", where: "ISO_CC = 'USA'", outFields: "ISO_CC",
              returnGeometry: "true", outSR: "4326", maxAllowableOffset: "0.001" });
            const result = await fetch(`https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries/FeatureServer/0/query?${params}`).then(response => response.json());
            if (result.error || !result.features?.length) throw new Error(JSON.stringify(result.error ?? "No country geometry"));
            const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
            let clipped = 0;
            let vertices = 0;
            let easternHemisphere = 0;
            for (const feature of result.features) for (const ring of feature.geometry.rings) {
              if (!ring.every(([lon, lat]) => lat > 50 && (lon < -129 || lon > 170))) continue;
              for (const [lon, lat] of ring) {
                const point = screenPoint(lon, lat);
                if (!point) throw new Error("Native projection failed");
                vertices++;
                if (lon > 170) easternHemisphere++;
                bounds.left = Math.min(bounds.left, point.x);
                bounds.right = Math.max(bounds.right, point.x);
                bounds.top = Math.min(bounds.top, point.y);
                bounds.bottom = Math.max(bounds.bottom, point.y);
                if (point.x < 0 || point.y < 0 || point.x > view.width || point.y > view.height) clipped++;
              }
            }
            const locations = Object.fromEntries(Object.entries({ Anchorage: [-149.9964, 61.1743], Attu: [172.9, 52.85],
              Adak: [-176.646, 51.88], North: [-156.48, 71.39], Panhandle: [-130, 55.9] }).map(([name, coordinates]) => {
              const point = screenPoint(...coordinates);
              return [name, { x: point.x, y: point.y, fits: point.x >= 0 && point.x <= view.width && point.y >= 0 && point.y <= view.height }];
            }));
            return { scale: view.scale, width: view.width, height: view.height, center: view.center.toJSON(),
              vertices, clipped, easternHemisphere, bounds, locations };
          });
          assert.ok(framing[key].vertices > 0 && framing[key].easternHemisphere > 0);
          console.log(`FRAMING ${key} ${JSON.stringify(framing[key])}`);
          await page.screenshot({ path: join(artifacts, `initial-${query.replaceAll(/[?=&]/g, "-") || "default"}-${width}x${height}.png`) });
        }
      }
      await page.screenshot({ path: join(artifacts, `${query.replaceAll(/[?=&]/g, "-") || "default"}-${width}x${height}.png`) });
      console.log(`PASS ${query || "default"} ${width}x${height}: all bars at three scales`);
    }
    if (!capture && !focusGlobes && !focusAlaska) {
      await page.evaluate(() => {
        const child = document.querySelector("#drawer-iframe").contentWindow;
        window.previousScaleBars = [window.mainView, window.prView, ...child.drawerLifecycle.views]
          .map(view => view.container.querySelector("arcgis-scale-bar"));
      });
      const other = await browser.context.newPage();
      await other.bringToFront();
      await page.waitForFunction(() => document.hidden, null, { polling: 100 });
      assert.equal(await page.evaluate(() => window.previousScaleBars.every(bar =>
        bar.isConnected && !bar.viewModel.destroyed)), true);
      await page.bringToFront();
      await page.evaluate(async () => { await window.viewsReady; });
      await settled(page);
      assert.ok((await measure(page)).every(bar => bar.component && bar.associated));
      assert.equal(await page.evaluate(() => window.previousScaleBars.every(bar =>
        bar.view.container.querySelector("arcgis-scale-bar") === bar)), true);
      await other.close();
      for (const selector of ["#drawer-toggle", "#pr-drawer-toggle"]) {
        await page.locator(selector).click();
        await page.evaluate(async () => { await window.viewsReady; });
        await page.locator(selector).click();
        await page.evaluate(async () => { await window.viewsReady; });
        await settled(page);
      }
      assert.deepEqual(deprecations, []);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(capture || join(artifacts, "measurements.json"), JSON.stringify(samples, null, 2));
  if (focusAlaska) writeFileSync(join(artifacts, "framing.json"), JSON.stringify(framing, null, 2));
} finally {
  await browser.close();
}