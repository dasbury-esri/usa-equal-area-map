import { compileRenderer } from "./renderers.js";

export const MAX_FEATURES = 50000;
export const MAX_VERTICES = 4000000;
export const MAX_TOTAL_VERTICES = 6000000;
export const GENERALIZATION_DEGREES = 0.001;
export const PAGE_SIZE = 500;

const asArray = collection => collection?.toArray ? collection.toArray() : collection ?? [];

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
      const query = layer.createQuery();
      query.where = layer.definitionExpression || query.where || "1=1";
      if (geometry) { query.geometry = geometry; query.spatialRelationship = "intersects"; }
      const count = await layer.queryFeatureCount(query);
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
      query.maxAllowableOffset = generalization;
      if (pagination) query.orderByFields = [`${objectIdField} ASC`];
      while (features.length < count) {
        if (pagination) { query.start = features.length; query.num = Math.min(pageSize, count - features.length); }
        else query.objectIds = ids.slice(features.length, features.length + pageSize);
        const page = await queryFeatures(layer, query);
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
      return { features, vertices, pages, count, outFields: query.outFields, generalization };
    })();
    downloads.set(layer, result);
    return result;
  };
}

export async function loadFeatures(layers, report, checkPublicItem, options = {}) {
  const { executeQueryJSON } = await import("@arcgis/core/rest/query.js");
  const download = createDownloader({ ...options, queryFeatures: (layer, query) => {
    const url = new URL(layer.url);
    if (!/\/\d+\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, "")}/${layer.layerId}`;
    return executeQueryJSON(url.href, query);
  } });
  const datasets = [];
  let totalVertices = 0;
  for (const entry of flattenLayers(layers)) {
    const { layer } = entry;
    const title = layer.title || layer.id;
    if (layer.type !== "feature") { report(title, `Skipped unsupported layer type: ${layer.type}`); continue; }
    if (!entry.visible) { report(title, "Skipped invisible layer"); continue; }
    if (layer.portalItem?.id) await checkPublicItem(layer.portalItem.id);
    try {
      await layer.load();
    } catch (error) {
      throw new Error(`${title}: public layer load failed; authentication is unsupported. ${error.message}`, { cause: error });
    }
    entry.ranges[entry.ranges.length - 1] = { minScale: layer.minScale, maxScale: layer.maxScale };
    entry.opacity = entry.inheritedOpacity * (layer.opacity ?? 1);
    if (!entry.ignoreVisibility && layer.visible === false) { report(title, "Skipped invisible loaded layer"); continue; }
    try {
      if (layer.featureReduction || layer.effect || layer.featureEffect) throw new Error("Unsupported aggregation or effect");
      if (layer.blendMode && layer.blendMode !== "normal") throw new Error(`Unsupported blend mode: ${layer.blendMode}`);
      const renderer = compileRenderer(layer.renderer);
      const data = await download(layer, renderer.fields);
      if (totalVertices + data.vertices > MAX_TOTAL_VERTICES) throw new Error("Page vertex budget exceeded; layer discarded");
      totalVertices += data.vertices;
      datasets.push({ ...entry, ...data, renderer, id: layer.id, title });
      report(title, `${data.count} features, ${data.vertices} vertices, ${data.pages} geometry pages`);
    } catch (error) {
      if ([401, 403, 498, 499].includes(error.details?.httpStatus ?? error.details?.raw?.code)
        || /token|credential|unauthoriz|authenticat/i.test(error.message)) throw error;
      report(title, `Rejected: ${error.message}`);
    }
  }
  return datasets;
}
