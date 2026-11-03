import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";
const artifacts = mkdtempSync(join(tmpdir(), "usa-map-browser-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
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
      const page = await browser.newPage({ viewport });
      const errors = [];
      const warnings = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (/Too many active WebGL contexts/i.test(message.text())) warnings.push(message.text());
      });
      await page.goto(base + query);
      await page.waitForFunction(() => window.framingPreviewReady);
      await page.evaluate(() => window.framingPreviewReady.then(() => true));
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
        assert.equal(opened.overview.rotation, 20);
        assert.ok(Math.abs(opened.overview.x - (albers ? 19020.2579054083 : 482982.65986522695)) < 0.001);
      } else {
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
      await page.locator("#drawer-toggle").click();
      await page.waitForFunction(scale => Math.abs(window.mainView.scale - scale) < 1, initial.scale);
      assert.deepEqual(errors, []);
      assert.deepEqual(warnings, []);
      console.log(JSON.stringify({ label, result: "PASS", ...opened }));
      await page.close();
    }
  }
} finally {
  await browser.close();
}