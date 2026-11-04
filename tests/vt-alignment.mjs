import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";
const artifacts = mkdtempSync(join(tmpdir(), "usa-vt-alignment-"));
const query = "?projection=albers&webmap=e46bd022bab240489506463e32fcc1bf&basemaps=conus:e46bd022bab240489506463e32fcc1bf,ak:74d4ae1d00664614b839d3aebc61a044,hi:99eafcf8471b47ad8a2784224a185d3d";
const locations = [
  { name: "Seattle", pane: "mainViewDiv", longitude: -122.3575, latitude: 47.621 },
  { name: "Key-West", pane: "mainViewDiv", longitude: -81.81, latitude: 24.552 },
  { name: "Anchorage", pane: "akViewDiv", longitude: -149.918, latitude: 61.218 },
  { name: "Honolulu", pane: "hiViewDiv", longitude: -157.866, latitude: 21.305 },
];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
console.log(`Artifacts: ${artifacts}`);
try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1600 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const requests = [];
    page.on("request", request => {
      if (/\/tile\/\d+\/\d+\/\d+\.pbf/i.test(request.url())) requests.push(request.url());
    });
    await page.goto(base + query + (process.env.VT_OVERVIEW ? "&overviewBasemap=conus" : ""));
    await page.waitForFunction(() => window.framingPreviewReady, null, { timeout: 180000 });
    await page.evaluate(async () => { await window.framingPreviewReady; });
    await page.locator("#drawer-toggle").click();
    await page.locator("#pr-drawer-toggle").click();
    await page.evaluate(async () => { await window.viewsReady; });
    await page.evaluate(async () => {
      window.alignmentProjection = await import("/usa-equal-area-map/node_modules/@arcgis/core/geometry/operators/projectOperator.js");
      window.alignmentTransforms = await import("/usa-equal-area-map/node_modules/@arcgis/core/geometry/operators/support/geographicTransformationUtils.js");
      await window.alignmentProjection.load();
      await window.alignmentTransforms.load();
      window.alignmentViews = () => [window.mainView, window.prView, ...document.querySelector("#drawer-iframe").contentWindow.drawerLifecycle.views];
      window.alignmentVisibility = window.mainView.map.layers.map(layer => [layer.id, layer.visible]).toArray();
    });
    const settle = () => page.waitForFunction(() => window.alignmentViews().every(view => view.ready && !view.updating && view.stationary), null, { timeout: 180000 });
    await settle();
    for (const location of locations) {
      for (const scale of [1000000, 500000]) {
        const before = requests.length;
        const label = `${viewport.width}x${viewport.height}-${location.name}-${scale}`;
        await page.evaluate(scale => { window.mainView.scale = scale; }, scale);
        await page.waitForFunction(scale => window.alignmentViews().filter(view => view.container.id !== "overViewDiv")
          .every(view => Math.abs(view.scale - scale) < 0.01), scale);
        const navigation = await page.evaluate(({ location }) => {
          const view = window.alignmentViews().find(view => view.container.id === location.pane);
          window.alignmentView = view;
          const Point = view.center.constructor;
          const geographic = new Point({ longitude: location.longitude, latitude: location.latitude, spatialReference: { wkid: 4326 } });
          const native = window.alignmentProjection.execute(geographic, view.spatialReference);
          const numeric = native.toJSON();
          const drawerWidth = location.pane === "mainViewDiv" ? document.querySelector("#drawer-container").getBoundingClientRect().width : 0;
          view.center = new Point({ x: numeric.x - drawerWidth / 2 * view.resolution, y: numeric.y, spatialReference: view.spatialReference });
          const nad83 = window.alignmentProjection.execute(new Point({ longitude: location.longitude, latitude: location.latitude,
            spatialReference: { wkid: 4269 } }), view.spatialReference);
          const transformation = window.alignmentTransforms.getTransformation(geographic.spatialReference, view.spatialReference);
          return { scale: view.scale, resolution: view.resolution, projected: numeric,
            datumVsSameNumericNAD83Meters: Math.hypot(native.x - nad83.x, native.y - nad83.y),
            datumVsSameNumericNAD83Pixels: Math.hypot(native.x - nad83.x, native.y - nad83.y) / view.resolution,
            transformation: transformation?.steps?.map(step => ({ wkid: step.wkid, isInverse: step.isInverse, wkt: step.wkt })) ?? null };
        }, { location, scale });
        await settle();
        assert.ok(Math.abs(navigation.scale - scale) < 0.01);
        await page.screenshot({ path: join(artifacts, `${label}.png`) });
        await page.evaluate(() => { for (const layer of window.mainView.map.layers) layer.visible = false; });
        await settle();
        const basemap = await page.evaluate(async ({ projected }) => {
          const view = window.alignmentView;
          const screen = view.toScreen(new view.center.constructor(projected));
          const size = Math.min(200, view.width - 24, view.height - 24);
          window.alignmentArea = { x: Math.round(screen.x - size / 2), y: Math.round(screen.y - size / 2), width: size, height: size };
          const shot = await view.takeScreenshot({ area: window.alignmentArea, format: "png" });
          window.alignmentBasePixels = shot.data;
          return shot.dataUrl;
        }, navigation);
        writeFileSync(join(artifacts, `${label}-base.png`), Buffer.from(basemap.split(",")[1], "base64"));
        await page.evaluate(() => {
          window.alignmentBasemapLayers = [...window.alignmentView.map.basemap.baseLayers, ...window.alignmentView.map.basemap.referenceLayers].map(layer => [layer, layer.visible]);
          for (const [layer] of window.alignmentBasemapLayers) layer.visible = false;
          window.mainView.map.findLayerById("1a1a8023108-layer-219").visible = true;
        });
        await settle();
        const measured = await page.evaluate(async ({ name }) => {
          const shot = await window.alignmentView.takeScreenshot({ area: window.alignmentArea, format: "png" });
          const edges = (image, kind) => {
            const { width, height, data } = image;
            const inside = (column, row) => {
              const offset = (row * width + column) * 4;
              if (data[offset + 3] < 128) return false;
              const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
              if (kind === "operational") return red - green > 8 && green - blue > 5;
              return name === "Honolulu" ? red < 240 && Math.abs(red - green) < 4 : red > 220;
            };
            const points = [];
            for (let row = 3; row < height - 3; row++) {
              for (let column = 3; column < width - 3; column++) {
                if (inside(column, row) && (!inside(column + 1, row) || !inside(column - 1, row)
                    || !inside(column, row + 1) || !inside(column, row - 1))) points.push([column, row]);
              }
            }
            return points;
          };
          const operational = edges(shot.data, "operational");
          const coast = edges(window.alignmentBasePixels, "base");
          const center = [shot.data.width / 2, shot.data.height / 2];
          operational.sort((first, second) => Math.hypot(first[0] - center[0], first[1] - center[1]) - Math.hypot(second[0] - center[0], second[1] - center[1]));
          const sample = operational[0];
          coast.sort((first, second) => Math.hypot(first[0] - sample?.[0], first[1] - sample?.[1]) - Math.hypot(second[0] - sample?.[0], second[1] - sample?.[1]));
          const nearest = coast[0];
          const palette = image => {
            const counts = new Map();
            for (let offset = 0; offset < image.data.length; offset += 4) {
              const key = [...image.data.slice(offset, offset + 4)].join(",");
              counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            return [...counts].sort((first, second) => second[1] - first[1]).slice(0, 6);
          };
          return { dataUrl: shot.dataUrl, sample, nearest, offsetPixels: sample && nearest ? Math.hypot(sample[0] - nearest[0], sample[1] - nearest[1]) : null,
            operationalEdges: operational.length, coastlineEdges: coast.length, basePalette: palette(window.alignmentBasePixels), operationalPalette: palette(shot.data) };
        }, location);
        writeFileSync(join(artifacts, `${label}-operational.png`), Buffer.from(measured.dataUrl.split(",")[1], "base64"));
        delete measured.dataUrl;
        assert.ok(measured.operationalEdges > 20 && measured.coastlineEdges > 20, `${label}: both shorelines must be present`);
        await page.evaluate(() => {
          for (const [layer, visible] of window.alignmentBasemapLayers) layer.visible = visible;
          for (const [id, visible] of window.alignmentVisibility) window.mainView.map.findLayerById(id).visible = visible;
        });
        await settle();
        const result = { label, location, navigation, measured, tileRequests: requests.slice(before), contexts: await page.evaluate(() => window.getLiveWebGLContexts()) };
        results.push(result);
        writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
        console.log(JSON.stringify({ label, offsetPixels: measured.offsetPixels, datumPixels: navigation.datumVsSameNumericNAD83Pixels, tileRequests: result.tileRequests.length }));
      }
    }
    await page.close();
  }
} finally {
  writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}