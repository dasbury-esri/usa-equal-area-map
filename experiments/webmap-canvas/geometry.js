import earcut, { flatten } from "earcut";
import { arcgisToGeoJSON } from "@terraformer/arcgis";
import { rgba } from "./renderers.js";

export const MAX_EDGE_DEGREES = 0.25;
export const MAX_RENDER_INSTANCES = 12000000;
export const MAX_DENSIFIED_VERTICES = 6500000;
export const CHUNK_INSTANCES = 4096;
export const wrapDegrees = value => ((value + 180) % 360 + 360) % 360 - 180;

export function continuousPath(path, reference = path[0]?.[0] ?? 0) {
  let previous = reference;
  return path.map(([longitude, latitude]) => {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) > 90) throw new Error("Invalid geographic coordinate");
    previous += wrapDegrees(longitude - previous);
    return [previous, latitude];
  });
}

export function densifyPath(path) {
  const result = [];
  for (let index = 0; index < path.length; index++) {
    const current = path[index];
    const next = path[index + 1];
    result.push(current);
    if (!next) continue;
    const segments = Math.ceil(Math.max(Math.abs(next[0] - current[0]), Math.abs(next[1] - current[1])) / MAX_EDGE_DEGREES);
    for (let segment = 1; segment < segments; segment++) {
      const fraction = segment / segments;
      result.push([current[0] + (next[0] - current[0]) * fraction, current[1] + (next[1] - current[1]) * fraction]);
    }
  }
  return result;
}

export function polygonParts(rings) {
  const reference = rings[0]?.[0]?.[0] ?? 0;
  const continuous = rings.map(ring => continuousPath(ring, reference));
  const polygons = partitionRings(continuous).flatMap(rings => {
    const geometry = arcgisToGeoJSON({ rings, spatialReference: { wkid: 4326 } });
    return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  });
  return polygons.map(polygon => polygon.map(densifyPath));
}

export function partitionRings(rings) {
  const groups = [];
  for (const [index, ring] of rings.entries()) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [longitude, latitude] of ring) {
      bounds[0] = Math.min(bounds[0], longitude); bounds[1] = Math.min(bounds[1], latitude);
      bounds[2] = Math.max(bounds[2], longitude); bounds[3] = Math.max(bounds[3], latitude);
    }
    const group = { bounds, rings: [{ index, ring }] };
    for (let candidate = 0; candidate < groups.length; candidate++) {
      const other = groups[candidate];
      if (bounds[0] > other.bounds[2] || bounds[2] < other.bounds[0]
        || bounds[1] > other.bounds[3] || bounds[3] < other.bounds[1]) continue;
      bounds[0] = Math.min(bounds[0], other.bounds[0]); bounds[1] = Math.min(bounds[1], other.bounds[1]);
      bounds[2] = Math.max(bounds[2], other.bounds[2]); bounds[3] = Math.max(bounds[3], other.bounds[3]);
      group.rings.push(...other.rings);
      groups.splice(candidate, 1);
      candidate = -1;
    }
    groups.push(group);
  }
  return groups.map(group => group.rings.sort((first, second) => first.index - second.index).map(entry => entry.ring));
}

export function triangulate(polygon) {
  const { vertices, holes, dimensions } = flatten(polygon);
  const indices = earcut(vertices, holes, dimensions);
  return { vertices, indices };
}

class InstanceBuffer {
  constructor(budget) {
    this.values = new Float32Array(256 * 6); this.length = 0; this.budget = budget;
    this.bounds = [Infinity, Infinity, -Infinity, -Infinity];
  }
  add(first, second = first, third = first) {
    if (++this.budget.instances > MAX_RENDER_INSTANCES) throw new Error("Total tessellation instance budget exceeded");
    if (this.length + 6 > this.values.length) {
      const next = new Float32Array(Math.min(MAX_RENDER_INSTANCES * 6, this.values.length * 2));
      next.set(this.values);
      this.values = next;
    }
    for (const point of [first, second, third]) {
      this.values[this.length++] = point[0];
      this.values[this.length++] = point[1];
      this.bounds[0] = Math.min(this.bounds[0], Math.fround(point[0]));
      this.bounds[1] = Math.min(this.bounds[1], Math.fround(point[1]));
      this.bounds[2] = Math.max(this.bounds[2], Math.fround(point[0]));
      this.bounds[3] = Math.max(this.bounds[3], Math.fround(point[1]));
    }
  }
  get count() { return this.length / 6; }
}

export async function prepareGeometry(dataset, budget) {
  const groups = new Map();
  const group = draw => {
    const key = JSON.stringify(draw);
    if (!groups.has(key)) {
      const cells = new Map();
      groups.set(key, { draw, cells, add(first, second = first, third = first) {
        const longitude = wrapDegrees((first[0] + second[0] + third[0]) / 3);
        const latitude = (first[1] + second[1] + third[1]) / 3;
        const cell = `${Math.floor(longitude / 5)},${Math.floor(latitude / 5)}`;
        if (!cells.has(cell)) cells.set(cell, []);
        const chunks = cells.get(cell);
        if (!chunks.length || chunks.at(-1).count >= CHUNK_INSTANCES) chunks.push(new InstanceBuffer(budget));
        chunks.at(-1).add(first, second, third);
      } });
    }
    return groups.get(key);
  };
  let featureIndex = 0;
  for (const feature of dataset.features) {
    const geometry = feature.geometry;
    const symbol = dataset.renderer.symbolFor(feature.attributes);
    if (!geometry || !symbol) continue;
    const expectedType = geometry.type === "polygon" ? "simple-fill" : geometry.type === "polyline" ? "simple-line" : "simple-marker";
    if (symbol.type !== expectedType) throw new Error(`Symbol ${symbol.type} cannot render ${geometry.type}`);
    const color = rgba(symbol.color, dataset.opacity);
    const outline = rgba(symbol.outline?.color, dataset.opacity);
    const polygons = geometry.type === "polygon" ? polygonParts(geometry.rings) : [];
    const paths = geometry.type === "polyline" ? geometry.paths.map(path => densifyPath(continuousPath(path))) : polygons.flat();
    const points = geometry.type === "point" ? [[geometry.x, geometry.y]] : geometry.points ?? [];
    budget.vertices += paths.reduce((sum, path) => sum + path.length, 0) + points.length;
    if (budget.vertices > MAX_DENSIFIED_VERTICES) throw new Error("Densified vertex budget exceeded");
    if (geometry.type === "polygon" && symbol.style !== "none" && color[3] > 0) {
      const buffer = group({ mode: 0, color });
      for (const polygon of polygons) {
        const { vertices, indices } = triangulate(polygon);
        for (let index = 0; index < indices.length; index += 3) {
          buffer.add(...indices.slice(index, index + 3).map(vertex => [vertices[vertex * 2], vertices[vertex * 2 + 1]]));
        }
      }
    }
    const stroke = geometry.type === "polyline" ? symbol : symbol.outline;
    const strokeColor = geometry.type === "polyline" ? color : outline;
    if (paths.length && stroke && stroke.style !== "none" && stroke.width > 0 && strokeColor[3] > 0) {
      const buffer = group({ mode: 1, color: strokeColor, width: stroke.width * 96 / 72 });
      for (const path of paths) for (let index = 0; index < path.length - 1; index++) buffer.add(path[index], path[index + 1]);
    }
    if (points.length) {
      const buffer = group({ mode: 2, color, outline, size: symbol.size * 96 / 72, width: (symbol.outline?.width ?? 0) * 96 / 72 });
      for (const point of continuousPath(points)) buffer.add(point);
    }
    if (++featureIndex % 16 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const buffers = group => [...group.cells.values()].flat();
  const instances = [...groups.values()].reduce((sum, group) => sum + buffers(group).reduce((count, buffer) => count + buffer.count, 0), 0);
  const values = new Float32Array(instances * 6);
  const draws = [];
  let offset = 0;
  for (const group of groups.values()) {
    const draw = { ...group.draw, offset, count: 0, chunks: [] };
    for (const buffer of buffers(group)) {
      values.set(buffer.values.subarray(0, buffer.length), offset * 6);
      draw.chunks.push({ offset, count: buffer.count, bounds: buffer.bounds });
      draw.count += buffer.count;
      offset += buffer.count;
    }
    draws.push(draw);
  }
  return { values, draws, instances };
}

export function visibleRanges(draw, paneId, viewport, enabled = true) {
  if (!enabled) return [{ offset: draw.offset, count: draw.count }];
  const ranges = [];
  for (const chunk of draw.chunks) {
    const bounds = chunk.projectedBounds[paneId];
    if (bounds[0] > viewport[2] || bounds[2] < viewport[0] || bounds[1] > viewport[3] || bounds[3] < viewport[1]) continue;
    const previous = ranges.at(-1);
    if (previous && previous.offset + previous.count === chunk.offset) previous.count += chunk.count;
    else ranges.push({ offset: chunk.offset, count: chunk.count });
  }
  return ranges;
}
