import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeBrowser } from "./native-browser.mjs";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";
const artifacts = mkdtempSync(join(tmpdir(), "usa-map-retention-"));
const browser = await launchNativeBrowser();
const tabs = [];
const switches = [];
const recoveries = [];
let phase = "initialization";
console.log(`Artifacts: ${artifacts}`);

async function settled(page) {
  await page.waitForFunction(() => window.retentionViews?.().every(view =>
    view?.ready && !view.destroyed && view.stationary && !view.updating
    && view.layerViews.length > 0), null, { timeout: 90000 });
  await page.waitForLoadState("networkidle");
}

async function addTab(label, query, width, height) {
  phase = "initialization";
  const page = await browser.context.newPage();
  const tab = { page, label, query, width, height, queries: [], errors: [], losses: [] };
  tabs.push(tab);
  const network = await browser.context.newCDPSession(page);
  await network.send("Network.enable");
  network.on("Network.requestWillBeSent", event => {
    const url = new URL(event.request.url);
    if (/\/(?:FeatureServer|MapServer)(?:\/\d+)?\/query[^/]*$/i.test(url.pathname)) {
      tab.queries.push({ phase, timestamp: event.timestamp,
        url: url.origin + url.pathname, method: event.request.method });
    }
  });
  page.on("pageerror", error => tab.errors.push(error.message));
  await page.addInitScript(() => {
    window.retentionContexts = new WeakMap();
    window.retentionLosses = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...options) {
      const context = original.call(this, type, ...options);
      if (context && ["webgl", "webgl2", "experimental-webgl"].includes(type)) {
        window.retentionContexts.set(this, context);
      }
      return context;
    };
    document.addEventListener("webglcontextlost", event => {
      window.retentionLosses.push({ trusted: event.isTrusted,
        container: event.target.closest?.("[id$='ViewDiv']")?.id ?? null });
    }, true);
  });
  await page.setViewportSize({ width, height });
  await page.bringToFront();
  await page.goto(base + query);
  await page.waitForFunction(() => window.mainView?.ready);
  await page.evaluate(async () => { await window.framingPreviewReady; });
  await page.locator("#drawer-toggle").click();
  await page.locator("#pr-drawer-toggle").click();
  await page.evaluate(async () => { await window.viewsReady; });
  await page.evaluate(() => {
    window.retentionViews = () => [window.mainView, window.prView,
      ...document.querySelector("#drawer-iframe").contentWindow.drawerLifecycle.views];
  });
  await settled(page);
  assert.ok(tab.queries.length > 0, `${label}: DevTools Network must capture initial layer queries`);
  await page.evaluate(() => { window.retentionOriginals = window.retentionViews(); });
  return tab;
}

async function counts() {
  return Promise.all(tabs.map(async tab => ({ label: tab.label,
    ...await tab.page.evaluate(() => ({ ...window.getLiveWebGLContexts(),
      sameViews: window.retentionViews().every((view, index) => view === window.retentionOriginals[index]),
      alive: window.retentionOriginals.every(view => !view.destroyed),
    })), queries: tab.queries.length })));
}

async function switchTo(tab, label) {
  phase = label;
  const before = await counts();
  await tab.page.bringToFront();
  await tab.page.waitForFunction(() => !document.hidden);
  await settled(tab.page);
  await tab.page.waitForTimeout(1500);
  const after = await counts();
  const record = { phase, returnedTo: tab.label, before, after };
  switches.push(record);
  for (let index = 0; index < tabs.length; index++) {
    assert.equal(after[index].created, before[index].created, `${phase}/${tabs[index].label}: new context`);
    assert.equal(after[index].queries, before[index].queries, `${phase}/${tabs[index].label}: layer query on return`);
    assert.ok(after[index].sameViews && after[index].alive, `${phase}: view identity/liveness`);
  }
  console.log(`PASS ${phase}: ${before.map(value => value.created).join(",")} -> ${after.map(value => value.created).join(",")}; no layer queries`);
}

async function recoverGroup(tab, other, group, hiddenLoss) {
  phase = `loss-${group}`;
  await tab.page.bringToFront();
  await settled(tab.page);
  await tab.page.evaluate(() => {
    window.recoveryOriginals = window.retentionViews();
    window.recoveryNavigation = window.recoveryOriginals.map(view => ({
      center: view.center.toJSON(), scale: view.scale, rotation: view.rotation,
    }));
  });
  const before = await tab.page.evaluate(() => window.getLiveWebGLContexts().created);
  if (hiddenLoss) {
    await other.page.bringToFront();
    await tab.page.waitForFunction(() => document.hidden, null, { polling: 100 });
  }
  await tab.page.evaluate(group => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    const view = group === "main" ? window.mainView : group === "pr" ? window.prView : child.akView;
    const owner = view.container.ownerDocument.defaultView;
    const context = [...view.container.querySelectorAll("canvas")]
      .map(canvas => owner.retentionContexts.get(canvas)).find(value => value && !value.isContextLost());
    if (!context?.getExtension("WEBGL_lose_context")) throw new Error("Native context-loss extension unavailable");
    owner.retentionLosses.length = 0;
    context.getExtension("WEBGL_lose_context").loseContext();
  }, group);
  await tab.page.waitForFunction(group => {
    const owner = group === "drawer" ? document.querySelector("#drawer-iframe").contentWindow : window;
    return owner.retentionLosses.some(event => event.trusted && event.container);
  }, group, { polling: 100, timeout: 30000 });
  assert.equal(await tab.page.evaluate(() => window.recoveryOriginals.every(view => !view.destroyed)), true,
    `${phase}: destruction must wait for next visibility`);
  assert.equal(await tab.page.evaluate(() => window.getLiveWebGLContexts().created), before);
  if (!hiddenLoss) {
    await other.page.bringToFront();
    await tab.page.waitForFunction(() => document.hidden, null, { polling: 100 });
  }
  await tab.page.bringToFront();
  await tab.page.waitForFunction(group => {
    const target = group === "main" ? 0 : group === "pr" ? 1 : 2;
    return window.retentionViews()[target] !== window.recoveryOriginals[target];
  }, group, { timeout: 30000 });
  await settled(tab.page);
  const result = await tab.page.evaluate(() => ({
    created: window.getLiveWebGLContexts().created,
    views: window.retentionViews().map((view, index) => ({
      same: view === window.recoveryOriginals[index], oldDestroyed: window.recoveryOriginals[index].destroyed,
      centerError: Math.hypot(view.center.x - window.recoveryNavigation[index].center.x,
        view.center.y - window.recoveryNavigation[index].center.y),
      scaleError: Math.abs(view.scale - window.recoveryNavigation[index].scale),
      rotationError: Math.abs(view.rotation - window.recoveryNavigation[index].rotation),
    })),
  }));
  recoveries.push({ group, hiddenLoss, before, ...result });
  const affected = index => group === "main" ? index === 0 : group === "pr" ? index === 1 : index >= 2;
  for (const [index, view] of result.views.entries()) {
    assert.equal(view.same, !affected(index), `${group}/${index}: only lost group rebuilds`);
    assert.equal(view.oldDestroyed, affected(index));
    assert.ok(view.centerError < 1e-5 && view.scaleError < 1e-5 && view.rotationError < 1e-8,
      `${group}/${index}: navigation restoration ${JSON.stringify(view)}`);
  }
  assert.equal(result.created - before, result.views.filter(view => !view.same).length);
  await tab.page.evaluate(() => { window.retentionOriginals = window.retentionViews(); });
  console.log(`PASS ${phase}: only affected group rebuilt, navigation restored`);
}

try {
  const first = await addTab("Lambert standard", "", 1920, 1080);
  const second = await addTab("Albers globes", "?projection=albers&overview=globes", 1280, 800);
  if (!process.env.RECOVERY_ONLY) {
    for (let round = 0; round < 6; round++) {
      for (const tab of tabs) await switchTo(tab, `two-tabs-${round + 1}-${tab.label}`);
    }
    await addTab("Albers standard", "?projection=albers", 2560, 1600);
    for (let round = 0; round < 6; round++) {
      for (const tab of tabs) await switchTo(tab, `three-tabs-${round + 1}-${tab.label}`);
    }
  }
  phase = "drawer-retention";
  await first.page.bringToFront();
  const drawerBefore = await first.page.evaluate(() => window.getLiveWebGLContexts().created);
  for (const selector of ["#drawer-toggle", "#pr-drawer-toggle"]) {
    await first.page.locator(selector).click();
    await first.page.evaluate(async () => { await window.viewsReady; });
    assert.equal(await first.page.evaluate(() => window.retentionOriginals.every(view => !view.destroyed)), true);
    await first.page.locator(selector).click();
    await first.page.evaluate(async () => { await window.viewsReady; });
    await settled(first.page);
  }
  assert.equal(await first.page.evaluate(() => window.getLiveWebGLContexts().created), drawerBefore);
  await first.page.evaluate(() => {
    window.mainView.container.dispatchEvent(new Event("webglcontextlost"));
    window.mainView.scale = 5000000;
    for (const view of window.retentionViews()) {
      view.center = view.center.clone().set({ x: view.center.x + 1234, y: view.center.y + 567 });
      view.rotation += 3;
    }
  });
  await settled(first.page);
  await switchTo(second, "synthetic-loss-away");
  await switchTo(first, "synthetic-loss-return");
  await recoverGroup(first, second, "main", false);
  await recoverGroup(first, second, "pr", true);
  await recoverGroup(first, second, "drawer", true);
  for (const tab of tabs) assert.deepEqual(tab.errors, [], tab.label);
} finally {
  writeFileSync(join(artifacts, "evidence.json"), JSON.stringify({ switches, recoveries,
    tabs: tabs.map(({ label, query, width, height, queries, errors }) => ({ label, query, width, height, queries, errors })),
  }, null, 2));
  await browser.close();
}