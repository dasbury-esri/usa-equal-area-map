export const metersPerPixel = scale => scale * 0.0254 / 96;
export const generalizationForScale = scale => {
  const level = Math.floor(2 * Math.log2(scale / 1000000) + 1e-12);
  return metersPerPixel(1000000) * 0.5 / 111320 * 2 ** (level / 2);
};
const wrap = longitude => ((longitude + 180) % 360 + 360) % 360 - 180;

export function needsRefresh(loaded, footprint, scale) {
  if (generalizationForScale(scale) < (loaded.generalization ?? generalizationForScale(loaded.scale))) return true;
  return footprint.rings.some(ring => !loaded.geometry.rings.some(outer =>
    ring[0][0] >= outer[0][0] && ring[0][1] >= outer[0][1]
    && ring[2][0] <= outer[2][0] && ring[2][1] <= outer[2][1]));
}

export function splitBounds(west, south, east, north) {
  if (east - west >= 360) return [[-180, south, 180, north]];
  const left = wrap(west);
  const right = left + east - west;
  return right <= 180 ? [[left, south, right, north]]
    : [[left, south, 180, north], [-180, south, right - 360, north]];
}

export function queryFootprint(panes, scale, margin = 0.25) {
  const boxes = [];
  for (const pane of panes) {
    const bounds = pane.element.getBoundingClientRect();
    const halfWidth = bounds.width * (0.5 + margin) * metersPerPixel(scale);
    const halfHeight = bounds.height * (0.5 + margin) * metersPerPixel(scale);
    const reference = pane.parameters.converter.inverse(pane.center)[0];
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    let invalid = false;
    for (let row = 0; row <= 16; row++) for (let column = 0; column <= 16; column++) {
      const point = pane.parameters.converter.inverse([
        pane.center[0] + halfWidth * (column / 8 - 1),
        pane.center[1] + halfHeight * (row / 8 - 1),
      ]);
      if (!point?.every(Number.isFinite)) { invalid = true; continue; }
      const longitude = reference + wrap(point[0] - reference);
      west = Math.min(west, longitude); east = Math.max(east, longitude);
      south = Math.min(south, point[1]); north = Math.max(north, point[1]);
    }
    if (invalid || !Number.isFinite(west)) boxes.push([-180, -90, 180, 90]);
    else boxes.push(...splitBounds(Math.floor((west - 2) / 5) * 5, Math.max(-90, Math.floor((south - 2) / 5) * 5),
      Math.ceil((east + 2) / 5) * 5, Math.min(90, Math.ceil((north + 2) / 5) * 5)));
  }
  const compare = (first, second) => first[0] - second[0] || first[1] - second[1] || first[2] - second[2] || first[3] - second[3];
  boxes.sort(compare);
  for (let first = 0; first < boxes.length; first++) {
    for (let second = first + 1; second < boxes.length; second++) {
      const left = boxes[first], right = boxes[second];
      if (left[0] > right[2] || right[0] > left[2] || left[1] > right[3] || right[1] > left[3]) continue;
      boxes[first] = [Math.min(left[0], right[0]), Math.min(left[1], right[1]), Math.max(left[2], right[2]), Math.max(left[3], right[3])];
      boxes.splice(second, 1);
      first = -1;
      break;
    }
  }
  return { type: "polygon", spatialReference: { wkid: 4326 }, rings: boxes.sort(compare).map(([west, south, east, north]) =>
    [[west, south], [west, north], [east, north], [east, south], [west, south]]) };
}
