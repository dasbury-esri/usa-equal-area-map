import assert from "node:assert/strict";
import test from "node:test";
import { parseOptions } from "../experiments/webmap-canvas/config.js";

test("prototype defaults and explicit inputs", () => {
  assert.deepEqual(parseOptions("").panes, ["conus", "ak", "hi", "pr"]);
  assert.equal(parseOptions("").projection, "lambert");
  const options = parseOptions("?layers=42430a34a2b44c0da678ce60ce20dd31&panes=ak,hi&projection=albers&swipe=0,1");
  assert.equal(options.layers.length, 1);
  assert.deepEqual(options.panes, ["ak", "hi"]);
  assert.deepEqual(options.swipe, ["0", "1"]);
});

test("invalid options stop before requests", () => {
  for (const search of ["?layers=bad", "?projection=mercator", "?panes=ak,ak", "?panes=", "?swipe=0", "?swipe=0,0", "?scale=NaN", "?scale=1",
    "?webmap=42430a34a2b44c0da678ce60ce20dd31&layers=42430a34a2b44c0da678ce60ce20dd31"]) {
    assert.throws(() => parseOptions(search), undefined, search);
  }
});
