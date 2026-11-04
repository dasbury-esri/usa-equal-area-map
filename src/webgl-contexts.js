const contexts = new Set();
const known = new WeakSet();
const canvasContexts = new WeakMap();
let created = 0;
let scheduled = false;

function localStats() {
  let live = 0;
  for (const reference of contexts) {
    const context = reference.deref();
    if (!context) contexts.delete(reference);
    else if (!context.isContextLost()) live++;
  }
  return { live, created };
}

window.getWebGLContextStats = localStats;
window.getLiveWebGLContexts = () => {
  const documentStats = localStats();
  const drawerStats = document.getElementById("drawer-iframe")?.contentWindow
    ?.getWebGLContextStats?.() ?? { live: 0, created: 0 };
  return { live: documentStats.live + drawerStats.live,
    document: documentStats.live, drawer: drawerStats.live,
    created: documentStats.created + drawerStats.created };
};

function notify() {
  if (window.parent !== window) {
    window.parent.dispatchEvent(new Event("webgl-context-change"));
    return;
  }
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    console.info("[WebGL] live document/iframe contexts", window.getLiveWebGLContexts());
  });
}

for (const prototype of [HTMLCanvasElement.prototype, globalThis.OffscreenCanvas?.prototype].filter(Boolean)) {
  const getContext = prototype.getContext;
  prototype.getContext = function(type, ...options) {
    const context = getContext.call(this, type, ...options);
    if (["webgl", "webgl2", "experimental-webgl"].includes(type) && context && !known.has(context)) {
      known.add(context);
      canvasContexts.set(this, new WeakRef(context));
      contexts.add(new WeakRef(context));
      created++;
      this.addEventListener("webglcontextlost", notify);
      this.addEventListener("webglcontextrestored", notify);
      notify();
    }
    return context;
  };
}
window.addEventListener("webgl-context-change", notify);
document.addEventListener("visibilitychange", notify);

export function releaseAfterDestroy(container) {
  const owned = Array.from(container.querySelectorAll("canvas"), canvas => canvasContexts.get(canvas)?.deref())
    .filter(Boolean);
  return () => {
    for (const context of owned) {
      if (!context.isContextLost()) context.getExtension("WEBGL_lose_context")?.loseContext();
    }
    notify();
  };
}