import assert from "node:assert/strict";
import { chromium } from "playwright";
import { base } from "./webmap-canvas-browser.mjs";

export async function measureAccuracy(page) {
  return page.evaluate(async () => {
    const { projectionParameters, measureGPU } = await import("/usa-equal-area-map/experiments/webmap-canvas/projection.js");
    const { projections } = await import("/usa-equal-area-map/src/projections.js");
    const { MIN_SCALE } = await import("/usa-equal-area-map/experiments/webmap-canvas/config.js");
    const { HOME_CENTERS } = await import("/usa-equal-area-map/experiments/webmap-canvas/renderer.js");
    const operator = await import("/usa-equal-area-map/node_modules/@arcgis/core/geometry/operators/projectOperator.js");
    const { default: Point } = await import("/usa-equal-area-map/node_modules/@arcgis/core/geometry/Point.js");
    const { default: SpatialReference } = await import("/usa-equal-area-map/node_modules/@arcgis/core/geometry/SpatialReference.js");
    await operator.load();
    const gl = document.querySelector("#map-canvas").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 unavailable");
    const samples = { ANC: [-149.9964, 61.1743], Attu: [172.9, 52.85], Adak: [-176.646, 51.88], HNL: [-157.9225, 21.3187],
      SJU: [-66.0018, 18.4394], KeyWest: [-81.78, 24.555], Seattle: [-122.333, 47.606] };
    const rows = [];
    for (const [kind, group] of Object.entries(projections)) for (const pane of ["conus", "ak", "hi", "pr"]) {
      const definition = group[pane];
      const points = [...Object.values(samples), [definition.centralMeridian, definition.latitudeOfOrigin], HOME_CENTERS[pane]];
      const parameters = projectionParameters(definition);
      const actual = measureGPU(gl, parameters, points);
      const sr = new SpatialReference({ wkt: definition.wkt });
      const errors = points.map((coordinates, index) => {
        const expected = operator.execute(new Point({ x: coordinates[0], y: coordinates[1], spatialReference: { wkid: 4326 } }), sr);
        const meters = Math.hypot(actual[index][0] - expected.x, actual[index][1] - expected.y);
        const cpu = parameters.converter.forward(coordinates);
        return { name: [...Object.keys(samples), "projectionCenter", "homeCenter"][index], meters, pixels: meters / (MIN_SCALE * 0.0254 / 96) * devicePixelRatio,
          cpuMeters: Math.hypot(cpu[0] - expected.x, cpu[1] - expected.y) };
      });
      rows.push({ kind, pane, minScale: MIN_SCALE, devicePixelRatio, maxMeters: Math.max(...errors.map(error => error.meters)),
        maxPixels: Math.max(...errors.map(error => error.pixels)), maxCPUMeters: Math.max(...errors.map(error => error.cpuMeters)), errors });
    }
    return { rows, contexts: window.getWebGLContextStats(), glError: gl.getError() };
  });
}

async function run() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.goto(`${base}experiments/webmap-canvas/`);
    await page.waitForFunction(() => window.webmapCanvas?.status === "waiting");
    const result = await measureAccuracy(page);
    console.log(JSON.stringify(result, null, 2));
    for (const row of result.rows) assert.ok(row.maxPixels <= 1, `${row.kind}/${row.pane}: ${row.maxPixels} device pixels`);
    assert.equal(result.contexts.live, 1);
    assert.equal(result.contexts.created, 1);
    assert.equal(result.glError, 0);
  } finally { await browser.close(); }
}

if (process.argv[1]?.endsWith("webmap-canvas-accuracy.mjs")) await run();
