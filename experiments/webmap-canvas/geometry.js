import earcut, { flatten } from "earcut";
import { arcgisToGeoJSON } from "@terraformer/arcgis";
import { rgba } from "./renderers.js";

export const MAX_EDGE_DEGREES = 0.25;
export const MAX_RENDER_INSTANCES = 12000000;
export const MAX_DENSIFIED_VERTICES = 6500000;
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
  const geometry = arcgisToGeoJSON({ rings: continuous, spatialReference: { wkid: 4326 } });
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map(polygon => polygon.map(densifyPath));
}

export function triangulate(polygon) {
  const { vertices, holes, dimensions } = flatten(polygon);
  const indices = earcut(vertices, holes, dimensions);
  return { vertices, indices };
}

class InstanceBuffer {
  constructor() { this.values = new Float32Array(65536 * 6); this.length = 0; }
  add(first, second = first, third = first) {
    if (this.length / 6 >= MAX_RENDER_INSTANCES) throw new Error("Tessellation instance budget exceeded");
    if (this.length + 6 > this.values.length) {
      const next = new Float32Array(Math.min(MAX_RENDER_INSTANCES * 6, this.values.length * 2));
      next.set(this.values);
      this.values = next;
    }
    for (const point of [first, second, third]) {
      this.values[this.length++] = point[0];
      this.values[this.length++] = point[1];
    }
  }
  get count() { return this.length / 6; }
}

export async function prepareGeometry(dataset, budget) {
  const buffer = new InstanceBuffer();
  const draws = [];
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
      const offset = buffer.count;
      for (const polygon of polygons) {
        const { vertices, indices } = triangulate(polygon);
        for (let index = 0; index < indices.length; index += 3) {
          buffer.add(...indices.slice(index, index + 3).map(vertex => [vertices[vertex * 2], vertices[vertex * 2 + 1]]));
        }
      }
      draws.push({ mode: 0, offset, count: buffer.count - offset, color });
    }
    const stroke = geometry.type === "polyline" ? symbol : symbol.outline;
    const strokeColor = geometry.type === "polyline" ? color : outline;
    if (paths.length && stroke && stroke.style !== "none" && stroke.width > 0 && strokeColor[3] > 0) {
      const offset = buffer.count;
      for (const path of paths) for (let index = 0; index < path.length - 1; index++) buffer.add(path[index], path[index + 1]);
      draws.push({ mode: 1, offset, count: buffer.count - offset, color: strokeColor, width: stroke.width * 96 / 72 });
    }
    if (points.length) {
      const offset = buffer.count;
      for (const point of continuousPath(points)) buffer.add(point);
      draws.push({ mode: 2, offset, count: buffer.count - offset, color, outline,
        size: symbol.size * 96 / 72, width: (symbol.outline?.width ?? 0) * 96 / 72 });
    }
    if (++featureIndex % 16 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  budget.instances += buffer.count;
  if (budget.instances > MAX_RENDER_INSTANCES) throw new Error("Total tessellation instance budget exceeded");
  return { values: buffer.values.subarray(0, buffer.length), draws, instances: buffer.count };
}
