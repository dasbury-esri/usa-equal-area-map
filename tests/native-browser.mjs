import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

export async function launchNativeBrowser() {
  const profile = mkdtempSync(join(tmpdir(), "usa-map-chrome-"));
  const executable = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const processHandle = spawn(executable, [
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-first-run",
    "--no-default-browser-check", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Chrome debugger did not start")), 15000);
      let output = "";
      processHandle.once("error", error => { clearTimeout(deadline); reject(error); });
      processHandle.stderr.on("data", chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(deadline); resolve(match[1]); }
      });
    });
    const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    return {
      context: browser.contexts()[0],
      async close() {
        await browser.close();
        processHandle.kill();
      },
    };
  } catch (error) {
    processHandle.kill();
    throw error;
  }
}