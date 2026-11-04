export const PANE_NAMES = Object.freeze({ conus: "Contiguous United States", ak: "Alaska", hi: "Hawaii", pr: "Puerto Rico / USVI" });
export const MIN_SCALE = 1000000;
export const MAX_SCALE = 80000000;

export function parseOptions(search) {
  const params = new URLSearchParams(search);
  const webmap = params.get("webmap");
  const layers = params.has("layers") ? params.get("layers").split(",") : [];
  if (webmap && layers.length) throw new Error("Choose webmap or layers, not both.");
  if ([...(webmap ? [webmap] : []), ...layers].some(id => !/^[a-f0-9]{32}$/i.test(id))) {
    throw new Error("Portal item IDs must contain 32 hexadecimal characters.");
  }
  const projection = params.get("projection") ?? "lambert";
  if (!["albers", "lambert"].includes(projection)) throw new Error("Unknown projection.");
  const panes = params.has("panes") ? params.get("panes").split(",") : Object.keys(PANE_NAMES);
  if (!panes.length || panes.some(pane => !Object.hasOwn(PANE_NAMES, pane)) || new Set(panes).size !== panes.length) {
    throw new Error("Unknown or duplicate pane.");
  }
  const swipe = params.has("swipe") ? params.get("swipe").split(",") : null;
  if (swipe && (swipe.length !== 2 || swipe.some(value => !value) || swipe[0] === swipe[1])) {
    throw new Error("Swipe requires two distinct layer IDs or indexes.");
  }
  const scale = params.has("scale") ? Number(params.get("scale")) : 24000000;
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) throw new Error("Scale must be between 1000000 and 80000000.");
  return { webmap, layers, projection, panes, swipe, scale };
}
