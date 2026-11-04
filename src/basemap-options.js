import parseWkt from "wkt-parser";
import { projections } from "./projections.js";

const itemPattern = /^[a-f0-9]{32}$/i;
const known = {
  5070: [-96, 23, 29.5, 45.5],
  3338: [-154, 50, 55, 65],
  102006: [-154, 50, 55, 65],
  102007: [-157, 13, 8, 18],
};

export function parseMapOptions(params) {
  const webmap = params.get("webmap");
  if (webmap !== null && !itemPattern.test(webmap)) throw new Error("webmap must be a 32-character ArcGIS item ID.");
  const basemaps = {};
  const messages = [];
  const requested = params.has("basemaps") || params.has("overviewBasemap");
  if (requested && params.get("projection") !== "albers") {
    messages.push("Basemaps ignored: vector-tile basemaps require projection=albers.");
    return { webmap, basemaps, messages, overview: false };
  }
  if (params.has("basemaps")) {
    for (const entry of params.get("basemaps").split(",")) {
      const [pane, id, extra] = entry.split(":");
      if (!["conus", "ak", "hi"].includes(pane) || !itemPattern.test(id ?? "") || extra !== undefined || basemaps[pane]) {
        throw new Error("basemaps must contain unique conus:<item ID>,ak:<item ID>,hi:<item ID> entries.");
      }
      basemaps[pane] = id;
    }
  }
  const overview = params.get("overviewBasemap");
  if (overview !== null && (overview !== "conus" || !basemaps.conus)) {
    throw new Error("overviewBasemap=conus requires a CONUS basemap.");
  }
  return { webmap, basemaps, messages, overview: overview === "conus" };
}

export function validateTileProjection(spatialReference, pane) {
  const expected = projections.albers[pane];
  let parameters;
  let datum;
  if (spatialReference?.wkt) {
    const parsed = parseWkt(spatialReference.wkt);
    if (!["Albers", "Albers_Equal_Area", "Albers_Conic_Equal_Area"].includes(parsed.projName)
        || parsed.to_meter !== 1 || parsed.GEOGCS?.PRIMEM?.convert !== 0
        || Math.abs(parsed.GEOGCS?.UNIT?.convert - Math.PI / 180) > 1e-14) {
      throw new Error(`${pane}: tiles must use Albers, meters and Greenwich degree coordinates.`);
    }
    datum = parsed.datumCode;
    const supportedDatum = ["wgs84", "nad83"].includes(datum);
    const flattening = datum === "nad83" ? 298.257222101 : 298.257223563;
    if (!supportedDatum || parsed.a !== 6378137 || Math.abs(parsed.rf - flattening) > 1e-9) {
      throw new Error(`${pane}: only WGS84 or NAD83 tile datums are supported.`);
    }
    parameters = [parsed.long0, parsed.lat0, parsed.lat1, parsed.lat2].map(value => value * 180 / Math.PI);
    parameters.push(parsed.x0, parsed.y0);
  } else {
    const definition = known[spatialReference?.latestWkid ?? spatialReference?.wkid];
    if (!definition) throw new Error(`${pane}: unrecognized tile projection; a verifiable Albers WKT is required.`);
    parameters = [...definition, 0, 0];
    datum = "nad83";
  }
  const names = ["centralMeridian", "latitudeOfOrigin", "standardParallel1", "standardParallel2", "falseEasting", "falseNorthing"];
  names.forEach((name, index) => {
    if (!Number.isFinite(parameters[index]) || Math.abs(parameters[index] - expected[name]) > 1e-8) {
      throw new Error(`${pane}: tile ${name}=${parameters[index]} does not match ${expected[name]}. Basemap refused.`);
    }
  });
  return { pane, datum, parameters: Object.fromEntries(names.map((name, index) => [name, parameters[index]])),
    datumDifference: datum === "nad83" ? "NAD83/GRS80 tiles; pane definition is WGS84. SDK datum transformation applies." : "None (WGS84)." };
}