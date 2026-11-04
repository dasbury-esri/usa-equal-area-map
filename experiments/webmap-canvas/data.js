import { compileRenderer } from "./renderers.js";

export const MAX_FEATURES = 50000;
export const MAX_VERTICES = 4000000;
export const MAX_TOTAL_VERTICES = 6000000;
export const GENERALIZATION_DEGREES = 0.001;
export const PAGE_SIZE = 500;

const asArray = collection => collection?.toArray ? collection.toArray() : collection ?? [];

export function quantizationParameters(geometry, tolerance) {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("Invalid quantization tolerance");
  const extent = { type: "extent", xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity,
    spatialReference: { wkid: 4326 } };
  for (const ring of geometry?.rings ?? [[[-180, -90], [180, 90]]]) for (const [longitude, latitude] of ring) {
    extent.xmin = Math.min(extent.xmin, longitude); extent.ymin = Math.min(extent.ymin, latitude);
    extent.xmax = Math.max(extent.xmax, longitude); extent.ymax = Math.max(extent.ymax, latitude);
  }
  if (![extent.xmin, extent.ymin, extent.xmax, extent.ymax].every(Number.isFinite)) throw new Error("Invalid quantization extent");
  return { mode: "view", originPosition: "upperLeft", tolerance, extent };
}

export function flattenLayers(layers, inherited = { visible: true, opacity: 1, ranges: [] }, ignoreVisibility = false) {
  return asArray(layers).flatMap(layer => {
    const properties = { visible: inherited.visible && (ignoreVisibility || layer.visible !== false),
      opacity: inherited.opacity * (layer.opacity ?? 1),
      ranges: [...inherited.ranges, { minScale: layer.minScale ?? 0, maxScale: layer.maxScale ?? 0 }] };
    if (layer.type === "group") {
      const children = asArray(layer.layers);
      return flattenLayers(children, properties, layer.visibilityMode === "inherited");
    }
    return [{ layer, ...properties, inheritedOpacity: inherited.opacity, ignoreVisibility }];
  });
}

export function visibleAtScale(entry, scale) {
  return entry.visible && entry.ranges.every(range => (!range.minScale || scale <= range.minScale)
    && (!range.maxScale || scale >= range.maxScale));
}

export function vertexCount(geometry) {
  if (!geometry) return 0;
  if (geometry.type === "point" || ("x" in geometry && "y" in geometry)) return 1;
  if (geometry.points) return geometry.points.length;
  return (geometry.rings ?? geometry.paths ?? []).reduce((sum, part) => sum + part.length, 0);
}

export function createDownloader({ maxFeatures = MAX_FEATURES, maxVertices = MAX_VERTICES,
  geometry, generalization = GENERALIZATION_DEGREES,
  queryFeatures = (layer, query) => layer.queryFeatures(query) } = {}) {
  const downloads = new WeakMap();
  return function download(layer, fields) {
    if (downloads.has(layer)) return downloads.get(layer);
    const result = (async () => {
      const startedMs = performance.now();
      const query = layer.createQuery();
      query.where = layer.definitionExpression || query.where || "1=1";
      if (geometry) { query.geometry = geometry; query.spatialRelationship = "intersects"; }
      const count = await layer.queryFeatureCount(query);
      const countedMs = performance.now();
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid feature count");
      if (count > maxFeatures) throw new Error(`Feature budget exceeded: ${count} > ${maxFeatures}; geometry not downloaded`);
      const features = [];
      let vertices = 0;
      let pages = 0;
      const objectIdField = layer.objectIdField;
      if (!objectIdField) throw new Error("Missing object ID field; cannot verify pagination");
      const pageSize = Math.min(PAGE_SIZE, layer.sourceJSON?.maxRecordCount ?? PAGE_SIZE);
      const pagination = layer.capabilities?.query?.supportsPagination !== false;
      const ids = pagination ? null : await layer.queryObjectIds(query);
      if (ids && ids.length !== count) throw new Error("Feature count changed during preflight");
      const seen = new Set();
      query.outFields = [...new Set([...fields, objectIdField])];
      query.outSpatialReference = { wkid: 4326 };
      query.returnGeometry = true;
      query.returnZ = false;
      query.returnM = false;
      query.maxAllowableOffset = null;
      query.quantizationParameters = quantizationParameters(geometry, generalization);
      if (pagination) query.orderByFields = [`${objectIdField} ASC`];
      while (features.length < count) {
        if (pagination) { query.start = features.length; query.num = Math.min(pageSize, count - features.length); }
        else query.objectIds = ids.slice(features.length, features.length + pageSize);
        const page = await queryFeatures(layer, query);
        if (page.transform) {
          if (typeof page.unquantize !== "function") throw new Error("Quantized geometry requires SDK decoding");
          page.unquantize();
        }
        pages++;
        if (!page.features?.length) throw new Error("Pagination stopped before the preflight count");
        for (const feature of page.features) {
          const id = feature.attributes[objectIdField];
          if (id == null || seen.has(id)) throw new Error("Missing or duplicate object ID during pagination");
          seen.add(id);
          const geometry = feature.geometry;
          if (geometry && !["point", "multipoint", "polyline", "polygon"].includes(geometry.type)) throw new Error(`Unsupported geometry: ${geometry.type}`);
          vertices += vertexCount(geometry);
          if (vertices > maxVertices) throw new Error(`Vertex budget exceeded: ${vertices} > ${maxVertices}; entire layer discarded`);
          features.push(feature);
          if (features.length > maxFeatures || features.length > count) throw new Error("Feature budget/count changed during download");
        }
        if (features.length === count && page.exceededTransferLimit) throw new Error("Count changed or transfer limit unresolved");
      }
      const finishedMs = performance.now();
      return { features, vertices, pages, count, outFields: query.outFields, generalization,
        downloadTimings: { startedMs, countMs: countedMs - startedMs, geometryMs: finishedMs - countedMs,
          totalMs: finishedMs - startedMs } };
    })();
    downloads.set(layer, result);
    return result;
  };
}

export async function loadFeatures(layers, report, checkPublicItem, options = {}) {
  const executeQueryJSON = options.queryFeatures ? null : (await import("@arcgis/core/rest/query.js")).executeQueryJSON;
  const download = createDownloader({ ...options, queryFeatures: options.queryFeatures ?? ((layer, query) => {
    const url = new URL(layer.url);
    if (!/\/\d+\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, "")}/${layer.layerId}`;
    return executeQueryJSON(url.href, query);
  }) });
  const completed = await Promise.all(flattenLayers(layers).map(async entry => {
    const { layer } = entry;
    const title = layer.title || layer.id;
    if (layer.type !== "feature") { report(title, `Skipped unsupported layer type: ${layer.type}`); return null; }
    if (!entry.visible) { report(title, "Skipped invisible layer"); return null; }
    if (layer.portalItem?.id) await checkPublicItem(layer.portalItem.id);
    try {
      await layer.load();
    } catch (error) {
      throw new Error(`${title}: public layer load failed; authentication is unsupported. ${error.message}`, { cause: error });
    }
    entry.ranges[entry.ranges.length - 1] = { minScale: layer.minScale, maxScale: layer.maxScale };
    entry.opacity = entry.inheritedOpacity * (layer.opacity ?? 1);
    if (!entry.ignoreVisibility && layer.visible === false) { report(title, "Skipped invisible loaded layer"); return null; }
    try {
      if (layer.featureReduction || layer.effect || layer.featureEffect) throw new Error("Unsupported aggregation or effect");
      if (layer.blendMode && layer.blendMode !== "normal") throw new Error(`Unsupported blend mode: ${layer.blendMode}`);
      const renderer = compileRenderer(layer.renderer);
      const data = await download(layer, renderer.fields);
      return { ...entry, ...data, renderer, id: layer.id, title };
    } catch (error) {
      if ([401, 403, 498, 499].includes(error.details?.httpStatus ?? error.details?.raw?.code)
        || /token|credential|unauthoriz|authenticat/i.test(error.message)) throw error;
      report(title, `Rejected: ${error.message}`);
      return null;
    }
  }));
  const datasets = [];
  let totalVertices = 0;
  for (const data of completed) {
    if (!data) continue;
    if (totalVertices + data.vertices > MAX_TOTAL_VERTICES) {
      report(data.title, "Rejected: Page vertex budget exceeded; layer discarded");
      continue;
    }
    totalVertices += data.vertices;
    datasets.push(data);
    report(data.title, `${data.count} features, ${data.vertices} vertices, ${data.pages} geometry pages`);
  }
  return datasets;
}
