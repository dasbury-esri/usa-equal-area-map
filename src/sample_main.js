import Map from "@arcgis/core/Map.js";
import MapView from "@arcgis/core/views/MapView.js";
//import WebMap from "@arcgis/core/WebMap.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";

import "./style.css";


const map = new Map({
  basemap: "hybrid"
});

const view = new MapView({
  container: "mainViewDiv",
  map: map,

  extent: {
    // autocasts as new Extent()
    xmin: -9177811,
    ymin: 4247000,
    xmax: -9176791,
    ymax: 4247784,
    spatialReference: 102100
  }
});

// Log the view's center to ensure the variable is used
view.when(() => {
  console.log("MapView is ready at center:", view.center);
});

/********************
 * Add feature layer
 ********************/

// Carbon storage of trees in Warren Wilson College.
const featureLayer = new FeatureLayer({
  url: "https://services.arcgis.com/V6ZHFr6zdgNZuVG0/arcgis/rest/services/Landscape_Trees/FeatureServer/0"
});

map.add(featureLayer);

