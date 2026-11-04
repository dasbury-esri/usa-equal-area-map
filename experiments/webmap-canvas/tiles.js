import proj4 from "proj4";
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import polygonClipping from "polygon-clipping";
import { clipPolyline } from "lineclip";

export const TILE_CRS = Object.freeze({
  5070: "+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs",
  3338: "+proj=aea +lat_1=55 +lat_2=65 +lat_0=50 +lon_0=-154 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs",
});

const mercatorRadius = 6378137;
const mercatorLimit = Math.atan(Math.sinh(Math.PI)) * 180 / Math.PI;
const isMercator = (metadata) => {
  const reference = metadata.tileInfo.spatialReference;
  return [3857, 102100, 102113, 900913].includes(
    reference.latestWkid ?? reference.wkid,
  );
};

export function sourceProjection(metadata) {
  if (isMercator(metadata))
    return {
      forward: ([longitude, latitude]) => [
        mercatorRadius * longitude * Math.PI / 180,
        mercatorRadius * Math.asinh(Math.tan(
          Math.max(-mercatorLimit, Math.min(mercatorLimit, latitude)) * Math.PI / 180,
        )),
      ],
      inverse: ([horizontal, vertical]) => [
        horizontal / mercatorRadius * 180 / Math.PI,
        Math.atan(Math.sinh(vertical / mercatorRadius)) * 180 / Math.PI,
      ],
    };
  const reference = metadata.tileInfo.spatialReference;
  const definition =
    reference.wkt || TILE_CRS[reference.latestWkid ?? reference.wkid];
  if (!definition) throw new Error(`Unsupported tile CRS: ${reference.wkid}`);
  return proj4("EPSG:4326", definition);
}

export function tileCoordinate(info, lod, column, row, extent, point) {
  return [
    info.origin.x + (column + point[0] / extent) * info.cols * lod.resolution,
    info.origin.y - (row + point[1] / extent) * info.rows * lod.resolution,
  ];
}

export function decodeTile(bytes, metadata, lod, column, row) {
  const tile = new VectorTile(new PbfReader(bytes)),
    converter = sourceProjection(metadata),
    features = [];
  for (const [name, layer] of Object.entries(tile.layers))
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index),
        extent = feature.extent;
      const project = (point) =>
        converter.inverse(
          tileCoordinate(metadata.tileInfo, lod, column, row, extent, point),
        );
      const parts = feature.loadGeometry();
      const attributes = {
        ...feature.properties,
        tileLayer: name,
        tileFeatureId: feature.id,
      };
      const add = (geometry, boundaryPaths) => {
        const coordinates = geometry.rings ??
          geometry.paths ?? [geometry.points];
        if (!coordinates.flat(2).every(Number.isFinite))
          throw new Error("Nonfinite reprojected tile geometry");
        features.push({
          attributes: { ...attributes },
          geometry,
          boundaryPaths,
        });
      };
      if (feature.type === 3) {
        const polygons = classifyRings(parts).map((polygon) =>
          polygon.map((ring) => ring.map((point) => [point.x, point.y])),
        );
        const clipped = polygonClipping.intersection(polygons, [
          [
            [0, 0],
            [extent, 0],
            [extent, extent],
            [0, extent],
            [0, 0],
          ],
        ]);
        for (const polygon of clipped) {
          const boundaryPaths = polygon.flatMap((ring) =>
            ring.slice(1).flatMap((finish, index) => {
              const start = ring[index];
              if (
                [0, 1].some(
                  (axis) =>
                    start[axis] === finish[axis] &&
                    [0, extent].includes(start[axis]),
                )
              )
                return [];
              return [[project(start), project(finish)]];
            }),
          );
          add(
            {
              type: "polygon",
              rings: polygon.map((ring) => ring.map(project)),
            },
            boundaryPaths,
          );
        }
      } else if (feature.type === 2) {
        const paths = parts
          .flatMap((part) =>
            clipPolyline(
              part.map((point) => [point.x, point.y]),
              [0, 0, extent, extent],
            ),
          )
          .filter(
            (path) =>
              !path.every((point) => point[0] === extent) &&
              !path.every((point) => point[1] === extent),
          );
        if (paths.length)
          add({
            type: "polyline",
            paths: paths.map((path) => path.map(project)),
          });
      } else if (feature.type === 1) {
        const points = parts
          .flat()
          .filter(
            (point) =>
              point.x >= 0 &&
              point.x < extent &&
              point.y >= 0 &&
              point.y < extent,
          )
          .map((point) => project([point.x, point.y]));
        if (points.length) add({ type: "multipoint", points });
      }
    }
  return features;
}

export function paneTiles(pane, scale, metadata) {
  const converter = sourceProjection(metadata),
    info = metadata.tileInfo,
    mercator = isMercator(metadata),
    center = pane.parameters.converter.inverse(pane.center),
    latitudeFactor = Math.cos(Math.max(-mercatorLimit, Math.min(mercatorLimit, center[1])) * Math.PI / 180);
  const lod =
    info.lods.find((level) => mercator
      ? level.resolution * latitudeFactor <= scale * 0.0254 / 96
      : level.scale <= scale) ?? info.lods.at(-1);
  const bounds = pane.element.getBoundingClientRect(),
    resolution = (scale * 0.0254) / 96;
  const extent = [Infinity, Infinity, -Infinity, -Infinity];
  for (let horizontal = 0; horizontal <= 16; horizontal++)
    for (let vertical = 0; vertical <= 16; vertical++) {
      const geographic = pane.parameters.converter.inverse([
        pane.center[0] + (horizontal / 16 - 0.5) * bounds.width * resolution,
        pane.center[1] + (vertical / 16 - 0.5) * bounds.height * resolution,
      ]);
      if (mercator)
        geographic[0] = center[0] + ((geographic[0] - center[0] + 180) % 360 + 360) % 360 - 180;
      const point = converter.forward(geographic);
      if (!point.every(Number.isFinite))
        throw new Error(
          "Tile footprint crosses an invalid source projection domain",
        );
      extent[0] = Math.min(extent[0], point[0]);
      extent[1] = Math.min(extent[1], point[1]);
      extent[2] = Math.max(extent[2], point[0]);
      extent[3] = Math.max(extent[3], point[1]);
    }
  const width = info.cols * lod.resolution,
    height = info.rows * lod.resolution,
    full = metadata.fullExtent;
  const firstColumn = Math.floor(
    ((mercator ? extent[0] - width : Math.max(full.xmin, extent[0] - width)) - info.origin.x) / width,
  );
  const lastColumn = Math.floor(
    ((mercator ? extent[2] + width : Math.min(full.xmax, extent[2] + width)) - info.origin.x) / width,
  );
  let firstRow = Math.floor(
    (info.origin.y - Math.min(full.ymax, extent[3] + height)) / height,
  );
  let lastRow = Math.floor(
    (info.origin.y - Math.max(full.ymin, extent[1] - height)) / height,
  );
  const columns = Math.round(2 * Math.PI * mercatorRadius / width);
  if (mercator) {
    firstRow = Math.max(0, firstRow);
    lastRow = Math.min(lastRow, Math.round(2 * Math.PI * mercatorRadius / height) - 1);
  }
  if ((lastColumn - firstColumn + 1) * (lastRow - firstRow + 1) > 256)
    throw new Error("Tile footprint exceeds 256-tile pane budget");
  const tiles = [], seen = new Set();
  for (let row = firstRow; row <= lastRow; row++)
    for (let column = firstColumn; column <= lastColumn; column++) {
      const wrapped = mercator ? ((column % columns) + columns) % columns : column;
      const key = `${row}/${wrapped}`;
      if (!seen.has(key)) tiles.push({ lod, row, column: wrapped });
      seen.add(key);
    }
  return tiles;
}

export function createTileLoader(urls, report) {
  const metadata = new Map(),
    resolved = new Map(),
    cache = new Map();
  const sourceURL = (pane) => {
    const expected = pane.id === "ak" ? 3338 : 5070;
    const url = urls.find((candidate) => {
      const reference = resolved.get(candidate)?.tileInfo.spatialReference;
      return (
        (reference?.latestWkid ?? reference?.wkid) === expected ||
        (expected === 3338 && reference?.wkid === 102006)
      );
    }) ?? urls.find((candidate) => resolved.has(candidate) && isMercator(resolved.get(candidate)));
    if (!url)
      throw new Error(
        `Pane ${pane.id} requires EPSG:${expected} or Web Mercator tiles`,
      );
    return url;
  };
  const signature = (panes, scale) =>
    JSON.stringify(
      panes.map((pane) => {
        const url = sourceURL(pane),
          source = resolved.get(url);
        return [
          pane.id,
          url,
          source
            ? paneTiles(pane, scale, source).map((tile) => [
                tile.lod.level,
                tile.row,
                tile.column,
              ])
            : null,
        ];
      }),
    );
  const json = async (url) => {
    const response = await fetch(url, {
      credentials: "omit",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Tile metadata HTTP ${response.status}`);
    const value = await response.json();
    if (value.error || value.tileInfo?.format !== "pbf")
      throw new Error("Invalid vector tile metadata");
    sourceProjection(value);
    return value;
  };
  const load = async (panes, scale) => {
    await Promise.all(
      urls.map(async (url) => {
        if (!metadata.has(url))
          metadata.set(
            url,
            json(`${url}?f=json`).catch((error) => {
              metadata.delete(url);
              throw error;
            }),
          );
        resolved.set(url, await metadata.get(url));
      }),
    );
    const datasets = await Promise.all(
      panes.map(async (pane) => {
        const url = sourceURL(pane);
        const source = resolved.get(url),
          selected = paneTiles(pane, scale, source);
        let missing = 0;
        const groups = await Promise.all(
          selected.map(async ({ lod, row, column }) => {
            const key = `${url}/tile/${lod.level}/${row}/${column}.pbf`;
            if (!cache.has(key)) {
              const pending = (async () => {
                const response = await fetch(key, {
                  credentials: "omit",
                  signal: AbortSignal.timeout(30000),
                });
                if (response.status === 404 || response.status === 204)
                  return null;
                if (!response.ok)
                  throw new Error(`Tile HTTP ${response.status}: ${key}`);
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (bytes.length > 16000000)
                  throw new Error("Tile byte budget exceeded");
                return decodeTile(bytes, source, lod, column, row);
              })().catch((error) => {
                cache.delete(key);
                throw error;
              });
              cache.set(key, pending);
              if (cache.size > 512) cache.delete(cache.keys().next().value);
            }
            const features = await cache.get(key);
            if (!features) missing++;
            return features ?? [];
          }),
        );
        const features = groups
          .flat()
          .filter(
            (feature) =>
              !/\/(label|abbr)(?:\/|$)/i.test(feature.attributes.tileLayer) &&
              (!isMercator(source) || feature.geometry.type !== "multipoint"),
          );
        const rank = (feature) =>
          feature.geometry.type === "polygon"
            ? /water|ocean|marine|lake|inlandseas/i.test(feature.attributes.tileLayer)
              ? 1
              : 0
            : feature.geometry.type === "polyline"
              ? 2
              : 3;
        features.sort((first, second) => rank(first) - rank(second));
        if (!features.length)
          report(pane.id, "No vector tile geometry in this footprint");
        const symbols = {
          polygon: {
            type: "simple-fill",
            style: "solid",
            color: [165, 197, 163, 1],
          },
          water: {
            type: "simple-fill",
            style: "solid",
            color: [210, 232, 237, 1],
          },
          polyline: {
            type: "simple-line",
            style: "solid",
            color: [54, 100, 121, 1],
            width: 0.7,
          },
          multipoint: {
            type: "simple-marker",
            style: "circle",
            color: [158, 55, 65, 1],
            size: 3,
          },
        };
        for (const feature of features)
          feature.attributes.tileGeometryType =
            rank(feature) === 1 ? "water" : feature.geometry.type;
        return {
          id: `tiles-${pane.id}`,
          title: `Vector tiles: ${pane.id}`,
          paneId: pane.id,
          features,
          visible: true,
          opacity: 1,
          ranges: [],
          layer: { id: `tiles-${pane.id}` },
          renderer: {
            symbolFor: (attributes) => symbols[attributes.tileGeometryType],
          },
          tileEvidence: {
            url,
            spatialReference: source.tileInfo.spatialReference,
            requested: selected.length,
            missing,
            keys: selected.map((tile) => [
              tile.lod.level,
              tile.row,
              tile.column,
            ]),
            levels: [...new Set(selected.map((tile) => tile.lod.level))],
          },
        };
      }),
    );
    return datasets;
  };
  load.accept = (datasets) => {
    load.lastSignature = JSON.stringify(
      datasets
        .filter((data) => data.tileEvidence)
        .map((data) => [
          data.paneId,
          data.tileEvidence.url,
          data.tileEvidence.keys,
        ]),
    );
  };
  load.needsRefresh = (panes, scale) =>
    load.lastSignature !== signature(panes, scale);
  return load;
}
