import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeBrowser } from "./native-browser.mjs";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";
const artifacts = mkdtempSync(join(tmpdir(), "usa-map-browser-"));
const browser = await launchNativeBrowser();
await browser.context.addInitScript(() => {
  window.nativeWebGLContexts = new Set();
  for (const prototype of [HTMLCanvasElement.prototype, globalThis.OffscreenCanvas?.prototype].filter(Boolean)) {
    const original = prototype.getContext;
    prototype.getContext = function(...args) {
      const context = original.apply(this, args);
      if (context instanceof WebGLRenderingContext || context instanceof WebGL2RenderingContext) {
        window.nativeWebGLContexts.add(context);
      }
      return context;
    };
  }
});
console.log(`Artifacts: ${artifacts}`);

async function settled(page) {
  await page.waitForFunction(() => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    const views = [window.mainView, window.prView, ...Array.from(child.akView?.constructor.views ?? [])];
    return views.length >= 6 && views.every(view => view?.ready && view.stationary
      && !view.updating && view.layerViews.length > 0);
  }, null, { timeout: 90000 }).catch(async error => {
    console.error("Unsettled views", await page.evaluate(() => {
      const child = document.querySelector("#drawer-iframe").contentWindow;
      return { visibility: document.visibilityState,
        views: [window.mainView, window.prView, ...Array.from(child.akView?.constructor.views ?? [])]
          .filter(Boolean).map(view => ({ id: view.container?.id, ready: view.ready,
            stationary: view.stationary, updating: view.updating,
            layers: view.map?.layers.map(layer => ({ id: layer.id, status: layer.loadStatus })).toArray(),
          })),
      };
    }));
    throw error;
  });
}

async function contextCount(page) {
  const result = await page.evaluate(() => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    const captured = [...window.nativeWebGLContexts, ...(child.nativeWebGLContexts ?? [])];
    return { nativeLive: captured.filter(context => !context.isContextLost()).length,
      reported: window.getLiveWebGLContexts() };
  });
  assert.equal(result.reported.live, result.nativeLive, "App count must agree with independently captured native contexts");
  return result.reported;
}

try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1600 }]) {
    for (const query of ["", "?projection=albers", "?overview=globes", "?projection=albers&overview=globes"]) {
      const albers = query.includes("projection=albers");
      const globes = query.includes("overview=globes");
      const label = `${viewport.width}-${viewport.height}-${albers ? "albers" : "lambert"}-${globes ? "globes" : "standard"}`;
      console.log(`Checking ${label}`);
      const page = await browser.context.newPage();
      await page.setViewportSize(viewport);
      await page.bringToFront();
      const errors = [];
      const warnings = [];
      const graticuleRequests = [];
      page.on("request", request => {
        if (/278e3884c50649baba4910a6d7b39922|3d47090c1ecc4fb1a84458cbc0274888/.test(request.url())) {
          graticuleRequests.push(request.url());
        }
      });
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (/Too many active WebGL contexts/i.test(message.text())) warnings.push(message.text());
      });
      await page.goto(base + query);
      await page.waitForFunction(() => window.framingPreviewReady);
      await page.evaluate(() => window.framingPreviewReady.then(() => true));
      assert.deepEqual(await page.evaluate(() => ({
        main: window.viewLifecycle.main.views.length,
        pr: window.viewLifecycle.pr.views.length,
        iframe: document.querySelector("#drawer-iframe").contentWindow.location.href,
      })), { main: 1, pr: 0, iframe: "about:blank" });
      const initialContexts = await contextCount(page);
      assert.ok(initialContexts.live <= 3);
      assert.equal(graticuleRequests.length, 0);
      const initial = await page.evaluate(() => ({ scale: window.mainView.scale, center: window.mainView.center.toJSON() }));
      assert.ok(initial.scale < 24000000);
      await page.locator("#drawer-toggle").click();
      await page.locator("#pr-drawer-toggle").click();
      await settled(page);
      await page.waitForFunction(() => document.querySelector("#drawer-container").getBoundingClientRect().left > -1);
      const opened = await page.evaluate(({ albers, globes }) => {
        const child = document.querySelector("#drawer-iframe").contentWindow;
        const views = [window.mainView, window.prView, ...Array.from(child.akView.constructor.views)];
        const overview = views.find(view => view.container.id === "overViewDiv");
        const canvases = views.filter(() => globes).map(view => {
          const canvas = view.container.querySelector(".locator-globe canvas");
          const context = canvas.getContext("2d");
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let opaque = 0;
          let outline = 0;
          const colors = new Set();
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset + 3]) {
              opaque++;
              colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
              const pixel = offset / 4;
              const distance = Math.hypot(pixel % canvas.width - canvas.width / 2,
                Math.floor(pixel / canvas.width) - canvas.height / 2);
              if (distance > 3 && pixels[offset] > 140 && pixels[offset + 1] < 130
                  && pixels[offset + 2] < 130) outline++;
            }
          }
          return { id: view.container.id, opaque, outline, colors: colors.size,
            width: canvas.clientWidth, height: canvas.clientHeight,
            twoDimensional: Boolean(context), hasWebGL: Boolean(canvas.getContext("webgl2")),
            bounds: canvas.getBoundingClientRect().toJSON() };
        });
        return {
          count: views.length,
          correctProjections: views.every(view => view.spatialReference.wkt.includes(albers
            ? 'PROJECTION["Albers_Equal_Area"]' : 'PROJECTION["Lambert_Azimuthal_Equal_Area"]')),
          linked: views.filter(view => view !== overview).every(view => Math.abs(view.scale - window.mainView.scale) < 1),
          alaskaCenter: { x: child.akView.center.x, y: child.akView.center.y },
          overview: overview ? { x: overview.center.x, y: overview.center.y, rotation: overview.rotation } : null,
          canvases,
          layers: window.mainView.map.layers.map(layer => ({ id: layer.id, status: layer.loadStatus })).toArray(),
          layerMembership: views.map(view => ({ id: view.container.id,
            layers: view.map.layers.map(layer => layer.id).toArray(),
            owned: view.map.layers.every(layer => layer.parent === view.map),
            graticuleViews: view.layerViews.filter(layerView => /^latlong/.test(layerView.layer.id)).length,
          })),
        };
      }, { albers, globes });
      assert.equal(opened.count, globes ? 6 : 7);
      assert.equal(opened.correctProjections, true);
      assert.equal(opened.linked, true);
      for (const membership of opened.layerMembership) {
        assert.equal(membership.layers.length, 8);
        assert.equal(membership.owned, true);
        assert.equal(membership.graticuleViews, membership.id === "overViewDiv" ? 2 : 0);
        assert.equal(membership.layers.filter(id => /^latlong/.test(id)).length, membership.id === "overViewDiv" ? 2 : 0);
      }
      assert.equal(graticuleRequests.length > 0, !globes);
      if (albers) {
        assert.ok(Math.abs(opened.alaskaCenter.x + 601787.4469695078) < 0.001);
        assert.ok(Math.abs(opened.alaskaCenter.y - 1417319.4019033893) < 0.001);
      }
      if (!globes) {
        assert.equal(await page.frameLocator("#drawer-iframe").locator(".extent-leader").count(), 3);
        assert.equal(opened.overview.rotation, 20);
        assert.ok(Math.abs(opened.overview.x - (albers ? 19020.2579054083 : 482982.65986522695)) < 0.001);
      } else {
        assert.equal(await page.frameLocator("#drawer-iframe").locator("#overViewDiv canvas, #overViewDiv .esri-view-root, .extent-leader").count(), 0);
        for (const canvas of opened.canvases) {
          assert.ok(canvas.twoDimensional && !canvas.hasWebGL);
          assert.ok(canvas.opaque > 500 && canvas.colors > 10 && canvas.outline > 0, JSON.stringify(canvas));
          assert.equal(canvas.width, 68);
          assert.equal(canvas.height, 68);
          assert.ok(canvas.bounds.x >= 0 && canvas.bounds.y >= 0);
        }
        assert.equal(await page.locator(".inset-recenter").count(), 1);
        assert.equal(await page.frameLocator("#drawer-iframe").locator(".inset-recenter").count(), 4);
      }
      for (const id of ["defaultLayer", "contextLayer", "backgroundLayer", "usStatesLayer"]) {
        assert.equal(opened.layers.find(layer => layer.id === id)?.status, "loaded");
      }
      await page.screenshot({ path: join(artifacts, `${label}.png`) });
      const openedContexts = await contextCount(page);
      assert.ok(openedContexts.live <= opened.count + 2);
      await page.evaluate(() => { window.mainView.scale = 5000000; });
      await page.waitForFunction(() => document.querySelector("#drawer-iframe").contentWindow.akView.scale === 5000000 && window.prView.scale === 5000000);
      await page.evaluate(() => { document.querySelector("#drawer-iframe").contentWindow.akView.scale = 6000000; });
      await page.waitForFunction(() => window.mainView.scale === 6000000 && window.prView.scale === 6000000);
      if (globes) {
        const before = await page.evaluate(() => document.querySelector("#drawer-iframe").contentDocument.querySelector("#akViewDiv .locator-globe canvas").toDataURL());
        await page.evaluate(() => {
          const view = document.querySelector("#drawer-iframe").contentWindow.akView;
          view.center = view.center.clone().offset(900000, 500000);
        });
        await page.waitForFunction(before => document.querySelector("#drawer-iframe").contentDocument.querySelector("#akViewDiv .locator-globe canvas").toDataURL() !== before, before);
        await page.frameLocator("#drawer-iframe").locator("#akViewDiv .inset-recenter").click();
        await page.waitForFunction(center => {
          const view = document.querySelector("#drawer-iframe").contentWindow.akView;
          return view.stationary && view.scale === 6000000
            && Math.hypot(view.center.x - center.x, view.center.y - center.y) < 1;
        }, opened.alaskaCenter);
      }
      await page.evaluate(() => {
        const views = [...window.viewLifecycle.main.views, ...window.viewLifecycle.pr.views,
          ...window.viewLifecycle.drawer.views];
        for (const view of views) view.center = view.center.clone().offset(12345, 6789);
      });
      await settled(page);
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.evaluate(() => {
          window.savedViews = [...window.viewLifecycle.main.views, ...window.viewLifecycle.pr.views,
            ...window.viewLifecycle.drawer.views].map(view => ({
              id: view.container.id, view, map: view.map, center: view.center.toJSON(),
              scale: view.scale, rotation: view.rotation,
            }));
        });
        const otherTab = await browser.context.newPage();
        const retainedContexts = await contextCount(page);
        await otherTab.bringToFront();
        await page.waitForFunction(() => document.hidden && window.savedViews.every(saved => !saved.view.destroyed),
          null, { polling: 100 });
        assert.equal((await contextCount(page)).created, retainedContexts.created);
        await page.bringToFront();
        await page.waitForFunction(() => !document.hidden && window.mainView?.ready && window.prView?.ready);
        await page.evaluate(() => window.viewsReady.then(() => true));
        await settled(page);
        const restoration = await page.evaluate(() => {
          const views = [...window.viewLifecycle.main.views, ...window.viewLifecycle.pr.views,
            ...window.viewLifecycle.drawer.views];
          return window.savedViews.map(saved => {
            const view = views.find(current => current.container.id === saved.id);
            return { id: saved.id, sameView: view === saved.view, sameMap: view.map === saved.map,
              centerError: Math.hypot(view.center.x - saved.center.x, view.center.y - saved.center.y),
              scaleError: Math.abs(view.scale - saved.scale), rotationError: Math.abs(view.rotation - saved.rotation) };
          });
        });
        for (const restored of restoration) assert.ok(restored.sameView && restored.sameMap
          && restored.centerError < 1 && restored.scaleError < 1 && restored.rotationError < 0.001, JSON.stringify(restored));
        assert.equal((await contextCount(page)).created, retainedContexts.created);
        await otherTab.close();
      }
      const twoTabCounts = [];
      if (globes) {
        const second = await browser.context.newPage();
        second.on("pageerror", error => errors.push(error.message));
        second.on("console", message => {
          if (/Too many active WebGL contexts/i.test(message.text())) warnings.push(message.text());
        });
        await second.setViewportSize(viewport);
        await second.goto(base + query);
        await second.waitForFunction(() => window.mainView?.ready);
        await second.locator("#drawer-toggle").click();
        await second.locator("#pr-drawer-toggle").click();
        await second.waitForFunction(() => window.viewLifecycle?.drawer?.views.length === 4 && window.prView?.ready);
        await second.evaluate(() => window.viewsReady.then(() => true));
        await settled(second);
        for (let turn = 0; turn < 10; turn++) {
          const foreground = turn % 2 ? second : page;
          const background = turn % 2 ? page : second;
          const beforeForeground = await contextCount(foreground);
          const beforeBackground = await contextCount(background);
          await foreground.bringToFront();
          await background.waitForFunction(() => document.hidden && window.mainView?.ready, null, { polling: 100 });
          await foreground.waitForFunction(() => !document.hidden && window.mainView?.ready && window.prView?.ready);
          await foreground.evaluate(() => window.viewsReady.then(() => true));
          await settled(foreground);
          const visibleCount = await contextCount(foreground);
          const hiddenCount = await contextCount(background);
          assert.ok(visibleCount.live <= 8 && hiddenCount.live <= 8);
          assert.equal(visibleCount.created, beforeForeground.created);
          assert.equal(hiddenCount.created, beforeBackground.created);
          twoTabCounts.push({ visible: visibleCount.live, hidden: hiddenCount.live, total: visibleCount.live + hiddenCount.live });
        }
        await page.bringToFront();
        await page.waitForFunction(() => window.mainView?.ready && window.prView?.ready);
        await page.evaluate(() => window.viewsReady.then(() => true));
        await settled(page);
        await second.close();
      }
      await page.locator("#drawer-toggle").click();
      await page.waitForFunction(scale => Math.abs(window.mainView.scale - scale) < 1, initial.scale);
      assert.equal(await page.evaluate(() => window.viewLifecycle.drawer.views.length), globes ? 4 : 5);
      await page.locator("#pr-drawer-toggle").click();
      assert.equal(await page.evaluate(() => window.viewLifecycle.pr.views.length), 1);
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.locator("#drawer-toggle").click();
        await page.locator("#pr-drawer-toggle").click();
        await page.evaluate(() => window.viewsReady.then(() => true));
        await settled(page);
        await page.evaluate(() => { window.mainView.scale = 7000000; });
        await page.waitForFunction(() => window.prView.scale === 7000000
          && document.querySelector("#drawer-iframe").contentWindow.akView.scale === 7000000);
        await page.locator("#pr-drawer-toggle").click();
        await page.locator("#drawer-toggle").click();
        await page.evaluate(() => window.viewsReady.then(() => true));
        assert.equal(await page.evaluate(() => window.viewLifecycle.pr.views.length
          + window.viewLifecycle.drawer.views.length), opened.count - 1);
      }
      await page.evaluate(() => {
        for (let cycle = 0; cycle < 6; cycle++) {
          document.querySelector("#drawer-toggle").click();
          document.querySelector("#pr-drawer-toggle").click();
        }
      });
      await page.evaluate(() => window.viewsReady.then(() => true));
      assert.equal(await page.evaluate(() => window.viewLifecycle.main.views.length
        + window.viewLifecycle.pr.views.length + window.viewLifecycle.drawer.views.length), opened.count);
      assert.equal((await contextCount(page)).created, openedContexts.created);
      assert.deepEqual(errors, []);
      assert.deepEqual(warnings, []);
      console.log(JSON.stringify({ label, result: "PASS", initialContexts, openedContexts, twoTabCounts, ...opened }));
      await page.close();
    }
  }
} finally {
  await browser.close();
}