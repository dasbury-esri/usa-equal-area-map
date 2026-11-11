import "../../src/webgl-contexts.js";
import { projections } from "../../src/projections.js";
import { parseOptions, PANE_NAMES } from "./config.js";
import { loadSources, publicItem } from "./portal.js";
import { loadFeatures } from "./data.js";
import { CanvasRenderer } from "./renderer.js";
import { generalizationForScale, needsRefresh, queryFootprint } from "./coverage.js";
import "./style.css";
import { createMainLayout } from "./layout.js";

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
  if (options.layout === "main") createMainLayout();
  document.querySelector("#scale").textContent = `1:${Math.round(options.scale).toLocaleString("en-US")}`;
  if (!options.webmap && !options.layers.length && !options.tiles.length) {
    state.status = "waiting";
    status.textContent = "No public item selected.";
    return;
  }
  const sourceStarted = performance.now();
  state.sources = await loadSources(options);
  state.timings = { sourcesMs: performance.now() - sourceStarted };
  document.querySelector("#map-title").textContent = state.sources.title;
  state.renderer = new CanvasRenderer(document.querySelector("#map-canvas"), options, report);
  const tileLoader = options.tiles.length ? (await import("./tiles.js")).createTileLoader(options.tiles, report) : null;
  const loadDatasets = async (coverage, refreshFeatures = true) => {
    const [features, tiles] = await Promise.all([
      refreshFeatures ? loadFeatures(state.sources.layers, report, publicItem, coverage)
        : Promise.resolve(state.datasets.filter(dataset => !dataset.tileEvidence)),
      tileLoader ? tileLoader(state.renderer.panes, state.renderer.scale) : Promise.resolve([]),
    ]);
    return [...tiles, ...features];
  };
  const requestOptions = () => ({ scale: state.renderer.scale,
    geometry: queryFootprint(state.renderer.panes, state.renderer.scale),
    generalization: generalizationForScale(state.renderer.scale) });
  state.coverage = requestOptions();
  const downloadStarted = performance.now();
  state.datasets = await loadDatasets(state.coverage);
  state.timings.downloadMs = performance.now() - downloadStarted;
  status.textContent = "Preparing geometry";
  const loaded = await state.renderer.load(state.datasets);
  if (tileLoader) {
    if (!loaded) throw new Error("Vector tile geometry could not be uploaded");
    tileLoader.accept(state.datasets);
  }
  Object.assign(state.timings, state.renderer.loadTimings);
  state.status = "ready";
  state.firstRenderMs = performance.now();
  status.textContent = `${state.renderer.layers.length} feature layers rendered.`;
  document.querySelector("#diagnostics details").open = state.renderer.layers.length !== state.sources.layers.length;
  let version = 0;
  let timer;
  state.refreshCount = 0;
  const refresh = async () => {
    const refreshFeatures = needsRefresh(state.coverage,
      queryFootprint(state.renderer.panes, state.renderer.scale, 0), state.renderer.scale);
    if (state.refreshing || (!refreshFeatures && !tileLoader?.needsRefresh(state.renderer.panes, state.renderer.scale))) return;
    const current = version;
    const coverage = requestOptions();
    state.refreshing = true;
    status.textContent = "Loading area detail";
    try {
      const datasets = await loadDatasets(coverage, refreshFeatures);
      const expected = state.datasets.map(dataset => dataset.id);
      if (datasets.length !== expected.length || datasets.some(dataset => !expected.includes(dataset.id))) {
        throw new Error("Incomplete area refresh; previous geometry retained");
      }
      if (current === version && await state.renderer.load(datasets, { isCurrent: () => current === version })) {
        state.datasets = datasets;
        tileLoader?.accept(datasets);
        if (refreshFeatures) state.coverage = coverage;
        state.refreshCount++;
      }
    } catch (error) {
      report("Area detail", error.message);
      document.querySelector("#diagnostics details").open = true;
    } finally {
      state.refreshing = false;
      status.textContent = `${state.renderer.layers.length} feature layers rendered.`;
      if (current !== version) { clearTimeout(timer); timer = setTimeout(refresh, 150); }
    }
  };
  state.renderer.onNavigate = () => {
    version++;
    clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  };
  state.refresh = refresh;
  state.renderer.onNavigate();
} catch (error) {
  state.status = "error";
  state.errors.push(error.message);
  status.textContent = error.message;
  console.error(error);
}
}

initialize();
