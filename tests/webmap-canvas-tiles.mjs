import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { clipPolyline } from "lineclip";
import proj4 from "proj4";
import { projections } from "../src/projections.js";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5175/usa-equal-area-map/";
const sourceKind = process.env.TILE_SOURCE ?? "albers";
assert.ok(["albers", "mercator"].includes(sourceKind));
const services = sourceKind === "mercator"
  ? ["https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer"]
  : ["Albers_ContiguousUS", "Albers_Alaska_master"].map(name =>
  `https://tiles.arcgis.com/tiles/jIL9msH9OI208GCb/arcgis/rest/services/${name}/VectorTileServer`);
const sourceFor = pane => services[sourceKind === "albers" && pane === "ak" ? 1 : 0];
const boundaryService = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Administrative_Divisions/FeatureServer/0/query";
const places = [
  { name: "San Juan", pane: "pr", center: [-66.1, 18.45] },
  { name: "Honolulu", pane: "hi", center: [-157.86, 21.3] },
  { name: "Guam", pane: "gu", center: [144.75, 13.45] },
  { name: "Anchorage", pane: "ak", center: [-149.9, 61.2] },
  { name: "Pago Pago", pane: "as", center: [-170.7, -14.28] },
  { name: "Adak", pane: "ak", center: [-176.65, 51.88] },
].filter(place => !process.env.DATELINE_ONLY && (!process.env.TEST_PLACES || process.env.TEST_PLACES.split(",").includes(place.name)));
const artifacts = mkdtempSync(join(tmpdir(), "usa-map-tile-coasts-"));
const results = { base, sourceKind, services, boundaryService, method: "Symmetric sampled coastline-to-segment distance in a 40km square centered on each anchor, CSS pixels at DPR1", rows: [], layouts: [] };
console.log("Artifacts:", artifacts);
const metadata = new Map(await Promise.all(services.map(async (url, index) => {
  const response = await fetch(`${url}?f=json`, { signal: AbortSignal.timeout(30000) });
  assert.ok(response.ok);
  const text = await response.text();
  writeFileSync(join(artifacts, `source-${index}.json`), text);
  return [url, JSON.parse(text)];
})));

function distances(paths, targets, resolution) {
  const segments = targets.flatMap(path => path.slice(1).map((finish, index) => [path[index], finish]));
  assert.ok(segments.length, "Independent target coastline is missing");
  const values = [];
  for (const path of paths) for (let index = 1; index < path.length; index++) {
    const start = path[index - 1], finish = path[index];
    const steps = Math.max(1, Math.ceil(Math.hypot(finish[0] - start[0], finish[1] - start[1]) / resolution));
    for (let step = 0; step <= steps; step++) {
      const point = start.map((value, axis) => value + (finish[axis] - value) * step / steps);
      let minimum = Infinity;
      for (const [first, second] of segments) {
        const horizontal = second[0] - first[0], vertical = second[1] - first[1];
        const denominator = horizontal ** 2 + vertical ** 2;
        const fraction = denominator ? Math.max(0, Math.min(1, ((point[0] - first[0]) * horizontal + (point[1] - first[1]) * vertical) / denominator)) : 0;
        minimum = Math.min(minimum, Math.hypot(point[0] - first[0] - fraction * horizontal, point[1] - first[1] - fraction * vertical));
      }
      values.push(minimum / resolution);
    }
  }
  return values;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const place of places) {
    const [longitude, latitude] = place.center;
    const query = new URLSearchParams({ f: "json", where: "1=1", returnGeometry: "true", outFields: "OBJECTID",
      outSR: "4326", inSR: "4326", geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects",
      geometry: JSON.stringify({ xmin: longitude - 0.6, ymin: latitude - 0.4, xmax: longitude + 0.6, ymax: latitude + 0.4,
        spatialReference: { wkid: 4326 } }) });
    const response = await fetch(`${boundaryService}?${query}`, { signal: AbortSignal.timeout(60000) });
    assert.ok(response.ok);
    const text = await response.text(), reference = JSON.parse(text);
    assert.ok(!reference.error && !reference.exceededTransferLimit && reference.features?.length, JSON.stringify(reference.error));
    const stem = place.name.toLowerCase().replaceAll(" ", "-");
    writeFileSync(join(artifacts, `${stem}-reference.json`), text);
    const converter = proj4("EPSG:4326", projections.albers[place.pane].wkt), center = converter.forward(place.center);
    const local = point => converter.forward(point).map((value, axis) => value - center[axis]);
    const references = reference.features.flatMap(feature => feature.geometry.rings.map(ring => ring.map(local)));
    const clip = (paths, radius) => paths.flatMap(path => clipPolyline(path, [-radius, -radius, radius, radius]));
    for (const scale of [1000000, 500000]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
      const requests = [];
      page.on("request", request => requests.push(request.url()));
      await page.goto(`${base}experiments/webmap-canvas/?${new URLSearchParams({ projection: "albers", panes: place.pane,
        scale: String(scale), tiles: services.join(",") })}`);
      await page.waitForFunction(() => ["ready", "error"].includes(window.webmapCanvas?.status), null, { timeout: 120000 });
      const measured = await page.evaluate(async ({ center }) => {
        const state = window.webmapCanvas;
        if (state.status !== "ready") throw new Error(JSON.stringify(state.errors));
        state.renderer.panes[0].center = state.renderer.panes[0].parameters.converter.forward(center);
        await state.refresh();
        const dataset = state.datasets[0], gl = state.renderer.gl;
        state.renderer.draw();
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let changedPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) if (Math.abs(pixels[index] - pixels[0]) > 5) changedPixels++;
        return { evidence: dataset.tileEvidence, layers: [...new Set(dataset.features.map(feature => feature.attributes.tileLayer))],
          coast: dataset.features.filter(feature => /OceanSea|^Marine area$/i.test(feature.attributes.tileLayer)).flatMap(feature => feature.boundaryPaths ?? []),
          geometryTypes: [...new Set(dataset.features.map(feature => feature.geometry.type))],
          contexts: window.getWebGLContextStats(), changedPixels, glError: gl.getError(), reports: state.reports };
      }, place);
      assert.equal(measured.glError, 0); assert.equal(measured.contexts.live, 1); assert.ok(measured.changedPixels > 100);
      assert.equal(measured.evidence.url, sourceFor(place.pane));
      if (sourceKind === "mercator") {
        assert.ok(!measured.geometryTypes.includes("multipoint"));
        const lods = metadata.get(measured.evidence.url).tileInfo.lods;
        const expected = lods.find(lod => lod.resolution * Math.cos(latitude * Math.PI / 180) <= scale * 0.0254 / 96);
        assert.deepEqual(measured.evidence.levels, [expected.level]);
      }
      assert.ok(!measured.layers.some(name => /\/(label|abbr)(?:\/|$)/i.test(name)));
      assert.ok(!requests.some(url => /\/resources\/styles|\/sprites|\/fonts|\/glyphs/.test(url)), "Unexpected style/label asset request");
      const tiles = measured.coast.map(path => path.map(local));
      const resolution = scale * 0.0254 / 96;
      const values = [...distances(clip(tiles, 20000), clip(references, 40000), resolution),
        ...distances(clip(references, 20000), clip(tiles, 40000), resolution)].sort((first, second) => first - second);
      assert.ok(values.length);
      const row = { place: place.name, scale, source: measured.evidence, referenceSHA256: createHash("sha256").update(text).digest("hex"),
        samples: values.length, medianPixels: values[Math.floor(values.length / 2)], p95Pixels: values[Math.floor(values.length * 0.95)],
        maxPixels: values.at(-1), withinOnePixel: values.at(-1) <= 1, changedPixels: measured.changedPixels,
        contexts: measured.contexts, reports: measured.reports, layers: measured.layers };
      results.rows.push(row);
      writeFileSync(join(artifacts, `${stem}-${scale}-geometry.json`), JSON.stringify({ center: place.center, projection: projections.albers[place.pane].wkt,
        scale, coast: measured.coast, requests }));
      console.log("COAST", JSON.stringify(row));
      await page.screenshot({ path: join(artifacts, `${stem}-${scale}.png`) });
      await page.close();
    }
  }
  for (const viewport of process.env.COAST_ONLY || process.env.DATELINE_ONLY ? [] : [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.goto(`${base}experiments/webmap-canvas/?${new URLSearchParams({ projection: "albers", panes: "conus,ak,hi,pr,gu,as",
      scale: "1000000", tiles: services.toReversed().join(",") })}`);
    await page.waitForFunction(() => ["ready", "error"].includes(window.webmapCanvas?.status), null, { timeout: 120000 });
    const layout = await page.evaluate(() => {
      const state = window.webmapCanvas;
      if (state.status !== "ready") throw new Error(JSON.stringify(state.errors));
      state.renderer.draw();
      const gl = state.renderer.gl;
      return { contexts: window.getWebGLContextStats(), reports: state.reports, glError: gl.getError(),
        overflow: document.documentElement.scrollWidth > innerWidth,
        panes: state.renderer.panes.map(pane => {
          const bounds = pane.element.getBoundingClientRect(), title = pane.element.querySelector("h2").getBoundingClientRect();
          const button = pane.element.querySelector("button").getBoundingClientRect();
          const pixels = new Uint8Array(Math.floor(bounds.width) * Math.floor(bounds.height) * 4);
          gl.readPixels(bounds.x, innerHeight - bounds.bottom, Math.floor(bounds.width), Math.floor(bounds.height), gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let changedPixels = 0;
          for (let index = 0; index < pixels.length; index += 4) if (Math.abs(pixels[index] - pixels[0]) > 5) changedPixels++;
          return { id: pane.id, center: [...pane.center], x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
            changedPixels, titleFits: title.right <= button.left && title.bottom <= bounds.bottom,
            source: state.datasets.find(dataset => dataset.paneId === pane.id).tileEvidence.url };
        }) };
    });
    assert.equal(layout.contexts.live, 1); assert.equal(layout.glError, 0); assert.equal(layout.overflow, false);
    for (const pane of layout.panes) {
      assert.ok(pane.changedPixels > 10, `${pane.id}: blank pane`);
      assert.ok(pane.titleFits, `${pane.id}: title overlaps`);
      assert.equal(pane.source, sourceFor(pane.id));
    }
    const pane = layout.panes[0];
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
    await page.mouse.down(); await page.mouse.move(pane.x + pane.width / 2 + 40, pane.y + pane.height / 2 + 20, { steps: 4 }); await page.mouse.up();
    assert.notDeepEqual(await page.evaluate(() => window.webmapCanvas.renderer.panes[0].center), pane.center);
    await page.mouse.wheel(0, -1000);
    await page.waitForFunction(sourceKind => {
      const state = window.webmapCanvas;
      return state.renderer.scale === 500000 && !state.refreshing && state.datasets.every(dataset => dataset.tileEvidence.levels.every(level => sourceKind === "mercator" ? level >= 9 : level === 9));
    }, sourceKind, { timeout: 120000 });
    await page.screenshot({ path: join(artifacts, `layout-${viewport.width}.png`) });
    results.layouts.push({ viewport, ...layout, panAndZoom: true });
    console.log("LAYOUT", JSON.stringify(results.layouts.at(-1)));
    await page.close();
  }
  if (sourceKind === "mercator" && !process.env.COAST_ONLY) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    const requests = [];
    page.on("request", request => requests.push(request.url()));
    await page.goto(`${base}experiments/webmap-canvas/?${new URLSearchParams({ projection: "albers", panes: "ak",
      scale: "4000000", tiles: services[0] })}`);
    await page.waitForFunction(() => ["ready", "error"].includes(window.webmapCanvas?.status), null, { timeout: 120000 });
    const dateline = await page.evaluate(async () => {
      const state = window.webmapCanvas;
      if (state.status !== "ready") throw new Error(JSON.stringify(state.errors));
      const pane = state.renderer.panes[0];
      pane.center = pane.parameters.converter.forward([180, 52]);
      await state.refresh();
      state.renderer.draw();
      const dataset = state.datasets[0], gl = state.renderer.gl;
      let eastVertices = 0, westVertices = 0;
      for (const feature of dataset.features) for (const point of (feature.geometry.rings ?? feature.geometry.paths ?? []).flat()) {
        if (point[0] > 170 && point[0] < 180) eastVertices++;
        if (point[0] < -170 && point[0] > -180) westVertices++;
      }
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const landPixels = [0, 0];
      for (let index = 0; index < pixels.length; index += 4) {
        if (Math.abs(pixels[index] - 165) <= 2 && Math.abs(pixels[index + 1] - 197) <= 2 && Math.abs(pixels[index + 2] - 163) <= 2)
          landPixels[(index / 4) % gl.drawingBufferWidth < gl.drawingBufferWidth / 2 ? 0 : 1]++;
      }
      return { source: dataset.tileEvidence, eastVertices, westVertices, landPixels, reports: state.reports,
        contexts: window.getWebGLContextStats(), glError: gl.getError() };
    });
    const level = dateline.source.levels[0], columns = 2 ** level;
    for (const edge of [0, columns - 1]) {
      assert.ok(dateline.source.keys.some(key => key[2] === edge));
      assert.ok(requests.some(url => new RegExp(`/tile/${level}/\\d+/${edge}\\.pbf$`).test(url)));
    }
    assert.ok(dateline.eastVertices > 0 && dateline.westVertices > 0);
    assert.ok(dateline.landPixels.every(count => count > 100));
    assert.equal(dateline.contexts.live, 1);
    assert.equal(dateline.glError, 0);
    assert.equal(dateline.reports.length, 0);
    assert.ok(!requests.some(url => /\/resources\/styles|\/sprites|\/fonts|\/glyphs/.test(url)));
    results.dateline = { ...dateline, requests };
    await page.screenshot({ path: join(artifacts, "alaska-dateline.png") });
    console.log("DATELINE", JSON.stringify(dateline));
    await page.close();
  }
} finally {
  writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}