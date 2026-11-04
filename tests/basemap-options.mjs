import assert from "node:assert/strict";
import { parseMapOptions, validateTileProjection } from "../src/basemap-options.js";
import { projections } from "../src/projections.js";

const id = "e46bd022bab240489506463e32fcc1bf";
assert.equal(parseMapOptions(new URLSearchParams(`projection=albers&webmap=${id}&basemaps=conus:${id}&overviewBasemap=conus`)).overview, true);
assert.equal(parseMapOptions(new URLSearchParams("projection=lambert&basemaps=bad")).messages.length, 1);
for (const query of ["webmap=bad", `projection=albers&basemaps=conus:${id},conus:${id}`, "projection=albers&overviewBasemap=co", "projection=albers&basemaps="]) {
  assert.throws(() => parseMapOptions(new URLSearchParams(query)));
}
for (const [pane, wkid] of [["conus", 5070], ["ak", 3338], ["hi", 102007]]) {
  assert.equal(validateTileProjection({ wkid }, pane).datum, "nad83");
  assert.equal(validateTileProjection({ wkt: projections.albers[pane].wkt }, pane).datum, "wgs84");
}
assert.throws(() => validateTileProjection({ wkid: 3857 }, "conus"));
assert.throws(() => validateTileProjection({ wkid: 5070 }, "ak"));
for (const [before, after] of [["-96", "-95"], ["29.5", "30"], ["23]", "24]"], ["False_Easting\",0", "False_Easting\",1"], ["Meter\",1", "Foot\",0.3048"]]) {
  assert.throws(() => validateTileProjection({ wkt: projections.albers.conus.wkt.replace(before, after) }, "conus"));
}
console.log("Basemap URL and projection acceptance/rejection checks passed");