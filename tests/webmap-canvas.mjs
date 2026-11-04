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
      assert.equal(query.where, "KEEP = 1"); return count;
    }, queryFeatures: async query => {
      calls.push(structuredClone(query));
      return { features: Array.from({ length: query.num }, (_, index) => ({ attributes: { OID: query.start + index },
        geometry: { type: "point", x: index, y: 0 } })), exceededTransferLimit: query.start + query.num < count };
    } };
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

test("budgets refuse before geometry and stop vertex overflow", async () => {
  const layer = fakeLayer();
  await assert.rejects(createDownloader({ maxFeatures: 2 })(layer, []), /geometry not downloaded/);
  assert.equal(layer.calls.length, 0);
  await assert.rejects(createDownloader({ maxVertices: 1 })(layer, []), /entire layer discarded/);
  assert.equal(layer.calls.length, 1);
});

test("layer counts and geometry overlap while order and aggregate admission remain deterministic", { timeout: 2000 }, async () => {
  const counts = [], pending = [], reports = [];
  const countGate = Promise.withResolvers(), geometryReady = Promise.withResolvers();
  const layers = ["first", "second", "third"].map(id => ({ ...fakeLayer(1), id, title: id,
    renderer: { type: "simple", symbol: marker }, load: async () => {},
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

test("holes use the smallest containing clockwise ring; orphan rings become outers", () => {
  const large = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
  const small = [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]];
  const hole = [[3, 3], [4, 3], [4, 4], [3, 4], [3, 3]];
  const orphan = hole.map(([longitude, latitude]) => [longitude + 20, latitude]);
  for (const rings of [[large, small, hole], [hole, small, large]]) {
    const diagnostics = { zeroAreaRings: 0, uncontainedHoles: 0 };
    const polygons = polygonParts([...rings, [], [[1, 1], [2, 2], [3, 3]], orphan], diagnostics);
    assert.equal(polygons.length, 3);
    assert.equal(polygons.find(polygon => polygon[0][0][0] === 2).length, 2);
    assert.equal(polygons.find(polygon => polygon[0][0][0] === 0).length, 1);
    const promoted = polygons.find(polygon => polygon[0][0][0] === 23);
    assert.equal(promoted.length, 1);
    assert.deepEqual(promoted[0], densifyPath([...orphan].reverse()));
    assert.deepEqual(diagnostics, { zeroAreaRings: 2, uncontainedHoles: 1 });
  }
  const concave = [[0, 0], [0, 5], [2, 5], [2, 2], [5, 2], [5, 0], [0, 0]];
  const diagnostics = { zeroAreaRings: 0, uncontainedHoles: 0 };
  assert.equal(polygonParts([concave, hole], diagnostics)[0].length, 1);
  assert.equal(diagnostics.uncontainedHoles, 1);
});

test("audit per-feature area against a captured pre-change baseline", { skip: !process.env.CANVAS_AREA_FIXTURE }, () => {
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
      assert.ok(Number.isFinite(area) && Number.isFinite(feature.area));
      const percent = feature.area === 0 ? area === 0 ? 0 : Infinity : Math.abs(area - feature.area) / feature.area * 100;
      if (percent > 0.1) report.differences.push({ item: dataset.item, id: feature.id, oldArea: feature.area, newArea: area, percent });
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
