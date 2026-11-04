import assert from "node:assert/strict";
import test from "node:test";
import { parseOptions } from "../experiments/webmap-canvas/config.js";
import { createDownloader, flattenLayers, visibleAtScale } from "../experiments/webmap-canvas/data.js";
import { compileRenderer } from "../experiments/webmap-canvas/renderers.js";
import { continuousPath, densifyPath, polygonParts, triangulate } from "../experiments/webmap-canvas/geometry.js";

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
  assert.equal(layer.calls[0].maxAllowableOffset, 0.001);
});

test("budgets refuse before geometry and stop vertex overflow", async () => {
  const layer = fakeLayer();
  await assert.rejects(createDownloader({ maxFeatures: 2 })(layer, []), /geometry not downloaded/);
  assert.equal(layer.calls.length, 0);
  await assert.rejects(createDownloader({ maxVertices: 1 })(layer, []), /entire layer discarded/);
  assert.equal(layer.calls.length, 1);
});

test("groups preserve visibility opacity and scale restrictions", () => {
  const child = fakeLayer();
  const [entry] = flattenLayers([{ type: "group", visible: true, opacity: 0.5, minScale: 10000, layers: [child] }]);
  assert.equal(entry.opacity, 0.4);
  assert.equal(visibleAtScale(entry, 20000), false);
  assert.equal(visibleAtScale(entry, 10000), true);
  assert.equal(flattenLayers([{ type: "group", visible: false, layers: [child] }])[0].visible, false);
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
