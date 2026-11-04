# Public Projected Vector Tile Sources

Research scope: anonymous public HTTP requests only. No internal Esri systems,
credentials, portal changes or publication. This is a candidate inventory, not
a verified tile-by-tile coverage or licensing certification. Item access and
service metadata were checked during session 0014; availability can change.

## Findings

No inspected source exactly matches a prototype pane's complete CRS. The Alaska,
CONUS and Hawaii Albers candidates match their respective numeric projection
parameters but use NAD83 / GRS80 rather than WGS84. LAEA candidates have different
centers. A public item named AlbersUSA actually advertises Web Mercator tiles.
No dedicated Puerto Rico/USVI source was established by these searches.

[Andy Skinner's supplied blog][blog] links public Alaska and CONUS web maps:
[9fcd343a29bf4162953a3b149d282521][ak-map] and
[d5ced59f40c341979d1b898f4b02c25a][us-map], both owned by `ajskinner3`.
The article describes creative prototypes based roughly on Human Geography and
does not guarantee data accuracy or permanent hosting. It permits style copies;
that is not a blanket license conclusion for every candidate below.

## Candidate Table

CM = central meridian; origin = latitude of origin; SP = standard parallels.
All angles are degrees. Tile origins are rounded to 0.001m here; linked service
JSON retains full precision. Resolution ranges are meters per tile pixel.
LOD ranges are inclusive; intermediate resolutions halve per level.

| Item ID / candidate | Owner | Intended region | WKID or WKT | CM / origin / SP | Tile origin x, y (m) | LODs / resolution range | Exact pane match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [024a6cb7914145099c6da7f2f3b5377c][ak-item], Alaska HG combined | ajskinner3 | Alaska-oriented basemap | 102006 / EPSG:3338 | -154 / 50 / 55, 65 | -13752085.613, 17926715.428 | 0..9 / 53719.084425..104.920087 | No: NAD83, not WGS84 |
| [3cdb16abfd994f50a516de501b781a15][us-item], CONUS HG combined | ajskinner3 | CONUS-oriented basemap | EPSG:5070 | -96 / 23 / 29.5, 45.5 | -16900977.340, 21063951.179 | 0..9 / 66019.442734..128.944224 | No: NAD83, not WGS84 |
| [99eafcf8471b47ad8a2784224a185d3d][hi-item], Hawaii Basemap | `ulei@ios.doi.gov_DOILDT` | Hawaii | ESRI:102007 | -157 / 13 / 8, 18 | -22487245.107, 24377978.108 | 0..18 / 87840.801201..0.335086 | No: NAD83, not WGS84 |
| [40e7ed773232428594fc677da7d6f76a][na-item], North America Albers | ajskinner2 | North America | ESRI:102008 | -96 / 40 / 20, 60 | -16687926.944, 18651550.238 | 0..9 / 65187.214627..127.318779 | No: parameters and datum differ |
| [2668883700a941faa8e9029bc4d3faa7][audubon-item], Audubon LAEA light color | `ryan.hobbs@audubon.org_audubon` | Americas-oriented; global bounds advertised | WKT A, WGS84 LAEA | -90 / 15 / not applicable | -12755292.014, 12755292.014 | 0..12 / 49825.359431..12.164394 | No: no pane has this center |
| [d6a80d74aeef4b5ea21f3cd8b473a09f][blank-item], Blank North America LAEA | dasbury_storymaps | Blank North America base; one fill style layer | WKT B, WGS84 LAEA | -100 / 44 / not applicable | -12749378.518, 12749378.518 | 0..18 / 49802.259836..0.189981 | No: CONUS uses -99 / 40 |
| [51c0a6ea859b406987e873e5c1a0915d][mercator-item], AlbersUSA (negative control) | dasbury_storymaps | Advertised bounds about 128W..69W, 24N..51N | 102100 / EPSG:3857 | Web Mercator, not Albers | -20037508.343, 20037508.343 | 0..23 / 78271.516964..0.009331 | No: wrong projection family |

The table lists style item owners, not an inferred owner of every underlying
package. Alaska's underlying service item is `94642f42c091492da896420ea8299349`;
CONUS's is `f542a61bdc874ca681cc3c5a92c61f55`. Those differ from style item IDs.

### Primary Service Metadata

- [Alaska Albers tileInfo, extent and service item][ak-service]
- [CONUS Albers tileInfo, extent and service item][us-service]
- [Hawaii Albers tileInfo and extent][hi-service]
- [North America Albers tileInfo and extent][na-service]
- [Audubon LAEA tileInfo and WKT][audubon-service]
- [Blank North America tileInfo and WKT][blank-service]
- [AlbersUSA actual Web Mercator tileInfo][mercator-service]

[ArcGIS REST documentation][rest-doc] identifies `tileInfo.spatialReference`,
`origin` and `lods` as the authoritative tiling metadata. Regional titles and
generic style `bounds: [-180,-90,180,90]` are not proof of detailed coverage in
Attu, Adak, Hawaii or PR/USVI. Individual vector tiles, glyphs, sprites and island
detail were not decoded/rendered in this research step. Blank-base styles are
not substitutes for a complete cartographic basemap.

### Blog Style Variants

These public style items were individually read; each Alaska variant points to
the same Alaska master service, and each CONUS variant to the same CONUS service.
Their CRS/origin/LODs therefore match their combined row above, not a new CRS.

| Region | Combined | Base | Detail | Labels |
| --- | --- | --- | --- | --- |
| Alaska | 024a6cb7914145099c6da7f2f3b5377c | 64669e24de264079baab3b49d5b2fcc5 | e9cd5393b0f54d6ab975d053faaac4bd | 0746c872a2394ea48d00829eed8251b6 |
| CONUS | 3cdb16abfd994f50a516de501b781a15 | 2463b564f6ef4dc8b8f9c1d2bf6d96a4 | dadd4d27b09a4f76ab6709aef51fa4c3 | 2a1e7b8dcee547a89c299ef8c8dc9777 |

Each variant's style is at
`https://www.arcgis.com/sharing/rest/content/items/<ID>/resources/styles/root.json`.
The combined variants are initially invisible in the linked web maps; base,
detail and labels compose their visible basemaps.

### Custom WKT

WKT A, from the Audubon service (whitespace added):

```text
PROJCS["Lambert_Azimuthal_Equal_Area",
  GEOGCS["GCS_WGS_1984",DATUM["WGS84",
    SPHEROID["WGS84",6378137.0,298.257223563]],
    PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],
  PROJECTION["Lambert_Azimuthal_Equal_Area"],
  PARAMETER["false_easting",0.0],PARAMETER["false_northing",0.0],
  PARAMETER["central_meridian",-90.0],
  PARAMETER["latitude_of_origin",15.0],UNIT["Meter",1.0]]
```

WKT B, from the owner's public blank-base service (whitespace added):

```text
PROJCS["Lambert Azimuthal Equal Area (North America)",
  GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",
    SPHEROID["WGS_1984",6378137.0,298.257223563]],
    PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],
  PROJECTION["Lambert_Azimuthal_Equal_Area"],
  PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],
  PARAMETER["Central_Meridian",-100.0],
  PARAMETER["Latitude_Of_Origin",44.0],UNIT["Meter",1.0]]
```

The WKID definitions were cross-checked against public registry exports:
[3338][epsg-ak], [5070][epsg-us], [102007][epsg-hi], [102008][epsg-na].
NAD83 definitions use GRS80 inverse flattening 298.257222101; the panes retain
WGS84 298.257223563. Do not call a datum substitution an exact match, even when
its effect is small at the prototype's scale. Appropriate datum operations and
their geographic applicability require explicit selection and testing.

## Search and Access Limits

Anonymous searches used `https://www.arcgis.com/sharing/rest/search`, `f=json`:

- `type:"Vector Tile Service" AND (Albers OR "Lambert Azimuthal")`: 149 results,
  first 100 inspected for candidates; not an exhaustive inventory.
- `owner:dasbury_storymaps AND type:"Vector Tile Service" AND (Lambert OR Albers)`:
  13 public results; no private owner content was accessed.
- `type:"Vector Tile Service" AND ("Lambert Azimuthal" OR LAEA)`: 38 results.
- Same LAEA query with `AND (Alaska OR Hawaii OR "Puerto Rico" OR USA)`: zero.
- `type:"Vector Tile Service" AND Albers AND (Hawaii OR "Puerto Rico")`: two,
  Hawaii Basemap and the Web Mercator AlbersUSA false positive.

These search responses were accessible; there was no authentication blockage.
Absence from text search is not evidence that no suitable service exists.
Item-level style resource requests for AlbersUSA, the Audubon candidate and
North America Albers returned HTTP/JSON item-resource errors (`CONT_009431`).
Their service-level `resources/styles/root.json` endpoints returned HTTP 200;
relative source URLs there resolve against the service, not the item resource.
No missing metadata was invented. Temporary evidence:
`/tmp/usa-map-vector-tiles.log` and `/tmp/usa-map-vector-tiles-extra.log`.

## Integration Decision

Keep vector tiles out of the current feature-only renderer. For a future exact
CRS match, decode MVT tile coordinates using that service's tile origin, LOD
resolution, tile dimensions and each MVT layer's extent; draw in pane projected
coordinates without inverse/reprojection. Still handle buffered tile overlap,
tile selection, caching, deduplication and clipping.

For a nonmatching source, reconstruct source projected coordinates, inverse to
source geographic coordinates, apply the required datum transformation to
WGS84, then use the pane projection. Densify and clip around projection/domain
boundaries and validate island continuity. This adds work and error budgets;
the service's native tiled detail is not equivalent to an untiled feature query.

Neither path solves styling automatically. Mapbox-style filters/expressions,
zoom-dependent paint/layout, glyphs, sprites, line joins/caps, patterns, labels
and collision placement are outside the current simple-symbol renderer.
Implement an explicit supported style subset or adopt a suitable renderer;
reject unsupported styles rather than silently substituting simple fills.
See [ADR-0002](adr/ADR-0002-single-canvas-webmap-prototype.md).

[blog]: https://www.esri.com/arcgis-blog/products/mapping/mapping/beyond-web-mercator-projected-basemaps-revisited
[ak-map]: https://www.arcgis.com/home/item.html?id=9fcd343a29bf4162953a3b149d282521
[us-map]: https://www.arcgis.com/home/item.html?id=d5ced59f40c341979d1b898f4b02c25a
[ak-item]: https://www.arcgis.com/home/item.html?id=024a6cb7914145099c6da7f2f3b5377c
[us-item]: https://www.arcgis.com/home/item.html?id=3cdb16abfd994f50a516de501b781a15
[hi-item]: https://www.arcgis.com/home/item.html?id=99eafcf8471b47ad8a2784224a185d3d
[na-item]: https://www.arcgis.com/home/item.html?id=40e7ed773232428594fc677da7d6f76a
[audubon-item]: https://www.arcgis.com/home/item.html?id=2668883700a941faa8e9029bc4d3faa7
[blank-item]: https://www.arcgis.com/home/item.html?id=d6a80d74aeef4b5ea21f3cd8b473a09f
[mercator-item]: https://www.arcgis.com/home/item.html?id=51c0a6ea859b406987e873e5c1a0915d
[ak-service]: https://tiles.arcgis.com/tiles/jIL9msH9OI208GCb/arcgis/rest/services/Albers_Alaska_master/VectorTileServer?f=pjson
[us-service]: https://tiles.arcgis.com/tiles/jIL9msH9OI208GCb/arcgis/rest/services/Albers_ContiguousUS/VectorTileServer?f=pjson
[hi-service]: https://tiles.arcgis.com/tiles/4OV0eRKiLAYkbH2J/arcgis/rest/services/Hawaii_Basemap/VectorTileServer?f=pjson
[na-service]: https://tiles.arcgis.com/tiles/nGt4QxSblgDfeJn9/arcgis/rest/services/Albers_North_America_basemap/VectorTileServer?f=pjson
[audubon-service]: https://tiles.arcgis.com/tiles/lDFzr3JyGEn5Eymu/arcgis/rest/services/Basemap_Testing_4_gallery/VectorTileServer?f=pjson
[blank-service]: https://tiles.arcgis.com/tiles/nzS0F0zdNLvs7nc8/arcgis/rest/services/Blank_Base_NorthAmerica_Lambert_Equal_Area/VectorTileServer?f=pjson
[mercator-service]: https://vectortileservices.arcgis.com/nzS0F0zdNLvs7nc8/arcgis/rest/services/AlbersUSA/VectorTileServer?f=pjson
[rest-doc]: https://developers.arcgis.com/rest/services-reference/enterprise/vector-tile-service/
[epsg-ak]: https://epsg.io/3338.wkt
[epsg-us]: https://epsg.io/5070.wkt
[epsg-hi]: https://epsg.io/102007.esriwkt
[epsg-na]: https://epsg.io/102008.wkt
