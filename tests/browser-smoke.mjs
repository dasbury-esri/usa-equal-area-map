import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeBrowser } from "./native-browser.mjs";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";
const artifacts = mkdtempSync(join(tmpdir(), "usa-map-browser-"));
const browser = await launchNativeBrowser();
console.log(`Artifacts: ${artifacts}`);

async function settled(page) {
  await page.waitForFunction(() => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    const views = [window.mainView, window.prView, ...Array.from(child.akView?.constructor.views ?? [])];
    return views.length >= 6 && views.every(view => view?.ready && view.stationary
      && !view.updating && view.layerViews.length > 0);
  }, null, { timeout: 90000 });
}

try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1600 }]) {
    for (const query of ["", "?projection=albers", "?overview=globes", "?projection=albers&overview=globes"]) {
      const albers = query.includes("projection=albers");
      const globes = query.includes("overview=globes");
      const label = `${viewport.width}-${viewport.height}-${albers ? "albers" : "lambert"}-${globes ? "globes" : "standard"}`;
      const page = await browser.context.newPage();
      await page.setViewportSize(viewport);
      await page.bringToFront();
      const errors = [];
      const warnings = [];
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
        };
      }, { albers, globes });
      assert.equal(opened.count, globes ? 6 : 7);
      assert.equal(opened.correctProjections, true);
      assert.equal(opened.linked, true);
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
        await otherTab.bringToFront();
        await page.waitForFunction(() => document.hidden && window.savedViews.every(saved => saved.view.destroyed)
          && window.viewLifecycle.main.views.length === 0 && window.viewLifecycle.pr.views.length === 0
          && window.viewLifecycle.drawer.views.length === 0, null, { polling: 100 });
        await page.bringToFront();
        await page.waitForFunction(() => !document.hidden && window.mainView?.ready && window.prView?.ready);
        await page.evaluate(() => window.viewsReady.then(() => true));
        await settled(page);
        const restoration = await page.evaluate(() => {
          const views = [...window.viewLifecycle.main.views, ...window.viewLifecycle.pr.views,
            ...window.viewLifecycle.drawer.views];
          return window.savedViews.map(saved => {
            const view = views.find(current => current.container.id === saved.id);
            return { id: saved.id, newView: view !== saved.view, sameMap: view.map === saved.map,
              centerError: Math.hypot(view.center.x - saved.center.x, view.center.y - saved.center.y),
              scaleError: Math.abs(view.scale - saved.scale), rotationError: Math.abs(view.rotation - saved.rotation) };
          });
        });
        for (const restored of restoration) assert.ok(restored.newView && restored.sameMap
          && restored.centerError < 1 && restored.scaleError < 1 && restored.rotationError < 0.001, JSON.stringify(restored));
        await otherTab.close();
      }
      await page.locator("#drawer-toggle").click();
      await page.waitForFunction(scale => Math.abs(window.mainView.scale - scale) < 1, initial.scale);
      await page.waitForFunction(() => window.viewLifecycle.drawer.views.length === 0);
      await page.locator("#pr-drawer-toggle").click();
      await page.waitForFunction(() => window.viewLifecycle.pr.views.length === 0);
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
        await page.waitForFunction(() => window.viewLifecycle.pr.views.length === 0
          && window.viewLifecycle.drawer.views.length === 0);
      }
      await page.evaluate(() => {
        for (let cycle = 0; cycle < 6; cycle++) {
          document.querySelector("#drawer-toggle").click();
          document.querySelector("#pr-drawer-toggle").click();
        }
      });
      await page.evaluate(() => window.viewsReady.then(() => true));
      assert.equal(await page.evaluate(() => window.viewLifecycle.main.views.length
        + window.viewLifecycle.pr.views.length + window.viewLifecycle.drawer.views.length), 1);
      assert.deepEqual(errors, []);
      assert.deepEqual(warnings, []);
      console.log(JSON.stringify({ label, result: "PASS", ...opened }));
      await page.close();
    }
  }
} finally {
  await browser.close();
}