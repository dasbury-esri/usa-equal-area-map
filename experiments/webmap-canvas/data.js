import { compileRenderer } from "./renderers.js";

export const MAX_FEATURES = 50000;
export const MAX_VERTICES = 4000000;
export const MAX_TOTAL_VERTICES = 6000000;
export const GENERALIZATION_DEGREES = 0.001;

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
      const features = [];
      let vertices = 0;
      let pages = 0;
      const objectIdField = layer.objectIdField;
      if (!objectIdField) throw new Error("Missing object ID field; cannot verify pagination");
      const pageSize = layer.sourceJSON?.maxRecordCount;
      if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error("Missing or invalid service maxRecordCount");
      const pagination = layer.capabilities?.query?.supportsPagination !== false;
      const counted = layer.queryFeatureCount(query.clone?.() ?? structuredClone(query));
      const identified = pagination ? null : layer.queryObjectIds(query.clone?.() ?? structuredClone(query));
      const seen = new Set();
      query.outFields = [...new Set([...fields, objectIdField])];
      query.outSpatialReference = { wkid: 4326 };
      query.returnGeometry = true;
      query.returnZ = false;
      query.returnM = false;
      query.maxAllowableOffset = null;
      query.quantizationParameters = quantizationParameters(geometry, generalization);
      if (pagination) query.orderByFields = [`${objectIdField} ASC`];
      const requestPage = (start, ids) => {
        const request = query.clone?.() ?? structuredClone(query);
        if (pagination) { request.start = start; request.num = pageSize; }
        else request.objectIds = ids.slice(start, start + pageSize);
        return queryFeatures(layer, request).then(page => ({ page }), error => ({ error }));
      };
      const first = pagination ? requestPage(0) : null;
      const [count, ids] = await Promise.all([counted, identified]);
      const countedMs = performance.now();
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid feature count");
      if (count > maxFeatures) throw new Error(`Feature budget exceeded: ${count} > ${maxFeatures}; layer discarded`);
      if (ids && ids.length !== count) throw new Error("Feature count changed during preflight");
      const pending = first ? [first] : [];
      for (let start = first ? pageSize : 0; start < count; start += pageSize) pending.push(requestPage(start, ids));
      for (const result of await Promise.all(pending)) {
        if (result.error) throw result.error;
        const { page } = result;
        if (page.transform) {
          if (typeof page.unquantize !== "function") throw new Error("Quantized geometry requires SDK decoding");
          page.unquantize();
        }
        pages++;
        if (!page.features?.length && count) throw new Error("Pagination stopped before the preflight count");
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
      if (features.length !== count) throw new Error("Pagination stopped before the preflight count");
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
  const rest = options.queryFeatures ? null : await import("@arcgis/core/rest/query.js");
  const serviceURL = layer => {
    if (!layer.url) return layer;
    const url = new URL(layer.url);
    if (!/\/\d+\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, "")}/${layer.layerId}`;
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.href;
  };
  const download = createDownloader({ ...options, queryFeatures: options.queryFeatures ?? ((layer, query) => rest.executeQueryJSON(layer.url, query)) });
  const entries = await Promise.all(flattenLayers(layers).map(async entry => {
    const { layer } = entry;
    const title = layer.title || layer.id;
    if (layer.type !== "feature") { report(title, `Skipped unsupported layer type: ${layer.type}`); return null; }
    if (layer.portalItem?.id) await checkPublicItem(layer.portalItem.id);
    try {
      await layer.load();
    } catch (error) {
      throw new Error(`${title}: public layer load failed; authentication is unsupported. ${error.message}`, { cause: error });
    }
    entry.ranges[entry.ranges.length - 1] = { minScale: layer.minScale, maxScale: layer.maxScale };
    entry.opacity = entry.inheritedOpacity * (layer.opacity ?? 1);
    if (!entry.ignoreVisibility && layer.visible === false) entry.visible = false;
    entry.title = title;
    try {
      if (layer.featureReduction || layer.effect || layer.featureEffect) throw new Error("Unsupported aggregation or effect");
      entry.renderer = compileRenderer(layer.renderer);
      entry.blendMode = layer.blendMode ?? "normal";
      if (entry.blendMode !== "normal" && !(entry.blendMode === "multiply" && entry.renderer.fillOnly)) {
        entry.renderer = null;
        throw new Error(`Unsupported blend mode for these symbols: ${entry.blendMode}`);
      }
    } catch (error) {
      if ([401, 403, 498, 499].includes(error.details?.httpStatus ?? error.details?.raw?.code)
        || /token|credential|unauthoriz|authenticat/i.test(error.message)) throw error;
      entry.rejection = error.message;
    }
    return entry;
  }));
  const groups = new Map();
  for (const entry of entries.filter(Boolean)) {
    const key = serviceURL(entry.layer);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const completed = new Map();
  await Promise.all([...groups].map(async ([url, members]) => {
    const layer = members[0].layer;
    const queries = members.map(entry => {
      const query = entry.layer.createQuery();
      query.where = entry.layer.definitionExpression || query.where || "1=1";
      if (options.geometry) { query.geometry = options.geometry; query.spatialRelationship = "intersects"; }
      return query;
    });
    const where = [...new Set(queries.map(query => `(${query.where})`))].sort().join(" OR ");
    const needsMembership = members.length > 1 && !queries.every(query => query.where.replace(/\s/g, "") === "1=1");
    const shared = { id: layer.id, url, objectIdField: layer.objectIdField, sourceJSON: layer.sourceJSON,
      capabilities: layer.capabilities, definitionExpression: where, createQuery: () => queries[0].clone?.() ?? structuredClone(queries[0]),
      queryFeatureCount: query => options.queryFeatures ? layer.queryFeatureCount(query) : rest.executeForCount(url, query),
      queryObjectIds: query => options.queryFeatures ? layer.queryObjectIds(query) : rest.executeForIds(url, query) };
    try {
      const [memberships, data] = await Promise.all([
        needsMembership ? Promise.all(members.map((entry, index) => entry.layer.queryObjectIds(queries[index].clone?.() ?? structuredClone(queries[index])))) : null,
        download(shared, members.flatMap(entry => entry.renderer?.fields ?? [])),
      ]);
      const byId = new Map(data.features.map(feature => [feature.attributes[layer.objectIdField], feature]));
      const selectedIds = memberships ?? members.map(() => [...byId.keys()]);
      const union = new Set(selectedIds.flat());
      if (union.size !== byId.size || [...union].some(id => !byId.has(id))) throw new Error("Layer membership changed during shared download");
      if (selectedIds.some(ids => new Set(ids).size !== ids.length)) throw new Error("Duplicate layer membership IDs");
      members.forEach((entry, index) => {
        const ids = selectedIds[index];
        const features = ids.map(id => byId.get(id));
        completed.set(entry, { ...entry, ...data, id: entry.layer.id, features, count: features.length,
          vertices: features.reduce((sum, feature) => sum + vertexCount(feature.geometry), 0), sharedDownload: data });
      });
    } catch (error) {
      if ([401, 403, 498, 499].includes(error.details?.httpStatus ?? error.details?.raw?.code)
        || /token|credential|unauthoriz|authenticat/i.test(error.message)) throw error;
      for (const entry of members) report(entry.title, `Rejected: ${error.message}`);
    }
  }));
  const datasets = [];
  let totalVertices = 0;
  const admitted = new Set();
  for (const entry of entries) {
    const data = completed.get(entry);
    if (!data) continue;
    if (!data.renderer) { report(data.title, `Rejected: ${data.rejection}`); continue; }
    const addedVertices = admitted.has(data.sharedDownload) ? 0 : data.sharedDownload.vertices;
    if (totalVertices + addedVertices > MAX_TOTAL_VERTICES) {
      report(data.title, "Rejected: Page vertex budget exceeded; layer discarded");
      continue;
    }
    totalVertices += addedVertices;
    admitted.add(data.sharedDownload);
    datasets.push(data);
    report(data.title, `${data.count} features, ${data.vertices} vertices, ${data.pages} geometry pages`);
  }
  return datasets;
}
