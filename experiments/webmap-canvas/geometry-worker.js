import { prepareGeometry } from "./geometry.js";
import { projectChunkBounds, projectionParameters } from "./projection.js";

self.onmessage = async ({ data: { id, dataset, budget, panes } }) => {
  try {
    const started = performance.now();
    dataset.renderer = { symbolFor: attributes => dataset.symbols[attributes.symbolIndex] };
    const mesh = await prepareGeometry(dataset, budget, false);
    projectChunkBounds(mesh.values, mesh.draws.flatMap(draw => draw.chunks), panes.map(pane => ({
      id: pane.id, parameters: projectionParameters(pane.definition),
    })));
    self.postMessage({ id, mesh, budget, diagnostics: dataset.geometryDiagnostics, durationMs: performance.now() - started }, [mesh.values.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};