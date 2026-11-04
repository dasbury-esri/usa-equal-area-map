import esriConfig from "@arcgis/core/config.js";
import WebMap from "@arcgis/core/WebMap.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";

esriConfig.request.useIdentity = false;

export async function publicItem(id) {
  const response = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${id}?f=json`, {
    credentials: "omit", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Public item ${id} is unavailable (HTTP ${response.status}).`);
  const item = await response.json();
  if (item.error || item.access !== "public") throw new Error(`Item ${id} is not publicly accessible. Authentication is not supported.`);
  return item;
}

export async function loadSources(options) {
  if (options.webmap) {
    const item = await publicItem(options.webmap);
    if (item.type !== "Web Map") throw new Error("The webmap item is not a Web Map.");
    const map = new WebMap({ portalItem: { id: item.id } });
    await map.load();
    return { title: item.title, layers: map.layers.toArray(), map };
  }
  const layers = [];
  for (const id of options.layers) {
    const item = await publicItem(id);
    if (item.type !== "Feature Service") throw new Error(`Item ${id} is not a feature-layer portal item.`);
    layers.push(new FeatureLayer({ portalItem: { id }, title: item.title }));
  }
  return { title: "Equal Area Web Map", layers };
}
