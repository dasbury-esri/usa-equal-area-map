import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchNativeBrowser } from "../tests/native-browser.mjs";

const storyUrl = "https://storymaps.arcgis.com/stories/73a4b40120b44a3fb9d6935d53d49330";
const response = await fetch(storyUrl);
assert.ok(response.ok);
let html = await response.text();
const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(match, "StoryMaps reader bootstrap has changed");
const next = JSON.parse(match[1]);
const data = next.props.publishedData;
const embed = {
  type: "embed",
  data: {
    url: "https://example.com/", embedSrc: "https://example.com/", embedType: "link",
    display: "inline", useSmartEmbed: false, isEmbedSupported: true,
    isLiveOnMobile: true, hasEmbedOpenButton: false,
  },
};
const cases = [];
for (const size of ["standard", "wide", "full"]) {
  const id = `probe-inline-${size}`;
  data.nodes[id] = { ...structuredClone(embed), config: { size } };
  cases.push(id);
}
for (const [layout, size] of [
  ["docked-panel", "small"], ["docked-panel", "medium"], ["docked-panel", "large"],
  ["floating-panel", "small"], ["slideshow", "small"],
]) {
  const id = `probe-${layout}-${size}`;
  data.nodes[id] = {
    type: "immersive",
    data: { type: "sidecar", subtype: layout, narrativePanelPosition: "start", narrativePanelSize: size },
    children: [`${id}-slide`],
  };
  data.nodes[`${id}-slide`] = {
    type: "immersive-slide", data: { transition: "fade" },
    children: [`${id}-text`, `${id}-embed`],
  };
  data.nodes[`${id}-text`] = {
    type: "immersive-narrative-panel", data: { position: "start", panelStyle: "themed" },
    children: ["n-7aC23r"],
  };
  data.nodes[`${id}-embed`] = structuredClone(embed);
  cases.push(id);
}
data.nodes[data.root].children = ["n-taI2aI", ...cases];
html = html.replace(match[1], JSON.stringify(next).replaceAll("<", "\\u003c"));
const artifacts = mkdtempSync(join(tmpdir(), "storymaps-embed-sizes-"));
const measurements = { source: storyUrl, buildId: next.buildId, capturedAt: new Date().toISOString(), cases: [] };
const browser = await launchNativeBrowser();
try {
  const page = await browser.context.newPage();
  await page.route(storyUrl, route => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://example.com/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Dimension probe</title><body>Dimension probe</body>",
  }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(storyUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  for (const [width, height] of [[1920, 1080], [1280, 720], [2560, 1600]]) {
    await page.setViewportSize({ width, height });
    for (const id of cases) {
      const block = page.locator(`#${id}`);
      await block.waitFor({ timeout: 45000 });
      await block.evaluate(element => element.scrollIntoView({ behavior: "instant", block: "center" }));
      const frame = block.locator("iframe").first();
      await frame.waitFor({ timeout: 30000 });
      let previous;
      let stable = 0;
      const deadline = Date.now() + 10000;
      while (stable < 3 && Date.now() < deadline) {
        const bounds = await frame.boundingBox();
        assert.ok(bounds?.width > 0 && bounds.height > 0, `${id}: empty frame`);
        const current = JSON.stringify([bounds.width, bounds.height]);
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      assert.equal(stable, 3, `${id}: unstable frame`);
      const sample = await block.evaluate(element => {
        const iframe = element.querySelector("iframe");
        const bounds = iframe.getBoundingClientRect();
        const narrative = element.querySelector(".immersive-narrative-panel");
        return {
          id: element.id, host: [innerWidth, innerHeight], documentWidth: document.documentElement.clientWidth,
          width: bounds.width, height: bounds.height, ratio: bounds.width / bounds.height,
          narrativeWidth: narrative?.getBoundingClientRect().width ?? null,
        };
      });
      const childFrame = await (await frame.elementHandle()).contentFrame();
      sample.iframeViewport = await childFrame.evaluate(() => [innerWidth, innerHeight]);
      measurements.cases.push(sample);
      console.log(JSON.stringify(sample));
    }
  }
  writeFileSync(join(artifacts, "measurements.json"), JSON.stringify(measurements, null, 2));
  console.log(`Artifacts: ${artifacts}`);
} finally {
  await browser.close();
}