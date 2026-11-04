export function installWebGLProbe() {
  const known = new WeakSet();
  window.webglProbe = { contexts: [], canvasContexts: new WeakMap() };
  for (const prototype of [HTMLCanvasElement.prototype, globalThis.OffscreenCanvas?.prototype].filter(Boolean)) {
    const original = prototype.getContext;
    prototype.getContext = function(type, ...options) {
      const context = original.call(this, type, ...options);
      if (context && ["webgl", "webgl2", "experimental-webgl"].includes(type) && !known.has(context)) {
        known.add(context);
        const reference = new WeakRef(context);
        window.webglProbe.contexts.push(reference);
        window.webglProbe.canvasContexts.set(this, reference);
      }
      return context;
    };
  }
}

export async function measureWebGLContexts(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("HeapProfiler.collectGarbage");
  } finally {
    await session.detach();
  }
  return page.evaluate(() => {
    const child = document.querySelector("#drawer-iframe")?.contentWindow;
    const contexts = [...window.webglProbe.contexts, ...(child?.webglProbe?.contexts ?? [])]
      .map(reference => reference.deref()).filter(context => context && !context.isContextLost());
    return { live: contexts.length, reported: window.getLiveWebGLContexts() };
  });
}
