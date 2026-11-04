import ArcGISMap from "@arcgis/core/Map.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import { parseMapOptions, validateTileProjection } from "./basemap-options.js";

export function mapMessage(text, error = false) {
  const host = document.getElementById("mainViewDiv") ? document : window.parent.document;
  let panel = host.getElementById("map-source-diagnostics");
  if (!panel) {
    panel = host.createElement("details");
    panel.id = "map-source-diagnostics";
    const summary = host.createElement("summary");
    summary.textContent = "Map source diagnostics";
    panel.append(summary);
    host.body.append(panel);
  }
  if ([...panel.querySelectorAll("p")].some(entry => entry.textContent === text)) return;
  const entry = host.createElement("p");
  entry.textContent = text;
  if (error) {
    panel.open = true;
    entry.setAttribute("role", "alert");
  }
  panel.append(entry);
}

function operationalLayers(layers) {
  return layers.toArray().flatMap(layer => [layer, ...(layer.layers ? operationalLayers(layer.layers) : [])]);
}

function cloneLayer(source) {
  const clone = source.clone();
  const originals = operationalLayers({ toArray: () => [source] });
  operationalLayers({ toArray: () => [clone] }).forEach((layer, index) => { layer.id = originals[index].id; });
  return clone;
}

export async function loadMapSources(params) {
  const options = parseMapOptions(params);
  options.messages.forEach(message => mapMessage(message, true));
  const diagnostics = { options, basemaps: [] };
  window.mapSourceDiagnostics = diagnostics;
  const [WebMap, Basemap, PortalItem, VectorTileLayer] = options.webmap || Object.keys(options.basemaps).length
    ? (await Promise.all([
      import("@arcgis/core/WebMap.js"), import("@arcgis/core/Basemap.js"),
      import("@arcgis/core/portal/PortalItem.js"), import("@arcgis/core/layers/VectorTileLayer.js"),
    ])).map(module => module.default) : [];
  const items = new Map();
  const webmaps = new Map();
  const item = id => {
    if (!items.has(id)) items.set(id, new PortalItem({ id }).load());
    return items.get(id);
  };
  const webmap = id => {
    if (!webmaps.has(id)) webmaps.set(id, (async () => {
      const portalItem = await item(id);
      if (portalItem.type !== "Web Map") throw new Error(`${id}: expected a Web Map.`);
      return new WebMap({ portalItem }).load();
    })());
    return webmaps.get(id);
  };
  const source = options.webmap ? await webmap(options.webmap) : null;
  if (source) {
    await Promise.all(operationalLayers(source.layers).map(layer => layer.load()));
    const ids = operationalLayers(source.layers).map(layer => layer.id);
    if (new Set(ids).size !== ids.length) throw new Error("Operational web-map layer IDs must be unique.");
  }
  const basemaps = new Map();
  await Promise.all(Object.entries(options.basemaps).map(async ([pane, id]) => {
    const portalItem = await item(id);
    let basemap;
    if (portalItem.type === "Web Map") basemap = (await webmap(id)).basemap;
    else if (portalItem.type === "Vector Tile Service") basemap = new Basemap({ baseLayers: [new VectorTileLayer({ portalItem })] });
    else throw new Error(`${pane}: expected a Web Map or vector tile item.`);
    if (!basemap) throw new Error(`${pane}: web map has no basemap.`);
    await basemap.loadAll();
    const layers = [...basemap.baseLayers, ...basemap.referenceLayers];
    if (!layers.length) throw new Error(`${pane}: basemap is empty.`);
    let spatialReference;
    for (const layer of layers) {
      if (layer.type !== "vector-tile" || !layer.tileInfo?.spatialReference) {
        throw new Error(`${pane}: basemap layer ${layer.id} has no vector-tile projection.`);
      }
      const tileSR = layer.tileInfo.spatialReference;
      const result = validateTileProjection(tileSR, pane);
      if (spatialReference && !spatialReference.equals(tileSR)) throw new Error(`${pane}: mixed basemap tile projections are not supported.`);
      spatialReference = tileSR;
      diagnostics.basemaps.push({ ...result, id, layerId: layer.id, spatialReference: tileSR.toJSON(),
        visible: layer.visible, fullExtent: layer.fullExtent?.toJSON(), tileInfo: layer.tileInfo.toJSON() });
      mapMessage(`${pane.toUpperCase()}: numeric Albers parameters match. ${result.datumDifference}`);
    }
    basemaps.set(pane, { basemap, spatialReference });
  }));
  if (options.overview) basemaps.set("overview", basemaps.get("conus"));
  const root = document.getElementById("mainViewDiv") ? window : window.parent;
  const hub = root.operationalLayerSync ??= { visible: new Map(), maps: new Set(), applying: false };
  const maps = new Map();
  return {
    hasWebmap: Boolean(source),
    spatialReference(pane, fallback) { return basemaps.get(pane)?.spatialReference ?? fallback; },
    map(pane, defaults) {
      if (maps.has(pane)) return maps.get(pane);
      const map = new ArcGISMap({
        layers: (source ? source.layers.toArray() : defaults).map(cloneLayer),
        basemap: basemaps.get(pane)?.basemap.clone() ?? null,
      });
      maps.set(pane, map);
      if (source) {
        for (const layer of operationalLayers(map.layers)) {
          if (hub.visible.has(layer.id)) layer.visible = hub.visible.get(layer.id);
          else hub.visible.set(layer.id, layer.visible);
          map.addHandles(reactiveUtils.watch(() => layer.visible, visible => {
            if (hub.applying) return;
            hub.applying = true;
            try {
              hub.visible.set(layer.id, visible);
              for (const peer of hub.maps) {
                const match = operationalLayers(peer.layers).find(candidate => candidate.id === layer.id);
                if (match) match.visible = visible;
              }
            } finally { hub.applying = false; }
          }, { sync: true }));
        }
        hub.maps.add(map);
      }
      return map;
    },
    async addLayerList(view) {
      if (!source) return;
      const [{ default: LayerList }, { default: Expand }] = await Promise.all([
        import("@arcgis/core/widgets/LayerList.js"), import("@arcgis/core/widgets/Expand.js"),
      ]);
      const list = new LayerList({ view });
      const expand = new Expand({ view, content: list, expandTooltip: "Operational layers", expanded: false });
      view.ui.add(expand, "top-right");
      view.addHandles({ remove() { expand.destroy(); list.destroy(); } });
    },
  };
}