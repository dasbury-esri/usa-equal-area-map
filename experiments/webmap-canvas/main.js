import "../../src/webgl-contexts.js";
import { projections } from "../../src/projections.js";
import { parseOptions, PANE_NAMES } from "./config.js";
import { loadSources, publicItem } from "./portal.js";
import { loadFeatures } from "./data.js";
import "./style.css";

const status = document.querySelector("#status");
const state = window.webmapCanvas = { status: "loading", errors: [], reports: [] };

export function report(title, reason) {
  const item = document.createElement("li");
  item.textContent = `${title}: ${reason}`;
  document.querySelector("#layer-report").append(item);
  state.reports.push({ title, reason });
  console.info("[Webmap canvas]", title, reason);
}

async function initialize() {
try {
  const options = parseOptions(location.search);
  state.options = options;
  state.projections = projections[options.projection];
  const panes = document.querySelector("#panes");
  panes.dataset.count = options.panes.length;
  for (const id of options.panes) {
    const pane = document.createElement("section");
    pane.className = "pane";
    pane.dataset.pane = id;
    pane.setAttribute("aria-label", PANE_NAMES[id]);
    pane.tabIndex = 0;
    const title = document.createElement("h2");
    title.textContent = PANE_NAMES[id];
    const recenter = document.createElement("button");
    recenter.className = "recenter";
    recenter.textContent = "Recenter";
    recenter.title = `Recenter ${PANE_NAMES[id]}`;
    recenter.disabled = true;
    const bar = document.createElement("output");
    bar.className = "scale-bar";
    pane.append(title, recenter, bar);
    panes.append(pane);
  }
  document.querySelector("#scale").textContent = `1:${Math.round(options.scale).toLocaleString("en-US")}`;
  if (!options.webmap && !options.layers.length) {
    state.status = "waiting";
    status.textContent = "No public item selected.";
    return;
  }
  state.sources = await loadSources(options);
  document.querySelector("#map-title").textContent = state.sources.title;
  state.datasets = await loadFeatures(state.sources.layers, report, publicItem);
  state.status = "loaded";
  status.textContent = `${state.datasets.length} feature layers ready.`;
} catch (error) {
  state.status = "error";
  state.errors.push(error.message);
  status.textContent = error.message;
  console.error(error);
}
}

initialize();
