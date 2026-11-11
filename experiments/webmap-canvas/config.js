export const PANE_NAMES = Object.freeze({ conus: "Contiguous United States", ak: "Alaska", overview: "Overview", hi: "Hawaii", pr: "Puerto Rico / USVI", gu: "CNMI / Guam", as: "American Samoa" });
export const MIN_SCALE = 500000;
export const MAX_SCALE = 80000000;

export function resolveSwipe(datasets, selection) {
  if (!selection) return null;
  const pair = selection.map(value => datasets.find(dataset => dataset.id === value || dataset.layer?.portalItem?.id === value)
    ?? (/^\d+$/.test(value) ? datasets[Number(value)] : undefined));
  if (pair.some(dataset => !dataset) || pair[0] === pair[1]) throw new Error("Swipe requires two distinct rendered layers (IDs or zero-based indexes).");
  return pair;
}

export function parseOptions(search) {
  const params = new URLSearchParams(search);
  const webmap = params.get("webmap");
  const layers = params.has("layers") ? params.get("layers").split(",") : [];
  if (webmap && layers.length) throw new Error("Choose webmap or layers, not both.");
  if ([...(webmap ? [webmap] : []), ...layers].some(id => !/^[a-f0-9]{32}$/i.test(id))) {
    throw new Error("Portal item IDs must contain 32 hexadecimal characters.");
  }
  const projection = params.get("projection") ?? "lambert";
  const layout = params.get("layout") ?? "grid";
  if (!["grid", "main"].includes(layout)) throw new Error("Unknown layout.");
  const prepare = params.get("prepare") ?? "worker";
  if (!["worker", "inline"].includes(prepare)) throw new Error("Unknown geometry preparation mode");
  if (!["albers", "lambert"].includes(projection)) throw new Error("Unknown projection.");
  const mainPanes = ["conus", "ak", "overview", "gu", "as", "hi", "pr"];
  const panes = params.has("panes") ? params.get("panes").split(",") : layout === "main" ? mainPanes : ["conus", "ak", "hi", "pr"];
  if (!panes.length || panes.some(pane => !Object.hasOwn(PANE_NAMES, pane)) || new Set(panes).size !== panes.length) {
    throw new Error("Unknown or duplicate pane.");
  }
  if (layout === "main" && (panes.length !== mainPanes.length || mainPanes.some((pane, index) => panes[index] !== pane))) {
    throw new Error("Main layout requires the complete standard pane order; omit panes.");
  }
  const swipe = params.has("swipe") ? params.get("swipe").split(",") : null;
  if (swipe && (swipe.length !== 2 || swipe.some(value => !value) || swipe[0] === swipe[1])) {
    throw new Error("Swipe requires two distinct layer IDs or indexes.");
  }
  const scale = params.has("scale") ? Number(params.get("scale")) : 24000000;
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) throw new Error("Scale must be between 500000 and 80000000.");
  const tiles = params.has("tiles") ? params.get("tiles").split(",").map(value => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/\/VectorTileServer\/?$/.test(url.pathname)) {
      throw new Error("tiles requires public HTTPS VectorTileServer URLs without credentials or query parameters");
    }
    return url.href.replace(/\/$/, "");
  }) : [];
  if (tiles.length > 2) throw new Error("tiles accepts CONUS and optional Alaska sources");
  return { webmap, layers, projection, panes, swipe, scale, tiles, prepare, layout };
}
