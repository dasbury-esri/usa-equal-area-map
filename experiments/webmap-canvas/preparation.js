export function preparationSnapshot(dataset) {
  const symbolCopy = symbol => symbol ? {
    type: symbol.type, style: symbol.style, color: symbol.color?.toRgba?.() ?? symbol.color,
    width: symbol.width, size: symbol.size, outline: symbolCopy(symbol.outline),
  } : null;
  const symbols = [], indexes = new Map();
  const features = dataset.features.map(feature => {
    const symbol = dataset.renderer.symbolFor(feature.attributes);
    if (!indexes.has(symbol)) { indexes.set(symbol, symbols.length); symbols.push(symbolCopy(symbol)); }
    const geometry = feature.geometry ? Object.fromEntries(["type", "rings", "paths", "points", "x", "y"]
      .filter(key => feature.geometry[key] !== undefined).map(key => [key, feature.geometry[key]])) : null;
    return { geometry, attributes: { symbolIndex: indexes.get(symbol) } };
  });
  return { features, symbols, opacity: dataset.opacity };
}

export class GeometryPreparation {
  constructor() {
    this.worker = new Worker(new URL("./geometry-worker.js", import.meta.url), { type: "module" });
    this.pending = new Map();
    this.stats = { workers: 1, jobs: 0, workerMs: 0, transferBytes: 0 };
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error(data.error));
      else {
        this.stats.workerMs += data.durationMs;
        this.stats.transferBytes += data.mesh.values.byteLength;
        pending.resolve(data);
      }
    };
    this.worker.onerror = event => this.destroy(new Error(event.message || "Geometry worker failed"));
    this.worker.onmessageerror = () => this.destroy(new Error("Geometry worker message could not be decoded"));
  }

  prepare(dataset, budget, panes) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.stats.jobs;
    const snapshot = preparationSnapshot(dataset);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.destroy(new Error("Geometry worker deadline exceeded")), 120000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, dataset: snapshot, budget, panes: panes.map(pane => ({ id: pane.id, definition: pane.parameters.definition })) });
      } catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      }
    });
  }

  destroy(error = new Error("Geometry worker stopped")) {
    this.failure = error;
    this.worker.terminate();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}