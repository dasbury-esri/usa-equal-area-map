import assert from "node:assert/strict";
import { chromium } from "playwright";

export const itemIds = ["42430a34a2b44c0da678ce60ce20dd31", "bbda2d6bc77c495ab382e313f02888f1", "6100fd30484645e6b3ec7006d95aa7b8"];
export const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";

export async function comparisonStyles(page) {
  const colors = [[230, 235, 231, 255], [202, 221, 211, 255], [255, 255, 255, 0]];
  const outlines = [[150, 161, 158, 255], [59, 104, 92, 255], [160, 80, 65, 255]];
  for (const [index, id] of itemIds.entries()) {
    await page.route(`**/sharing/rest/content/items/${id}/data*`, async route => {
      const response = await route.fetch();
      const json = await response.json();
      for (const layer of json.layers ?? []) {
        layer.blendMode = "normal";
        layer.effect = null;
        layer.featureEffect = null;
        layer.layerDefinition.drawingInfo.renderer = { type: "simple", symbol: { type: "esriSFS", style: "esriSFSSolid",
          color: colors[index], outline: { type: "esriSLS", style: "esriSLSSolid", color: outlines[index], width: 0.5 } } };
      }
      await route.fulfill({ response, json });
    });
  }
}

async function run() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await comparisonStyles(page);
    await page.goto(`${base}experiments/webmap-canvas/?layers=${itemIds.join(",")}`);
    await page.waitForFunction(() => ["loaded", "ready", "error"].includes(window.webmapCanvas?.status), null, { timeout: 180000 });
    const result = await page.evaluate(() => ({ status: window.webmapCanvas.status, errors: window.webmapCanvas.errors,
      reports: window.webmapCanvas.reports, contexts: window.getWebGLContextStats(), datasets: window.webmapCanvas.datasets?.map(data => ({
        title: data.title, count: data.count, pages: data.pages, vertices: data.vertices, outFields: data.outFields,
        positiveAleutianVertices: data.features.reduce((total, feature) => total + (feature.geometry?.rings ?? [])
          .reduce((sum, ring) => sum + ring.filter(([lon, lat]) => lon > 170 && lat > 50 && lat < 55).length, 0), 0),
      })) }));
    console.log(JSON.stringify(result, null, 2));
    assert.notEqual(result.status, "error");
    assert.equal(result.datasets.length, 3);
    assert.ok(result.datasets[0].positiveAleutianVertices > 0);
    assert.equal(result.datasets[2].positiveAleutianVertices, 0);
    assert.ok(result.contexts.live <= 1);
    await page.close();
  } finally { await browser.close(); }
}

if (process.argv[1]?.endsWith("webmap-canvas-browser.mjs")) await run();
