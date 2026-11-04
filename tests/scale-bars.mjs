import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeBrowser } from "./native-browser.mjs";

const base = process.env.TEST_URL ?? "http://127.0.0.1:5173/usa-equal-area-map/";
const capture = process.env.CAPTURE_SCALE_BASELINE;
const baseline = process.env.SCALE_BASELINE
  ? JSON.parse(readFileSync(process.env.SCALE_BASELINE, "utf8")) : null;
const sizes = [[1280, 720], [1920, 1080], [2560, 1440], [1280, 800], [1920, 1200],
  [2560, 1600], [2520, 1080], [3360, 1440], [2560, 1080], [3440, 1440]];
const artifacts = mkdtempSync(join(tmpdir(), "usa-map-scale-bars-"));
const samples = {};
const browser = await launchNativeBrowser();
console.log(`Artifacts: ${artifacts}`);

async function settled(page) {
  await page.waitForFunction(() => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    const views = [window.mainView, window.prView, ...(child.drawerLifecycle?.views ?? [])];
    return views.length >= 6 && views.every(view => view?.ready && view.stationary
      && !view.updating && view.container.querySelectorAll(".esri-scale-bar__label").length === 2);
  }, null, { timeout: 90000 });
}

async function measure(page) {
  return page.evaluate(() => {
    const child = document.querySelector("#drawer-iframe").contentWindow;
    return [window.mainView, window.prView, ...child.drawerLifecycle.views].map(view => {
      const root = view.container.querySelector(".esri-scale-bar");
      const component = view.container.querySelector("arcgis-scale-bar");
      const bounds = root.getBoundingClientRect();
      const container = view.container.getBoundingClientRect();
      const globe = view.container.querySelector(".locator-globe")?.getBoundingClientRect();
      return { id: view.container.id, scale: view.scale,
        component: Boolean(component), associated: component?.view === view,
        position: component?.position, hidden: getComputedStyle(root).display === "none",
        compact: view.container.classList.contains("compact-inset"),
        lines: [...root.querySelectorAll(".esri-scale-bar__line")].map(line => ({
          width: line.getBoundingClientRect().width, calculated: Number.parseFloat(line.style.width),
        })),
        labels: [...root.querySelectorAll(".esri-scale-bar__label")].map(label => label.textContent.trim()),
        left: bounds.left - container.left, right: container.right - bounds.right,
        bottom: container.bottom - bounds.bottom,
        fits: bounds.left >= container.left - 1 && bounds.right <= container.right + 1
          && bounds.top >= container.top - 1 && bounds.bottom <= container.bottom + 1,
        globeClear: !globe || bounds.right <= globe.left || bounds.left >= globe.right
          || bounds.bottom <= globe.top || bounds.top >= globe.bottom,
      };
    });
  });
}

try {
  for (const query of ["", "?projection=albers", "?overview=globes", "?projection=albers&overview=globes"]) {
    const page = await browser.context.newPage();
    const errors = [];
    const deprecations = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (/ScaleBar.*deprecat|deprecat.*ScaleBar/i.test(message.text())) deprecations.push(message.text());
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.bringToFront();
    await page.goto(base + query);
    await page.waitForFunction(() => window.mainView?.ready);
    await page.evaluate(async () => { await window.framingPreviewReady; });
    await page.locator("#pr-drawer-toggle").click();
    await page.evaluate(async () => { await window.viewsReady; });
    await page.locator("#drawer-toggle").click();
    await page.evaluate(async () => { await window.viewsReady; });
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => {
        const child = document.querySelector("#drawer-iframe").contentWindow;
        return [window.mainView, window.prView, ...child.drawerLifecycle.views].every(view =>
          Math.abs(view.width - view.container.clientWidth) <= 1
          && Math.abs(view.height - view.container.clientHeight) <= 1);
      });
      await page.evaluate(async () => { await window.updateMapViews({ reframe: true }); });
      await settled(page);
      const overviewScale = await page.evaluate(() => document.querySelector("#drawer-iframe")
        .contentWindow.drawerLifecycle.views.find(view => view.container.id === "overViewDiv")?.scale ?? null);
      for (const scale of [null, 5000000, 1000000]) {
        if (scale) await page.evaluate(scale => { window.mainView.scale = scale; }, scale);
        await settled(page);
        const key = `${query || "default"}/${width}x${height}/${scale ?? "initial"}`;
        const bars = await measure(page);
        assert.equal(bars.length, query.includes("globes") ? 6 : 7, key);
        for (const bar of bars) {
          if (!capture) {
            assert.ok(bar.component && bar.associated, `${key}/${bar.id}: view association`);
            assert.equal(bar.position, bar.id === "overViewDiv" ? "bottom-right" : "bottom-left");
          }
          assert.match(bar.labels[0], /\d.*(?:km|m|cm|mm)$/);
          assert.match(bar.labels[1], /\d.*(?:mi|ft|in)$/);
          assert.equal(bar.hidden, query.includes("globes") && bar.compact);
          if (!bar.hidden) {
            assert.ok(bar.fits && bar.globeClear, `${key}/${bar.id}: bounds or globe overlap`);
            for (const line of bar.lines) assert.ok(Math.abs(line.width - line.calculated) < 1);
          }
          if (bar.id === "overViewDiv") assert.equal(bar.scale, overviewScale);
          else if (scale) assert.ok(Math.abs(bar.scale - scale) < 1);
          if (baseline) {
            const previous = baseline[key].find(value => value.id === bar.id);
            assert.ok(Math.abs(bar.scale - previous.scale) < 1, `${key}/${bar.id}: baseline scale ${bar.scale} != ${previous.scale}`);
            assert.deepEqual(bar.labels, previous.labels, `${key}/${bar.id}: labels`);
            for (let index = 0; index < bar.lines.length; index++) {
              assert.ok(Math.abs(bar.lines[index].width - previous.lines[index].width) <= 1,
                `${key}/${bar.id}: baseline line length`);
            }
            for (const edge of ["left", "right", "bottom"]) {
              assert.ok(Math.abs(bar[edge] - previous[edge]) <= 1, `${key}/${bar.id}: ${edge}`);
            }
          }
        }
        samples[key] = bars;
      }
      await page.screenshot({ path: join(artifacts, `${query.replaceAll(/[?=&]/g, "-") || "default"}-${width}x${height}.png`) });
      console.log(`PASS ${query || "default"} ${width}x${height}: all bars at three scales`);
    }
    if (!capture) {
      await page.evaluate(() => {
        const child = document.querySelector("#drawer-iframe").contentWindow;
        window.previousScaleBars = [window.mainView, window.prView, ...child.drawerLifecycle.views]
          .map(view => view.container.querySelector("arcgis-scale-bar"));
      });
      const other = await browser.context.newPage();
      await other.bringToFront();
      await page.waitForFunction(() => document.hidden && !window.mainView);
      await page.waitForFunction(() => window.previousScaleBars.every(bar => !bar.isConnected && bar.viewModel.destroyed));
      await page.bringToFront();
      await page.evaluate(async () => { await window.viewsReady; });
      await settled(page);
      assert.ok((await measure(page)).every(bar => bar.component && bar.associated));
      await other.close();
      for (const selector of ["#drawer-toggle", "#pr-drawer-toggle"]) {
        await page.locator(selector).click();
        await page.evaluate(async () => { await window.viewsReady; });
        await page.locator(selector).click();
        await page.evaluate(async () => { await window.viewsReady; });
        await settled(page);
      }
      assert.deepEqual(deprecations, []);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(capture || join(artifacts, "measurements.json"), JSON.stringify(samples, null, 2));
} finally {
  await browser.close();
}