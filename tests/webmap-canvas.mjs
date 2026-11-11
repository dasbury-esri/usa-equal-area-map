import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { projectChunkBounds, projectionParameters } from "../experiments/webmap-canvas/projection.js";
import { projections } from "../src/projections.js";
import test from "node:test";
import { parseOptions, resolveSwipe } from "../experiments/webmap-canvas/config.js";
import { createDownloader, flattenLayers, loadFeatures, quantizationParameters, visibleAtScale } from "../experiments/webmap-canvas/data.js";
import { compileRenderer } from "../experiments/webmap-canvas/renderers.js";
import { continuousPath, densifyPath, polygonParts, prepareGeometry, triangulate, visibleRanges } from "../experiments/webmap-canvas/geometry.js";
import { generalizationForScale, needsRefresh, queryFootprint, splitBounds } from "../experiments/webmap-canvas/coverage.js";
import { createTileLoader, decodeTile, paneTiles, sourceProjection, tileCoordinate } from "../experiments/webmap-canvas/tiles.js";
import { PbfWriter } from "pbf";
import { Worker as NodeWorker } from "node:worker_threads";
import { preparationSnapshot } from "../experiments/webmap-canvas/preparation.js";

test("worker preparation matches inline mesh, bounds and budgets byte for byte", { timeout: 10000 }, async () => {
  const dataset = { opacity: 0.6, features: [{ attributes: {}, geometry: { type: "polygon",
    rings: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]], [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1], [0.5, 0.5]]] } }],
    renderer: { symbolFor: () => ({ type: "simple-fill", color: [128, 64, 192, 0.5], outline: { type: "simple-line", color: [0, 0, 0, 1], width: 1 } }) } };
  const definition = projections.albers.conus, budget = { vertices: 0, instances: 0 };
  const inline = await prepareGeometry(dataset, budget);
  projectChunkBounds(inline.values, inline.draws.flatMap(draw => draw.chunks), [{ id: "conus", parameters: projectionParameters(definition) }]);
  const url = new URL("../experiments/webmap-canvas/geometry-worker.js", import.meta.url).href;
  const worker = new NodeWorker(`const {parentPort}=require('node:worker_threads');
globalThis.self={postMessage:(...args)=>parentPort.postMessage(...args)};
import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`, { eval: true });
  try {
    const reply = new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    worker.postMessage({ id: 1, dataset: preparationSnapshot(dataset), budget: { vertices: 0, instances: 0 }, panes: [{ id: "conus", definition }] });
    const result = await reply;
    assert.equal(result.error, undefined);
    assert.deepEqual(result.mesh, inline); assert.deepEqual(result.budget, budget);
    assert.deepEqual(result.diagnostics, dataset.geometryDiagnostics);
    for (const [id, vertices] of [[2, 6500001], [3, 0]]) {
      const next = new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
      worker.postMessage({ id, dataset: preparationSnapshot(dataset), budget: { vertices, instances: 0 }, panes: [{ id: "conus", definition }] });
      const value = await next;
      if (vertices) assert.match(value.error, /budget exceeded/);
      else assert.deepEqual(value.mesh, inline);
    }
  } finally { await worker.terminate(); }
});
import proj4 from "proj4";

const mercatorMetadata = () => {
  const edge = 20037508.342789244;
  return { tileInfo: { format: "pbf", spatialReference: { wkid: 102100, latestWkid: 3857 },
    origin: { x: -edge, y: edge }, cols: 512, rows: 512,
    lods: Array.from({ length: 20 }, (_, level) => ({ level, resolution: 2 * edge / 512 / 2 ** level })) },
    fullExtent: { xmin: -edge, ymin: -edge, xmax: edge, ymax: edge } };
};

test("analytic Mercator tile coordinates match independent proj4 at coastal anchors and CRS aliases", () => {
  for (const wkid of [3857, 102100, 102113, 900913]) {
    const metadata = mercatorMetadata();
    metadata.tileInfo.spatialReference = { wkid };
    const converter = sourceProjection(metadata);
    for (const point of [[-66.1, 18.45], [-157.86, 21.3], [144.75, 13.45], [-149.9, 61.2], [-170.7, -14.28], [-176.65, 51.88], [179.9, 52]]) {
      const projected = proj4("EPSG:4326", "EPSG:3857", point);
      converter.inverse(projected).forEach((value, axis) => assert.ok(Math.abs(value - point[axis]) < 1e-10));
      converter.forward(point).forEach((value, axis) => assert.ok(Math.abs(value - projected[axis]) < 1e-7));
    }
    const lod = metadata.tileInfo.lods[9];
    const coordinate = tileCoordinate(metadata.tileInfo, lod, 0, 0, 4096, [0, 0]);
    const geographic = converter.inverse(coordinate);
    assert.ok(Math.abs(geographic[0] + 180) < 1e-10);
    assert.ok(Math.abs(geographic[1] - 85.0511287798066) < 1e-10);
  }
});

test("Mercator LOD follows pane ground resolution and wraps Alaska columns once", async context => {
  const metadata = mercatorMetadata();
  const converter = proj4("EPSG:4326", projections.albers.ak.wkt);
  const paneAt = center => ({ id: "ak", center: converter.forward(center), parameters: { converter },
    element: { getBoundingClientRect: () => ({ width: 1000, height: 700 }) } });
  for (const latitude of [0, 18.45, 21.3, 13.45, 61.2, -14.28, 51.88]) {
    const selected = paneTiles(paneAt([-176.65, latitude]), 1000000, metadata);
    const level = selected[0].lod.level, ground = metadata.tileInfo.lods[level].resolution * Math.cos(latitude * Math.PI / 180);
    assert.ok(ground <= 1000000 * 0.0254 / 96);
    assert.ok(ground * 2 > 1000000 * 0.0254 / 96);
  }
  const panes = [paneAt([179.9, 52])], tiles = paneTiles(panes[0], 1000000, metadata);
  assert.ok(tiles.some(tile => tile.column === 0));
  assert.ok(tiles.some(tile => tile.column === 2 ** tile.lod.level - 1));
  assert.equal(new Set(tiles.map(tile => `${tile.row}/${tile.column}`)).size, tiles.length);
  assert.ok(tiles.length < 40);
  assert.ok(tiles.every(tile => tile.column >= 0 && tile.column < 2 ** tile.lod.level && tile.row >= 0 && tile.row < 2 ** tile.lod.level));
  const requests = [];
  context.mock.method(globalThis, "fetch", async url => {
    requests.push(String(url));
    return String(url).endsWith("?f=json") ? { ok: true, json: async () => metadata } : { status: 204 };
  });
  const loader = createTileLoader(["https://example.com/VectorTileServer"], () => {});
  const datasets = await loader(panes, 1000000);
  for (const tile of tiles) assert.ok(requests.some(url => url.endsWith(`/tile/${tile.lod.level}/${tile.row}/${tile.column}.pbf`)));
  loader.accept(datasets);
  assert.equal(loader.needsRefresh(panes, 1000000), false);
  assert.equal(loader.needsRefresh(panes, 500000), true);
});

test("MVT buffers clip without artificial coastline edges, preserve holes and own edges once", () => {
  const writer = new PbfWriter();
  const fixtures = [
    { type: 3, paths: [[[-10, -10], [110, -10], [110, 110], [-10, 110]], [[30, 30], [30, 70], [70, 70], [70, 30]]] },
    { type: 2, paths: [[[0, 0], [0, 100]]] },
    { type: 2, paths: [[[100, 0], [100, 100]]] },
    { type: 1, paths: [[[0, 50]]] },
    { type: 1, paths: [[[100, 50]]] },
  ];
  writer.writeMessage(3, (_value, layer) => {
    layer.writeVarintField(15, 2); layer.writeStringField(1, "coast"); layer.writeVarintField(5, 100);
    for (const fixture of fixtures) layer.writeMessage(2, (value, feature) => {
      feature.writeVarintField(3, value.type);
      const commands = [], previous = [0, 0];
      for (const path of value.paths) {
        for (let index = 0; index < path.length; index++) {
          if (index === 0) commands.push(9);
          else if (index === 1) commands.push(((path.length - 1) << 3) | 2);
          for (let axis = 0; axis < 2; axis++) {
            const delta = path[index][axis] - previous[axis];
            commands.push(delta < 0 ? -delta * 2 - 1 : delta * 2);
            previous[axis] = path[index][axis];
          }
        }
        if (value.type === 3) commands.push(15);
      }
      feature.writePackedVarint(4, commands);
    }, fixture);
  }, null);
  const metadata = { tileInfo: { spatialReference: { wkt: "+proj=longlat +datum=WGS84 +no_defs" },
    cols: 100, rows: 100, origin: { x: 0, y: 1 } } };
  const features = decodeTile(writer.finish(), metadata, { resolution: 0.01 }, 0, 0);
  assert.deepEqual(features.map(feature => feature.geometry.type), ["polygon", "polyline", "multipoint"]);
  assert.equal(features[0].geometry.rings.length, 2);
  assert.equal(features[0].boundaryPaths.length, 4);
  assert.ok(features[0].boundaryPaths.flat().every(point => point.every(value => value > 0 && value < 1)));
  const area = features[0].geometry.rings.reduce((total, ring) => total + ring.slice(1).reduce((sum, point, index) =>
    sum + ring[index][0] * point[1] - point[0] * ring[index][1], 0) / 2, 0);
  assert.ok(Math.abs(Math.abs(area) - 0.84) < 1e-12);
  assert.deepEqual(features[1].geometry.paths, [[[0, 1], [0, 0]]]);
  assert.deepEqual(features[2].geometry.points, [[0, 0.5]]);
});

test("tile source CRS and tile grid are independent of the pane projection", () => {
  const metadata = { tileInfo: { spatialReference: { wkid: 5070 }, cols: 512, rows: 512, origin: { x: -16900977.339992262, y: 21063951.17933842 } } };
  const converter = sourceProjection(metadata), anchor = converter.forward([-66.1, 18.45]);
  assert.ok(Math.abs(anchor[0] - 3224258.167837162) < 0.001);
  const lod = { resolution: 257.8884481810343 };
  assert.deepEqual(tileCoordinate(metadata.tileInfo, lod, 2, 3, 4096, [4096, 0]), tileCoordinate(metadata.tileInfo, lod, 3, 3, 4096, [0, 0]));
  assert.deepEqual(tileCoordinate(metadata.tileInfo, lod, 2, 3, 4096, [0, 4096]), tileCoordinate(metadata.tileInfo, lod, 2, 4, 4096, [0, 0]));
  assert.deepEqual(parseOptions("?panes=gu&scale=500000&tiles=https://example.com/VectorTileServer").panes, ["gu"]);
  assert.deepEqual(parseOptions("?panes=as&scale=500000&tiles=https://example.com/VectorTileServer").panes, ["as"]);
  assert.throws(() => parseOptions("?tiles=http://example.com/VectorTileServer"));
});

test("tile coverage advances only after acceptance and wrong source CRS is refused", async context => {
  const metadata = { tileInfo: { format: "pbf", spatialReference: { wkid: 5070 }, cols: 512, rows: 512,
    origin: { x: -10000, y: 10000 }, lods: [{ level: 0, scale: 1000000, resolution: 20 }, { level: 1, scale: 500000, resolution: 10 }] },
    fullExtent: { xmin: -10000, ymin: -10000, xmax: 10000, ymax: 10000 } };
  let requests = 0;
  context.mock.method(globalThis, "fetch", async url => {
    requests++;
    return String(url).endsWith("?f=json") ? { ok: true, json: async () => metadata } : { status: 204 };
  });
  const loader = createTileLoader(["https://example.com/VectorTileServer"], () => {});
  await assert.rejects(loader([{ id: "ak" }], 1000000), /requires.*3338/);
  const panes = [{ id: "conus", center: [0, 0], parameters: { converter: sourceProjection(metadata) },
    element: { getBoundingClientRect: () => ({ width: 100, height: 100 }) } }];
  const datasets = await loader(panes, 1000000), requested = requests;
  assert.equal(loader.needsRefresh(panes, 1000000), true);
  loader.accept(datasets);
  assert.equal(loader.needsRefresh(panes, 1000000), false);
  assert.equal(loader.needsRefresh(panes, 500000), true);
  await loader(panes, 1000000);
  assert.equal(requests, requested);
});

test("prototype defaults and explicit inputs", () => {
  assert.deepEqual(parseOptions("").panes, ["conus", "ak", "hi", "pr"]);
  assert.equal(parseOptions("").projection, "lambert");
  const options = parseOptions("?layers=42430a34a2b44c0da678ce60ce20dd31&panes=ak,hi&projection=albers&swipe=0,1");
  assert.equal(options.layers.length, 1);
  assert.deepEqual(options.panes, ["ak", "hi"]);
  assert.deepEqual(options.swipe, ["0", "1"]);
});

test("invalid options stop before requests", () => {
  for (const search of ["?layers=bad", "?projection=mercator", "?panes=ak,ak", "?panes=", "?swipe=0", "?swipe=0,0", "?scale=NaN", "?scale=1",
    "?webmap=42430a34a2b44c0da678ce60ce20dd31&layers=42430a34a2b44c0da678ce60ce20dd31"]) {
    assert.throws(() => parseOptions(search), undefined, search);
  }
});

const marker = { type: "simple-marker", style: "circle", color: [20, 60, 80, 1] };
test("swipe resolves rendered layer IDs, portal IDs and zero-based indexes", () => {
  const datasets = [{ id: "first", layer: { portalItem: { id: "portal" } } }, { id: "second" }];
  assert.deepEqual(resolveSwipe(datasets, ["0", "second"]), datasets);
  assert.deepEqual(resolveSwipe(datasets, ["portal", "1"]), datasets);
  assert.equal(resolveSwipe(datasets, null), null);
  assert.throws(() => resolveSwipe(datasets, ["first", "0"]));
  assert.throws(() => resolveSwipe(datasets, ["first", "missing"]));
});
function fakeLayer(count = 3) {
  const calls = [];
  return { calls, type: "feature", visible: true, opacity: 0.8, objectIdField: "OID", definitionExpression: "KEEP = 1",
    sourceJSON: { maxRecordCount: 2 }, createQuery: () => ({}), queryFeatureCount: async query => {
      assert.ok(query.where.includes("KEEP = 1")); return count;
    }, queryFeatures: async query => {
      calls.push(structuredClone(query));
      return { features: Array.from({ length: Math.min(query.num, count - query.start) }, (_, index) => ({ attributes: { OID: query.start + index },
        geometry: { type: "point", x: index, y: 0 } })), exceededTransferLimit: query.start + query.num < count };
    }, queryObjectIds: async () => Array.from({ length: count }, (_, index) => index) };
}

test("one shared paginated download uses only renderer and system fields", async () => {
  const layer = fakeLayer();
  const download = createDownloader();
  const [first, second] = await Promise.all([download(layer, ["CLASS"]), download(layer, ["CLASS"])]);
  assert.equal(first, second);
  assert.equal(first.count, 3);
  assert.equal(layer.calls.length, 2);
  assert.deepEqual(layer.calls.map(query => query.start), [0, 2]);
  assert.deepEqual(layer.calls[0].outFields, ["CLASS", "OID"]);
  assert.deepEqual(layer.calls[0].outSpatialReference, { wkid: 4326 });
  assert.equal(layer.calls[0].returnGeometry, true);
  assert.equal(layer.calls[0].maxAllowableOffset, null);
  assert.equal(layer.calls[0].quantizationParameters.tolerance, 0.001);
});

test("budgets discard speculative geometry and stop vertex overflow", async () => {
  const layer = fakeLayer();
  await assert.rejects(createDownloader({ maxFeatures: 2 })(layer, []), /layer discarded/);
  assert.equal(layer.calls.length, 1);
  await assert.rejects(createDownloader({ maxVertices: 1 })(layer, []), /entire layer discarded/);
  assert.equal(layer.calls.length, 3);
});

test("service-sized pages overlap counts and resolve in stable offset order", { timeout: 2000 }, async () => {
  const layer = fakeLayer(2501), requests = [], count = Promise.withResolvers(), ready = Promise.withResolvers();
  layer.sourceJSON.maxRecordCount = 1000;
  layer.queryFeatureCount = () => count.promise;
  const loading = createDownloader({ queryFeatures: (_layer, query) => {
    const pending = Promise.withResolvers();
    requests.push({ query, pending });
    if (requests.length === 1) count.resolve(2501);
    if (requests.length === 3) ready.resolve();
    return pending.promise;
  } })(layer, []);
  await ready.promise;
  assert.deepEqual(requests.map(request => [request.query.start, request.query.num]), [[0, 1000], [1000, 1000], [2000, 1000]]);
  for (const { query, pending } of [...requests].reverse()) pending.resolve(await layer.queryFeatures(query));
  const data = await loading;
  assert.equal(data.count, 2501);
  assert.deepEqual(data.features.map(feature => feature.attributes.OID), Array.from({ length: 2501 }, (_, index) => index));
});

test("layer counts and geometry overlap while order and aggregate admission remain deterministic", { timeout: 2000 }, async () => {
  const counts = [], pending = [], reports = [];
  const countGate = Promise.withResolvers(), geometryReady = Promise.withResolvers();
  const layers = ["first", "second", "third"].map(id => ({ ...fakeLayer(1), id, title: id,
    renderer: { type: "simple", symbol: marker }, load: async () => {},
    queryObjectIds: async () => [1],
    queryFeatureCount: async () => {
      counts.push(id);
      if (counts.length === 3) countGate.resolve();
      await countGate.promise;
      return 1;
    } }));
  const loading = loadFeatures(layers, (title, reason) => reports.push({ title, reason }), async () => {}, {
    queryFeatures: layer => {
      const deferred = Promise.withResolvers();
      pending.push({ layer, deferred });
      if (pending.length === 3) geometryReady.resolve();
      return deferred.promise;
    },
  });
  await geometryReady.promise;
  assert.deepEqual(counts, ["first", "second", "third"]);
  for (const { layer, deferred } of pending.reverse()) deferred.resolve({ features: [{ attributes: { OID: 1 },
    geometry: { type: "polygon", rings: [{ length: layer.id === "third" ? 10 : 3000001 }] } }] });
  const datasets = await loading;
  assert.deepEqual(datasets.map(data => data.id), ["first", "third"]);
  assert.ok(reports.some(report => report.title === "second" && /vertex budget/.test(report.reason)));
  assert.ok(datasets.every(data => data.downloadTimings.totalMs >= data.downloadTimings.countMs));
});

test("shared services preserve hidden memberships and download the OR union once", async () => {
  let counts = 0, pages = 0;
  const memberships = [];
  const layers = [true, false].map((visible, index) => ({ ...fakeLayer(3), id: `layer${index}`, visible,
    url: index ? "https://example.com/FeatureServer/0/" : "https://example.com/FeatureServer", layerId: 0,
    definitionExpression: `CLASS = ${index}`, sourceJSON: { maxRecordCount: 2000 }, load: async () => {},
    renderer: { type: "simple", symbol: marker },
    queryFeatureCount: async query => { counts++; assert.equal(query.where, "(CLASS = 0) OR (CLASS = 1)"); return 3; },
    queryObjectIds: async query => { memberships.push(query.where); return index ? [1, 2] : [0, 1]; },
  }));
  const result = await loadFeatures(layers, () => {}, async () => {}, { queryFeatures: async (_layer, query) => {
    pages++;
    assert.equal(query.where, "(CLASS = 0) OR (CLASS = 1)");
    assert.equal(query.num, 2000);
    return { features: [0, 1, 2].map(OID => ({ attributes: { OID }, geometry: { type: "point", x: OID, y: 0 } })) };
  } });
  assert.equal(counts, 1); assert.equal(pages, 1);
  assert.deepEqual(memberships, ["CLASS = 0", "CLASS = 1"]);
  assert.deepEqual(result.map(data => data.features.map(feature => feature.attributes.OID)), [[0, 1], [1, 2]]);
  assert.equal(result[1].visible, false);
  assert.equal(result[0].features[1], result[1].features[0]);
  assert.equal(result[0].sharedDownload, result[1].sharedDownload);
});

test("singleton and all-unfiltered service groups skip membership requests", async () => {
  for (const [count, where] of [[1, "KEEP = 1"], [2, "1 = 1"]]) {
    const layers = Array.from({ length: count }, (_, index) => ({ ...fakeLayer(3), id: `layer-${index}`,
      url: "https://example.com/service/FeatureServer/0", definitionExpression: where, load: async () => {},
      renderer: { type: "simple", symbol: marker }, queryFeatureCount: async () => 3,
      queryObjectIds: async () => { assert.fail("Redundant membership request"); } }));
    const datasets = await loadFeatures(layers, () => {}, async () => {}, { queryFeatures: (_layer, query) => layers[0].queryFeatures(query) });
    assert.equal(datasets.length, count);
    for (const dataset of datasets) assert.deepEqual(dataset.features.map(feature => feature.attributes.OID), [0, 1, 2]);
    if (count === 2) assert.equal(datasets[0].features[0], datasets[1].features[0]);
  }
});

test("buffered pane footprint splits the dateline and filters every query", async () => {
  assert.deepEqual(splitBounds(170, 50, 200, 75), [[170, 50, 180, 75], [-180, 50, -160, 75]]);
  const pane = { center: [0, 0], element: { getBoundingClientRect: () => ({ width: 100, height: 100 }) },
    parameters: { converter: { inverse: ([longitude, latitude]) => [longitude / 100000 - 100, latitude / 100000 + 40] } } };
  const geometry = queryFootprint([pane], 1000000);
  assert.equal(geometry.rings.length, 1);
  assert.ok(geometry.rings[0][0][0] < -102);
  const layer = fakeLayer();
  layer.queryFeatureCount = async query => { assert.deepEqual(query.geometry, geometry); return 3; };
  await createDownloader({ geometry })(layer, []);
  for (const query of layer.calls) {
    assert.deepEqual(query.geometry, geometry);
    assert.equal(query.spatialRelationship, "intersects");
  }
});

test("groups preserve visibility opacity and scale restrictions", () => {
  const child = fakeLayer();
  const [entry] = flattenLayers([{ type: "group", visible: true, opacity: 0.5, minScale: 10000, layers: [child] }]);
  assert.equal(entry.opacity, 0.4);
  assert.equal(visibleAtScale(entry, 20000), false);
  assert.equal(visibleAtScale(entry, 10000), true);
  assert.equal(flattenLayers([{ type: "group", visible: false, layers: [child] }])[0].visible, false);
});

test("scale detail refines only beyond threshold or outside cached area", async () => {
  const geometry = { rings: [[[-120, 20], [-120, 60], [-60, 60], [-60, 20], [-120, 20]]] };
  const loaded = { geometry, scale: 24000000 };
  assert.equal(needsRefresh(loaded, geometry, 23000000), false);
  assert.equal(needsRefresh(loaded, geometry, 20000000), true);
  assert.equal(needsRefresh(loaded, geometry, 16000000), true);
  assert.equal(needsRefresh(loaded, { rings: [[[-121, 20], [-121, 60], [-60, 60], [-60, 20], [-121, 20]]] }, 24000000), true);
  const generalization = generalizationForScale(24000000);
  assert.equal(generalization, generalizationForScale(1000000) * 2 ** 4.5);
  assert.ok(generalization * 111320 <= 3175);
  assert.equal(generalizationForScale(12000000), generalization / 2);
  const layer = fakeLayer();
  await createDownloader({ generalization })(layer, []);
  assert.equal(layer.calls[0].quantizationParameters.tolerance, generalization);
});

test("query grids are canonical across view jitter and pane order", () => {
  const pane = longitude => ({ center: [0, 0], element: { getBoundingClientRect: () => ({ width: 100, height: 100 }) },
    parameters: { converter: { inverse: ([horizontal, vertical]) => [longitude + horizontal / 100000, 40 + vertical / 100000] } } });
  const first = pane(-100), second = pane(-50);
  const footprint = queryFootprint([first, second], 1000000);
  assert.deepEqual(footprint, queryFootprint([second, first], 1000000));
  first.center = [10, -10];
  assert.deepEqual(footprint, queryFootprint([first, second], 1000000));
  for (const ring of footprint.rings) for (const coordinate of ring.flat()) assert.equal(Math.abs(coordinate % 5), 0);
  for (let level = 0; level <= 12; level++) {
    const scale = 1000000 * 2 ** (level / 2);
    const tolerance = generalizationForScale(scale);
    assert.equal(tolerance, generalizationForScale(scale * 1.001));
    assert.equal(tolerance, generalizationForScale(scale * (Math.SQRT2 - 0.001)));
    assert.ok(generalizationForScale(scale / 1.001) < tolerance);
  }
  const dateline = queryFootprint([pane(179)], 1000000);
  assert.equal(dateline.rings.length, 2);
  assert.ok(dateline.rings.flat(2).every(Number.isFinite));
});

test("view quantization bounds cover the footprint and pages decode before use", async () => {
  const geometry = { rings: [[[-180, 10], [-160, 70]], [[170, 50], [180, 60]]] };
  assert.deepEqual(quantizationParameters(geometry, 0.02), { mode: "view", originPosition: "upperLeft", tolerance: 0.02,
    extent: { type: "extent", xmin: -180, ymin: 10, xmax: 180, ymax: 70, spatialReference: { wkid: 4326 } } });
  assert.throws(() => quantizationParameters(geometry, 0));
  const layer = fakeLayer(1);
  const queryFeatures = async () => ({ transform: {}, features: [{ attributes: { OID: 1 }, geometry: { type: "point", x: 20, y: 30 } }],
    unquantize() { this.features[0].geometry = { type: "point", x: -77, y: 39 }; this.transform = null; } });
  const data = await createDownloader({ geometry, queryFeatures })(layer, []);
  assert.equal(data.features[0].geometry.x, -77);
  await assert.rejects(createDownloader({ queryFeatures: async () => ({ transform: {}, features: [] }) })(layer, []), /SDK decoding/);
});

test("supported renderer boundaries and explicit refusal", () => {
  const simple = compileRenderer({ type: "simple", symbol: marker });
  assert.equal(simple.symbolFor({}), marker);
  const unique = compileRenderer({ type: "unique-value", field: "CLASS", defaultSymbol: null,
    uniqueValueInfos: [{ value: "A", symbol: marker }] });
  assert.equal(unique.symbolFor({ CLASS: "A" }), marker);
  assert.equal(unique.symbolFor({ CLASS: "B" }), null);
  const breaks = compileRenderer({ type: "class-breaks", field: "VALUE", defaultSymbol: null,
    classBreakInfos: [{ minValue: 0, maxValue: 10, symbol: marker }, { minValue: 10, maxValue: 20, symbol: { ...marker, size: 20 } }] });
  assert.equal(breaks.symbolFor({ VALUE: 10 }), marker);
  assert.equal(breaks.symbolFor({ VALUE: 11 }).size, 20);
  assert.equal(breaks.symbolFor({ VALUE: null }), null);
  assert.throws(() => compileRenderer({ type: "heatmap" }), /Unsupported/);
  assert.throws(() => compileRenderer({ type: "simple", symbol: { type: "picture-marker" } }), /Unsupported/);
  assert.throws(() => compileRenderer({ type: "simple", symbol: marker, visualVariables: [{}] }), /Unsupported/);
});

test("dateline rings stay continuous and long geographic edges are densified", () => {
  assert.deepEqual(continuousPath([[179.9, 52], [-179.9, 52]]), [[179.9, 52], [180.1, 52]]);
  const dense = densifyPath([[0, 0], [1, 0]]);
  assert.equal(dense.length, 5);
  const [polygon] = polygonParts([[[179, 51], [179, 52], [-179, 52], [-179, 51], [179, 51]]]);
  assert.ok(polygon[0].every(point => point[0] >= 179 && point[0] <= 181));
  const mesh = triangulate(polygon);
  let area = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const [first, second, third] = mesh.indices.slice(index, index + 3).map(vertex => mesh.vertices.slice(vertex * 2, vertex * 2 + 2));
    area += Math.abs((second[0] - first[0]) * (third[1] - first[1]) - (third[0] - first[0]) * (second[1] - first[1])) / 2;
  }
  assert.ok(Math.abs(area - 2) < 1e-9);
});

test("polygon triangulation preserves holes", () => {
  const [polygon] = polygonParts([[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]], [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]);
  assert.equal(polygon.length, 2);
  const mesh = triangulate(polygon);
  let area = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const [first, second, third] = mesh.indices.slice(index, index + 3).map(vertex => mesh.vertices.slice(vertex * 2, vertex * 2 + 2));
    area += Math.abs((second[0] - first[0]) * (third[1] - first[1]) - (third[0] - first[0]) * (second[1] - first[1])) / 2;
  }
  assert.ok(Math.abs(area - 12) < 1e-9);
});

test("features share one draw for each fill and outline symbol", async () => {
  const features = Array.from({ length: 40 }, (_, index) => ({ attributes: { index }, geometry: { type: "polygon",
    rings: [[[index, 0], [index, 0.1], [index + 0.1, 0.1], [index + 0.1, 0], [index, 0]]] } }));
  const symbol = { type: "simple-fill", color: [20, 40, 80, 1],
    outline: { type: "simple-line", color: [0, 0, 0, 1], width: 1 } };
  const budget = { vertices: 0, instances: 0 };
  const mesh = await prepareGeometry({ features, opacity: 1, renderer: { symbolFor: () => symbol } }, budget);
  assert.equal(mesh.draws.length, 2);
  assert.deepEqual(mesh.draws.map(draw => draw.count), [80, 160]);
  assert.deepEqual(mesh.draws.map(draw => draw.offset), [0, 80]);
  assert.equal(mesh.values.length, mesh.instances * 6);
  assert.equal(budget.instances, mesh.instances);
  for (const draw of mesh.draws) {
    assert.ok(draw.chunks.length > 1);
    assert.equal(draw.chunks.reduce((sum, chunk) => sum + chunk.count, 0), draw.count);
    for (const chunk of draw.chunks) for (let index = chunk.offset * 6; index < (chunk.offset + chunk.count) * 6; index += 2) {
      assert.ok(mesh.values[index] >= chunk.bounds[0] && mesh.values[index] <= chunk.bounds[2]);
      assert.ok(mesh.values[index + 1] >= chunk.bounds[1] && mesh.values[index + 1] <= chunk.bounds[3]);
    }
  }
});

test("culling skips offscreen chunks and merges adjacent visible ranges", () => {
  const draw = { offset: 0, count: 12, chunks: [
    { offset: 0, count: 3, projectedBounds: { conus: [0, 0, 1, 1] } },
    { offset: 3, count: 3, projectedBounds: { conus: [1, 1, 2, 2] } },
    { offset: 6, count: 3, projectedBounds: { conus: [30, 30, 40, 40] } },
    { offset: 9, count: 3, projectedBounds: { conus: [-Infinity, -Infinity, Infinity, Infinity] } },
  ] };
  assert.deepEqual(visibleRanges(draw, "conus", [0, 0, 10, 10]), [{ offset: 0, count: 6 }, { offset: 9, count: 3 }]);
  assert.deepEqual(visibleRanges(draw, "conus", [0, 0, 10, 10], false), [{ offset: 0, count: 12 }]);
});

test("union combines overlapping outers after hole assignment and preserves orphan rings", () => {
  const large = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
  const small = [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]];
  const hole = [[3, 3], [4, 3], [4, 4], [3, 4], [3, 3]];
  const orphan = hole.map(([longitude, latitude]) => [longitude + 20, latitude]);
  for (const rings of [[large, small, hole], [hole, small, large]]) {
    const diagnostics = { zeroAreaRings: 0, uncontainedHoles: 0 };
    const polygons = polygonParts([...rings, [], [[1, 1], [2, 2], [3, 3]], orphan], diagnostics);
    assert.equal(polygons.length, 2);
    assert.equal(polygons.find(polygon => polygon[0][0][0] === 0).length, 1);
    const promoted = polygons.find(polygon => polygon[0][0][0] === 23);
    assert.equal(promoted.length, 1);
    assert.equal(exactCoordinateArea(promoted), 1);
    assert.equal(exactCoordinateArea(polygons.flat()), 101);
    assert.deepEqual(diagnostics, { zeroAreaRings: 2, uncontainedHoles: 1 });
  }
  const concave = [[0, 0], [0, 5], [2, 5], [2, 2], [5, 2], [5, 0], [0, 0]];
  const diagnostics = { zeroAreaRings: 0, uncontainedHoles: 0 };
  assert.equal(polygonParts([concave, hole], diagnostics)[0].length, 1);
  assert.equal(diagnostics.uncontainedHoles, 1);
});

function exactCoordinateArea(input) {
  const bits = new DataView(new ArrayBuffer(8));
  const integer = value => {
    assert.ok(Number.isFinite(value));
    bits.setFloat64(0, value);
    const encoded = bits.getBigUint64(0), exponent = Number((encoded >> 52n) & 2047n);
    const mantissa = (encoded & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
    return (encoded >> 63n ? -mantissa : mantissa) << BigInt(exponent ? exponent - 1 : 0);
  };
  const reference = input[0]?.[0]?.[0] ?? 0;
  const rings = input.filter(ring => ring.length >= 3).map(ring => {
    let previous = reference;
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const points = ring.map(([longitude, latitude]) => {
      const turns = Math.round((previous - longitude) / 360);
      previous = longitude + turns * 360;
      bounds[0] = Math.min(bounds[0], previous); bounds[1] = Math.min(bounds[1], latitude);
      bounds[2] = Math.max(bounds[2], previous); bounds[3] = Math.max(bounds[3], latitude);
      return { coordinates: [previous, latitude], exact: [integer(longitude) + (BigInt(turns * 360) << 1074n), integer(latitude)] };
    });
    let doubled = 0n;
    for (let index = 0; index < points.length; index++) {
      const first = points[index].exact, second = points[(index + 1) % points.length].exact;
      doubled += first[0] * second[1] - second[0] * first[1];
    }
    return { points, bounds, doubled: doubled < 0n ? -doubled : doubled };
  }).filter(ring => ring.doubled !== 0n);
  const contains = (ring, point) => {
    let winding = 0;
    for (let index = 0; index < ring.points.length; index++) {
      const first = ring.points[index].exact, second = ring.points[(index + 1) % ring.points.length].exact;
      const cross = (second[0] - first[0]) * (point[1] - first[1]) - (point[0] - first[0]) * (second[1] - first[1]);
      if (cross === 0n && point[0] >= (first[0] < second[0] ? first[0] : second[0])
        && point[0] <= (first[0] > second[0] ? first[0] : second[0])
        && point[1] >= (first[1] < second[1] ? first[1] : second[1])
        && point[1] <= (first[1] > second[1] ? first[1] : second[1])) return null;
      if (first[1] <= point[1] && second[1] > point[1] && cross > 0n) winding++;
      if (first[1] > point[1] && second[1] <= point[1] && cross < 0n) winding--;
    }
    return winding !== 0;
  };
  let total = 0n;
  for (const ring of rings) {
    let depth = 0;
    for (const candidate of rings) {
      if (candidate.doubled <= ring.doubled) continue;
      if (ring.bounds[0] < candidate.bounds[0] || ring.bounds[1] < candidate.bounds[1]
        || ring.bounds[2] > candidate.bounds[2] || ring.bounds[3] > candidate.bounds[3]) continue;
      let inside = null;
      for (const point of ring.points) {
        inside = contains(candidate, point.exact);
        if (inside !== null) break;
      }
      if (inside) depth++;
    }
    total += depth % 2 ? -ring.doubled : ring.doubled;
  }
  assert.ok(total >= 0n);
  const shift = Math.max(0, total.toString(2).length - 53);
  return Number(total >> BigInt(shift)) * 2 ** (shift - 2149);
}

test("exact coordinate area is independent of triangulation, winding and ring order", () => {
  const outer = [[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]];
  const hole = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]];
  assert.equal(exactCoordinateArea([outer, hole]), 15);
  assert.equal(exactCoordinateArea([[...hole].reverse(), [...outer].reverse()]), 15);
  assert.equal(exactCoordinateArea([[[179, 0], [179, 1], [-179, 1], [-179, 0], [179, 0]]]), 2);
  assert.equal(exactCoordinateArea([[[0, 0], [1, 1], [2, 2]]]), 0);
});

test("polygon union cleans crossing and touching rings without filling holes or mutating input", () => {
  const sharedVertices = [[-135.59221164211283, 68.46635824649658], [-135.56369026230686, 68.46635824649658]];
  assert.deepEqual(continuousPath(sharedVertices), sharedVertices);
  const cases = [
    { rings: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]], area: 2 },
    { rings: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]], [[2, 0], [2, 2], [4, 2], [4, 0], [2, 0]]], area: 8 },
    { rings: [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]], [[0, 1], [2, 1], [2, 3], [0, 3], [0, 1]]], area: 12 },
    { rings: [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]], [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]], area: 12 },
  ];
  for (const { rings, area } of cases) {
    const original = structuredClone(rings);
    const polygons = polygonParts(rings);
    let triangleArea = 0;
    for (const polygon of polygons) {
      const { vertices, indices } = triangulate(polygon);
      for (let index = 0; index < indices.length; index += 3) {
        const [first, second, third] = indices.slice(index, index + 3).map(vertex => vertex * 2);
        triangleArea += Math.abs((vertices[second] - vertices[first]) * (vertices[third + 1] - vertices[first + 1])
          - (vertices[third] - vertices[first]) * (vertices[second + 1] - vertices[first + 1])) / 2;
      }
    }
    assert.equal(exactCoordinateArea(polygons.flat()), area);
    assert.equal(triangleArea, area);
    assert.deepEqual(rings, original);
  }
});

test("audit every triangulated feature against exact coordinate area", { skip: !process.env.CANVAS_AREA_FIXTURE }, () => {
  const bytes = readFileSync(process.env.CANVAS_AREA_FIXTURE);
  const report = { inputSHA256: createHash("sha256").update(bytes).digest("hex"), layers: [], differences: [] };
  for (const dataset of JSON.parse(bytes)) {
    const diagnostics = { zeroAreaRings: 0, uncontainedHoles: 0 };
    for (const feature of dataset.features) {
      let area = 0;
      for (const polygon of polygonParts(feature.geometry?.rings ?? [], diagnostics)) {
        const { vertices, indices } = triangulate(polygon);
        for (let index = 0; index < indices.length; index += 3) {
          const [first, second, third] = indices.slice(index, index + 3).map(vertex => vertex * 2);
          area += Math.abs((vertices[second] - vertices[first]) * (vertices[third + 1] - vertices[first + 1])
            - (vertices[third] - vertices[first]) * (vertices[second + 1] - vertices[first + 1])) / 2;
        }
      }
      const exactArea = exactCoordinateArea(feature.geometry?.rings ?? []);
      assert.ok(Number.isFinite(area) && Number.isFinite(exactArea));
      const percent = exactArea === 0 ? area === 0 ? 0 : Infinity : Math.abs(area - exactArea) / exactArea * 100;
      if (percent > 0.1) report.differences.push({ item: dataset.item, id: feature.id, exactArea, triangulatedArea: area, percent });
    }
    report.layers.push({ item: dataset.item, features: dataset.features.length, ...diagnostics });
  }
  console.log("AREA AUDIT", JSON.stringify(report));
});

test("CPU bounds use actual float vertices, cache repeats, and fail open at projection seams", () => {
  let calls = 0;
  const parameters = { definition: { kind: "albers", centralMeridian: 0 }, converter: { forward: ([longitude, latitude]) => {
    calls++; return [longitude * 1000, (latitude + longitude * longitude) * 1000];
  } } };
  const chunk = { offset: 1, count: 1 };
  projectChunkBounds(new Float32Array([99, 99, 99, 99, 99, 99, 1, 2, 1, 2, 3, 4]), [chunk], [{ id: "test", parameters }]);
  assert.deepEqual(chunk.projectedBounds.test, [968, 2968, 3032, 13032]);
  assert.equal(calls, 2);
  const seam = { offset: 0, count: 1 };
  projectChunkBounds(new Float32Array([180, 0, 0, 0, 0, 0]), [seam], [{ id: "test", parameters }]);
  assert.deepEqual(seam.projectedBounds.test, [-Infinity, -Infinity, Infinity, Infinity]);
  for (const projection of Object.values(projections)) {
    const definition = projection.conus;
    const origin = { offset: 0, count: 1 };
    const values = new Float32Array(Array(3).fill([definition.centralMeridian, definition.latitudeOfOrigin]).flat());
    projectChunkBounds(values, [origin], [{ id: "conus", parameters: projectionParameters(definition) }]);
    assert.ok(origin.projectedBounds.conus.every(Number.isFinite));
    assert.ok(origin.projectedBounds.conus[0] <= 0 && origin.projectedBounds.conus[2] >= 0);
    assert.ok(origin.projectedBounds.conus[1] <= 0 && origin.projectedBounds.conus[3] >= 0);
  }
});
