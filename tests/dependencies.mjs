import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import { getWindow } from "@lit-labs/ssr/lib/dom-shim.js";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
assert.ok(!Object.keys(lock.packages).some(path => /\/(node-domexception|fetch-blob)$/.test(path)));
const patchedMatchers = Object.entries(lock.packages)
  .filter(([path]) => path.endsWith("/minimatch"));
assert.ok(patchedMatchers.length > 0);
assert.ok(patchedMatchers.every(([, metadata]) => metadata.version === "11.0.1"));
assert.ok(patchedMatchers.every(([, metadata]) => metadata.integrity
  && metadata.resolved === "https://registry.npmjs.org/minimatch/-/minimatch-11.0.1.tgz"));

for (const consumer of ["eslint", "@eslint/config-array", "@typescript-eslint/typescript-estree"]) {
  const require = createRequire(import.meta.resolve(consumer));
  const match = require("minimatch");
  assert.equal(typeof match.minimatch, "function", consumer);
  assert.equal(match.minimatch("src/map.js", "**/*.js"), true);
  assert.equal(match.minimatch("src/map.css", "**/*.js"), false);
  assert.equal(new match.Minimatch("**/*.{js,jsx}").match("src/Map.jsx"), true);
  assert.deepEqual(match.match(["map.js", "map.css"], "*.js"), ["map.js"]);
  assert.equal(match.defaults({ nocase: true })("MAP.JS", "*.js"), true);
}

const lint = new ESLint();
const [allowed] = await lint.lintText("export const Good = () => <div />;", { filePath: "fixture.jsx" });
assert.equal(allowed.errorCount, 0, JSON.stringify(allowed.messages));
const [missingKeys] = await lint.lintText("export const BadList = () => [<div />, <div />];", { filePath: "fixture.jsx" });
assert.ok(missingKeys.messages.some(message => message.ruleId === "react-x/no-missing-key"));
const [rejected] = await lint.lintText('import { useState } from "react"; export function Bad({ enabled }) { if (enabled) useState(0); return null; }', { filePath: "fixture.jsx" });
assert.ok(rejected.messages.some(message => message.ruleId === "react-hooks/rules-of-hooks"));
const [javascript] = await lint.lintText("debugger;", { filePath: "fixture.js" });
assert.equal(javascript.messages[0]?.ruleId, "no-debugger");

const response = await getWindow({}).fetch("data:text/plain,native-fetch-ok");
assert.ok(response instanceof globalThis.Response);
assert.equal(await response.text(), "native-fetch-ok");
const controller = new AbortController();
controller.abort();
await assert.rejects(getWindow({}).fetch("data:text/plain,aborted", { signal: controller.signal }), { name: "AbortError" });
console.log("PASS: patched matcher consumers, real lint rules, native SSR fetch and abort, no deprecated dependency");