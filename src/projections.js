export const WGS84 = Object.freeze({ semiMajor: 6378137, inverseFlattening: 298.257223563 });

function definition(kind, name, centralMeridian, latitudeOfOrigin, standardParallel1, standardParallel2) {
  const parameters = { centralMeridian, latitudeOfOrigin, falseEasting: 0, falseNorthing: 0 };
  if (kind === "albers") Object.assign(parameters, { standardParallel1, standardParallel2 });
  const names = {
    centralMeridian: "Central_Meridian",
    latitudeOfOrigin: "Latitude_Of_Origin",
    falseEasting: "False_Easting",
    falseNorthing: "False_Northing",
    standardParallel1: "Standard_Parallel_1",
    standardParallel2: "Standard_Parallel_2" };
  const method = kind === "albers" ? "Albers_Equal_Area" : "Lambert_Azimuthal_Equal_Area";
  const wkt = `PROJCS["${name}",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",${WGS84.semiMajor},${WGS84.inverseFlattening}]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["${method}"],${Object.entries(parameters).map(([key, value]) => `PARAMETER["${names[key]}",${value}]`).join(",")},UNIT["Meter",1]]`;
  return Object.freeze({ kind, ...parameters, wkt });
}

export const projections = Object.freeze({
  lambert: Object.freeze({
    conus: definition("lambert", "Lambert Azimuthal Equal Area_North America_alt", -99, 40),
    ak: definition("lambert", "Lambert Azimuthal Equal Area_Alaska", -148, 64),
    hi: definition("lambert", "Lambert Azimuthal Equal Area_Hawaii", -156, 20),
    pr: definition("lambert", "Lambert Azimuthal Equal Area_PR_VI", -65.5, 18),
    gu: definition("lambert", "Lambert Azimuthal Equal Area_GU_MP", 145, 16),
    as: definition("lambert", "Lambert Azimuthal Equal Area_AS", -170, -14),
    overview: definition("lambert", "Lambert Azimuthal Equal Area_US_global_extent", -140, 17.25),
  }),
  albers: Object.freeze({
    conus: definition("albers", "Albers Equal Area_US", -96, 23, 29.5, 45.5),
    ak: definition("albers", "Albers Equal Area_AK", -154, 50, 55, 65),
    hi: definition("albers", "Albers Equal Area_HI", -157, 13, 8, 18),
    pr: definition("albers", "Albers Equal Area_PR", -66.5, 17, 18, 20),
    gu: definition("albers", "Albers Equal Area_Guam", 145, 12, 13, 15),
    as: definition("albers", "Albers Equal Area_AS", -170, -13, -14, -10),
    overview: definition("albers", "Albers Equal Area_Overview", -140, 23, 29.5, 45.5),
  }),
});
