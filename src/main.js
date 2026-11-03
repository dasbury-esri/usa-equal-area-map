import Map from "@arcgis/core/Map.js";
import MapView from "@arcgis/core/views/MapView.js";
//import WebMap from "@arcgis/core/WebMap.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
//import WFSLayer from "@arcgis/core/layers/WFSLayer.js";
//import ImageryLayer from "@arcgis/core/layers/ImageryLayer.js";
import Point from "@arcgis/core/geometry/Point.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import * as projectOperator from "@arcgis/core/geometry/operators/projectOperator.js";
//import * as Projection from "@arcgis/core/geometry/projection.js";
import SpatialReference from "@arcgis/core/geometry/SpatialReference.js";
import ScaleBar from "@arcgis/core/widgets/ScaleBar.js";
//import Compass from "@arcgis/core/widgets/Compass.js";
import Graphic from "@arcgis/core/Graphic.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import viewDefaults from "./view-defaults.js";
import "./style.css";

const urlParams = new URLSearchParams(window.location.search);
const globeTrial = urlParams.get("overview") === "globes";
const albersProj = urlParams.get("projection") === "albers";
const framingPreview = true;
if (framingPreview) window.framingPreviewCenters = new WeakMap();
if (globeTrial) document.body.classList.add("globe-trial");
if (albersProj) document.body.classList.add("albers-view");
if (globeTrial || albersProj || framingPreview) {
  const drawerFrame = document.getElementById("drawer-iframe");
  if (drawerFrame) {
    const drawerURL = new URL(drawerFrame.src);
    if (globeTrial) drawerURL.searchParams.set("overview", "globes");
    if (albersProj) drawerURL.searchParams.set("projection", "albers");
    if (framingPreview) drawerURL.searchParams.set("framing", "preview");
    drawerFrame.src = drawerURL.href;
  }
}

function disableDefaultPopupActions(view) {
  reactiveUtils.watch(() => view.popup?.viewModel, (viewModel) => {
    if (viewModel) viewModel.includeDefaultActions = false;
  }, { initial: true });
}

function connectScaleViews(views, isMainPage) {
  const frame = document.getElementById("drawer-iframe");
  const peer = isMainPage ? frame?.contentWindow : window.parent;
  let applyingScale = false;
  const canShareScale = () => !framingPreview || (isMainPage ? document : window.parent.document)
    .getElementById("drawer-container")?.classList.contains("drawer-open");
  const applyScale = (scale) => {
    if (!Number.isFinite(scale) || scale <= 0) return;
    applyingScale = true;
    try {
      for (const view of views) {
        if (Math.abs(view.scale - scale) > scale * 1e-8) view.scale = scale;
      }
    } finally {
      applyingScale = false;
    }
  };
  const sendScale = (scale) => {
    if (!canShareScale()) return;
    peer?.postMessage({ type: "usa-map-scale", scale }, window.location.origin);
  };
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== peer) return;
    if (isMainPage && event.data?.type === "usa-map-ready") {
      sendScale(views[0].scale);
    } else if (event.data?.type === "usa-map-scale" && canShareScale()) {
      applyScale(event.data.scale);
    }
  });
  for (const view of views) {
    reactiveUtils.watch(() => view.scale, (scale) => {
      if (applyingScale || !Number.isFinite(scale) || scale <= 0) return;
      applyScale(scale);
      sendScale(scale);
    }, { sync: true });
  }
  if (isMainPage) {
    sendScale(views[0].scale);
  } else if (peer !== window) {
    peer.postMessage({ type: "usa-map-ready" }, window.location.origin);
  }
}

function connectPrExtent(view, isMainPage) {
  const peer = isMainPage
    ? document.getElementById("drawer-iframe")?.contentWindow
    : window.parent;
  const origin = window.location.origin;
  if (!peer || peer === window) return;
  if (isMainPage) {
    const sendExtent = () => {
      if (view.extent) {
        peer.postMessage({ type: "usa-pr-extent", extent: view.extent.toJSON() }, origin);
      }
    };
    const onMessage = (event) => {
      if (event.origin === origin && event.source === peer
          && event.data?.type === "usa-pr-extent-ready") sendExtent();
    };
    window.addEventListener("message", onMessage);
    view.addHandles([
      reactiveUtils.watch(() => view.extent, sendExtent, { initial: true }),
      { remove() { window.removeEventListener("message", onMessage); } },
    ]);
    return;
  }
  const graphic = new Graphic({
    attributes: { inset: "pr" },
    symbol: {
      type: "simple-fill",
      color: [0, 0, 0, 0],
      outline: { color: [64, 64, 64, 0.5], width: "0.5px" },
    },
  });
  view.graphics.add(graphic);
  const onMessage = (event) => {
    if (event.origin !== origin || event.source !== peer
        || event.data?.type !== "usa-pr-extent") return;
    const extent = event.data.extent;
    if (!extent || !extent.spatialReference
        || ![extent.xmin, extent.ymin, extent.xmax, extent.ymax].every(Number.isFinite)
        || extent.xmin >= extent.xmax || extent.ymin >= extent.ymax) return;
    graphic.geometry = Extent.fromJSON(extent);
  };
  window.addEventListener("message", onMessage);
  view.addHandles({ remove() {
    window.removeEventListener("message", onMessage);
    view.graphics.remove(graphic);
  } });
  peer.postMessage({ type: "usa-pr-extent-ready" }, origin);
}

function connectZoomAnchor(view, defaults) {
  let manualCenter = null;
  let panning = false;
  const regionalCenter = projectOperator.execute(new Point({
    ...defaults.center,
    spatialReference: defaults.center.spatialReference ?? view.spatialReference,
  }), view.spatialReference);
  if (framingPreview) {
    return () => (window.framingPreviewCenters.get(view) ?? regionalCenter).clone();
  }
  const anchor = projectOperator.execute(new Point({
    ...defaults.zoomAnchor,
    spatialReference: { wkid: 4326 },
  }), view.spatialReference);
  const centerAtScale = () => {
    const progress = Math.max(0, Math.min(1,
      (defaults.scale - view.scale) / (defaults.scale - viewDefaults.zoomAnchorScale)
    ));
    return new Point({
      x: regionalCenter.x + (anchor.x - regionalCenter.x) * progress,
      y: regionalCenter.y + (anchor.y - regionalCenter.y) * progress,
      spatialReference: view.spatialReference,
    });
  };
  const startManualPan = () => {
    panning = true;
    manualCenter = view.center.clone();
  };
  view.addHandles([
    view.on("drag", (event) => {
      if (event.action === "update" && event.button === 0) startManualPan();
    }),
    view.on("key-down", (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        startManualPan();
      }
    }),
    view.on("mouse-wheel", () => { panning = false; }),
    reactiveUtils.watch(() => view.center, () => {
      if (panning) manualCenter = view.center.clone();
    }, { sync: true }),
    reactiveUtils.watch(() => view.stationary, (stationary) => {
      if (stationary && panning) {
        manualCenter = view.center.clone();
        panning = false;
      }
    }, { sync: true }),
  ]);
  view.addHandles(reactiveUtils.watch(() => view.scale, () => {
    panning = false;
    const center = manualCenter ?? centerAtScale();
    if (Math.hypot(view.center.x - center.x, view.center.y - center.y) > 1e-6) {
      view.center = center;
    }
  }, { sync: true }));
  return () => {
    manualCenter = null;
    panning = false;
    return centerAtScale();
  };
}

function addExtentLeader(overview, inset, graphic) {
  if (globeTrial) return;
  const namespace = "http://www.w3.org/2000/svg";
  const overlay = document.createElementNS(namespace, "svg");
  overlay.classList.add("extent-leader");
  overlay.dataset.inset = inset.container.id;
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("focusable", "false");
  const line = document.createElementNS(namespace, "line");
  line.setAttribute("visibility", "hidden");
  overlay.append(line);
  document.body.append(overlay);
  const render = () => {
    const extent = graphic.geometry;
    if (!extent || !overview.width || !overview.height) {
      line.setAttribute("visibility", "hidden");
      return;
    }
    const midpoint = projectOperator.execute(new Point({
      x: extent.xmax,
      y: (extent.ymin + extent.ymax) / 2,
      spatialReference: extent.spatialReference,
    }), overview.spatialReference);
    const target = midpoint && overview.toScreen(midpoint);
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)
        || target.x < 0 || target.x > overview.width
        || target.y < 0 || target.y > overview.height) {
      line.setAttribute("visibility", "hidden");
      return;
    }
    const bounds = overview.container.getBoundingClientRect();
    const panel = inset.container.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${overview.width}px`,
      height: `${overview.height}px`,
    });
    line.setAttribute("x1", panel.left + panel.width / 4 - bounds.left);
    line.setAttribute("y1", Math.min(overview.height, panel.top - bounds.top));
    line.setAttribute("x2", target.x);
    line.setAttribute("y2", target.y);
    line.setAttribute("visibility", "visible");
  };
  const handle = reactiveUtils.watch(
    () => [graphic.geometry, overview.center, overview.scale, overview.rotation],
    render,
    { initial: true }
  );
  const observer = new ResizeObserver(render);
  observer.observe(overview.container);
  observer.observe(inset.container);
  overview.addHandles({ remove() {
    handle.remove();
    observer.disconnect();
    overlay.remove();
  } });
}

const App =  () => {
    return projectOperator.load().then(async () => {
        if (projectOperator.isLoaded()) {
            console.log("projectOperator is loaded");
            // Add your projection parameters or logic here
        } else {
            console.error("Failed to load projectOperator");
        }
 {
    //Projection parameters              
    {
    // Lambert Equal Area Projection for continental US
    var conusSR = new SpatialReference(
      viewDefaults.main.drawerOpenCenter.spatialReference);
    // Lambert Equal Area projection for Alaska map
    var akSR = new SpatialReference(
        'PROJCS["Lambert Azimuthal Equal Area_Alaska",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-148.0],PARAMETER["Latitude_Of_Origin",64.0],UNIT["Meter",1.0]]');
    // Lambert Equal Area projection for Hawaii map
    var hiSR = new SpatialReference(
        'PROJCS["Lambert Azimuthal Equal Area_Hawaii",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-156.0],PARAMETER["Latitude_Of_Origin",20.0],UNIT["Meter",1.0]]');
    // Lambert Equal Area Projection for Puerto Rico/US Virgin Islands map
    var prSR = new SpatialReference(
        'PROJCS["Lambert Azimuthal Equal Area_PR_VI",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-65.5],PARAMETER["Latitude_Of_Origin",18.0],UNIT["Meter",1.0]]');
    // Lambert Equal Area Projection for Guam/Northern Marianas map
    var guSR = new SpatialReference(
        'PROJCS["Lambert Azimuthal Equal Area_GU_MP",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",145.0],PARAMETER["Latitude_Of_Origin",16.0],UNIT["Meter",1.0]]');
    // Lambert Equal Area Projection for American Samoa map
    var asSR = new SpatialReference(
        'PROJCS["Lambert Azimuthal Equal Area_AS",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-170.0],PARAMETER["Latitude_Of_Origin",-14.0],UNIT["Meter",1.0]]');
    // Lambert Equal Area Projection for Overview map
    var overviewSR = new SpatialReference(
        'PROJCS["Lambert Azimuthal Equal Area_US_global_extent",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-140.0],PARAMETER["Latitude_Of_Origin",17.25],UNIT["Meter",1.0]]');
    }

    {
    // Albers Equal Area Projection for continental US
    var conusAlbersSR = new SpatialReference(
      'PROJCS["Albers Equal Area_US",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-96.0],PARAMETER["Standard_Parallel_1",29.5],PARAMETER["Standard_Parallel_2",45.5],PARAMETER["Latitude_Of_Origin",23.0],UNIT["Meter",1.0]]');
    // Albers Equal Area Projection for Alaska map
    var akAlbersSR = new SpatialReference(
      'PROJCS["Albers Equal Area_AK",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-146.0],PARAMETER["Standard_Parallel_1",55.0],PARAMETER["Standard_Parallel_2",65.0],PARAMETER["Latitude_Of_Origin",50.0],UNIT["Meter",1.0]]');
    // Albers Equal Area Projection for Hawaii map
    var hiAlbersSR = new SpatialReference(
      'PROJCS["Albers Equal Area_HI",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-157.0],PARAMETER["Standard_Parallel_1",8.0],PARAMETER["Standard_Parallel_2",18.0],PARAMETER["Latitude_Of_Origin",13.0],UNIT["Meter",1.0]]');
    // Albers Equal Area Projection for Puerto Rico map
    var prAlbersSR = new SpatialReference(
      'PROJCS["Albers Equal Area_PR",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-66.5],PARAMETER["Standard_Parallel_1",18.0],PARAMETER["Standard_Parallel_2",20.0],PARAMETER["Latitude_Of_Origin",17.0],UNIT["Meter",1.0]]');
    // Albers Equal Area Projection for Guam/Northern Marianas map
    var guAlbersSR = new SpatialReference(
      'PROJCS["Albers Equal Area_Guam",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",145.0],PARAMETER["Standard_Parallel_1",13.0],PARAMETER["Standard_Parallel_2",15.0],PARAMETER["Latitude_Of_Origin",12.0],UNIT["Meter",1.0]]');
    // Albers Equal Area Projection for American Samoa map
    var asAlbersSR = new SpatialReference(
      'PROJCS["Albers Equal Area_AS",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-170.0],PARAMETER["Standard_Parallel_1",-14.0],PARAMETER["Standard_Parallel_2",-10.0],PARAMETER["Latitude_Of_Origin",-13.0],UNIT["Meter",1.0]]');
    // Albers Equal Area Projection for Overview map
    var overviewAlbersSR = new SpatialReference(
      'PROJCS["Albers Equal Area_Overview",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-140.0],PARAMETER["Standard_Parallel_1",29.5],PARAMETER["Standard_Parallel_2",45.5],PARAMETER["Latitude_Of_Origin",23.0],UNIT["Meter",1.0]]');
    }

    var defaultLayer = new FeatureLayer({
      id: "defaultLayer",
        //url: "https://mtgis-server.geo.census.gov/arcgis/rest/services/BAS_Viewer/BAS22_Participation/MapServer",
      portalItem: {
        //id:"6ac5e325468c4cb9b905f1728d6fbf0f" // US Federally supported hospital points (includes Palau)
        //id:"df53bb7c871b4e13a59e4310a581a917" // County boundaries from HiFLD
        //id:"49c25e0ce50340e08fcfe51fe6f26d1e" // Covid trends
        //id:"c93f8a9f2a614ff8a31db732636eff9b" // 2022 Zip Codes from Esri Data/Maps 
        //id:"cb1886ff0a9d4156ba4d2fadd7e8a139" // Current wind station data
        //id:"d957997ccee7408287a963600a77f61f" // Current wildfires
        //id:"5e92f2e0930848faa40480bcb4fdc44e" // USA Federal Lands
        //id:"79461a1ec0974301bde274177c7108bd" // Earthquake archive
        //id:"f097586198b94149965206a8f2471dbf" // USA Territorial Sea Boundary (requires subscriber token)
        //id:"0ddda259c5c443cc9c5927132644b961" // NOAA Maritime Boundaries (Map Service) 
        //id:"e2e7bcb7fdaf41f2a97b5f540e0d5433" // 117th Congressional Districts
        id: "6100fd30484645e6b3ec7006d95aa7b8" // 119th Congressional Districts
        //id: "2706fbe2d7c74b488a609938df8f9578" // USA Airport Areas (Esri Data and Maps)
        //id:"dd834ef507244f96baa6b29eab5dd396" // 2019 Population density
        //id: "67ab7f7c535c4687b6518e6d2343e8a2" // Ocean basemap
        //id: "055f54c736c44955a2f2e808df5280b1" // National Water Model Maximum Flow (10 Day Forecast)
        //id: "6ec4f16b6f334cedab28bb7c585ff410" // Environmental Justice Grants (Public Environmental Data Partners)
      },
      sharedViews: true,
    });
    var airportRunways = new FeatureLayer({ 
      id: "airportRunways",
      portalItem: {
        id: "08e8e12f50e344e5a23484b86735980d" // USA Airport Runways
      },
      popupEnabled: false,
      // Set the minimum and maximum scale for the layer
      minScale: 1000000,
      maxScale: 1000,
      sharedViews: true,
    });
    var airportGrounds = new FeatureLayer({ 
      id: "airportGrounds",
      portalItem: {
        id: "88048f0a1fbd4a84b7628a8d0c082b78" // USA Airport Grounds
      },
      // Set the minimum and maximum scale for the layer
      minScale: 1000000,
      maxScale: 1000,
      sharedViews: true,
    });
/*    var imageryLayer = new ImageryLayer({
        id: "imageryLayer",
        portalItem:{
          //id: "901cc91db11f4ec79b21decbf5677aaf" // Precip Imagery
          id: "275e8cef559e4d75a0f10ba93d553ecd" // Black Marble VIIRS composite (Black and White)
          //id: "2232d6e5d932492292072f941dcc4a3b" // Black Marble VIIRS composite (Blue / Yellow)
        },
        sharedViews: true,
    });
 */   var latlongLayer = new FeatureLayer({
        id: "latlongLayer",
        portalItem:{
          id:"278e3884c50649baba4910a6d7b39922"
        },
        popupEnabled: false,
        sharedViews: true,
    });
    var latlong180Layer = new FeatureLayer({
        id: "latlong180Layer",
        portalItem:{
          id:"3d47090c1ecc4fb1a84458cbc0274888"
        },
        popupEnabled: false,
        sharedViews: true,
    });
 /*   var eezLayer = new WFSLayer({
      id: "eezLayer",
      portalItem:{
        id:"fb31317c56b8485b967f5eccd1371ed3",
      },
      definitionExpression: "sovereign1 = 'United States' OR sovereign2 = 'United States'",
      sharedViews: true,
    });
    var freeAssocLayer = new WFSLayer({
      id: "freeAssocLayer",
      portalItem:{
        id:"fb31317c56b8485b967f5eccd1371ed3",
      },
      definitionExpression: "sovereign1 = 'Palau' OR sovereign1 = 'Micronesia' OR sovereign1 = 'Marshall Islands'",
      sharedViews: true,
    });
*/
    var backgroundLayer = new FeatureLayer({
        id: "backgroundLayer",
        portalItem:{
          id:"acc8fccf06d74364bffe6a9bd0dfded7" // Admin-0 World Countries
        },
        legendEnabled: false,
        renderer: {
          type: "simple", // autocasts as new SimpleRenderer()
          symbol: {
            type: "simple-fill", // autocasts as new SimpleFillSymbol()
            color: [235, 235, 235, 1],
            outline: {
              color: [210, 210, 210, 1],
              width: 0.5
            }
          }
        },
        popupEnabled: false,
        sharedViews: true,
      });

      var usStatesLayer = new FeatureLayer({
        id: "usStatesLayer",
        portalItem:{
          id:"2816c6a03f0740e9b13d563b93e60b9d" // Admin-1 World Countries
        },
        definitionExpression: "COUNTRYAFF = 'United States'",
        legendEnabled: false,
        renderer: {
          type: "simple", // autocasts as new SimpleRenderer()
          symbol: {
            type: "simple-fill", // autocasts as new SimpleFillSymbol()
            color: [235, 235, 235, 1],
            outline: {
              color: [210, 210, 210, 1],
              width: 0.5
            }
          }
        },
        popupEnabled: false,
        sharedViews: true,
      });

      const contextLayer = new FeatureLayer({
        id: "contextLayer",
        portalItem: {
          id: "42430a34a2b44c0da678ce60ce20dd31"
        },
        blendMode: "normal",
        popupEnabled: false,
      });

      const usOutlyingAreasLayer = new FeatureLayer({
        id: "usOutlyingAreasLayer",
        portalItem: {
          id: "bbda2d6bc77c495ab382e313f02888f1"
        },
        blendMode: "normal",
        popupEnabled: false,
        renderer: {
          type: "simple",
          symbol: {
            type: "simple-fill",
            color: [220, 40, 40, 1],
            outline: {
              color: [170, 20, 20, 1],
              width: 0.5
            }
          }
        },
      });

      var oceanLayer = new FeatureLayer({
        id: "oceanLayer",
        portalItem:{
          id:"1f43d235ed7d42899b9e4a7214d913e4"
        },
        legendEnabled: false,
        renderer: {
          type: "simple", // autocasts as new SimpleRenderer()
          symbol: {
            type: "simple-fill", // autocasts as new SimpleFillSymbol()
            color: [220, 220, 220, 1],
            outline: {
              color: [150, 150, 150, 0],
              width: 0
            }
          }
        },
        sharedViews: true,
      }); 
    // If no parameters are specified in the url, display the default map
    var layer = defaultLayer;
    var layerMap = new Map({
      layers: [oceanLayer,latlongLayer, latlong180Layer, backgroundLayer, usStatesLayer, contextLayer, usOutlyingAreasLayer, layer, airportGrounds, airportRunways] //imageryLayer] //oceanLayer,
    });
    var map = layerMap;
    var scale = viewDefaults.main.scale;
    if (document.getElementById("mainViewDiv")) {
    // CONUS map
    // Set the center point for the view
    let conusViewCenterPt = new Point(viewDefaults.main.center);
  const mainView = new MapView({
      container: "mainViewDiv",
      map: map,
      popup: {
        highlightEnabled: false,
        dockEnabled: true,
        dockOptions: {
          breakpoint: false,
          buttonEnabled: false,
          position: "top-center"
        }
      },
      center: conusViewCenterPt,
      scale: scale,
      rotation: viewDefaults.main.rotation,
      spatialReference: albersProj ? conusAlbersSR : conusSR,
      ui: {
        components: []
      }
    });
    // Make mainView globally accessible
    window.mainView = mainView;
    console.log("mainView has been attached to the window object:", window.mainView);
    if (typeof mainView === "undefined") {
      console.error("mainView is not defined. Ensure map2.js is loaded and mainView is attached to the window object.");
    }
    let scaleBar = new ScaleBar({
      view: mainView,
      unit: "dual" // Options are metric, imperial, or dual
    });
    // Add widget to the bottom left corner of the view
    mainView.ui.add(scaleBar, {
      position: "bottom-left"
    });
    // Turn off unwanted layers in CONUS map
    mainView.on("layerview-create", (event) => {
        if (event.layer.id === "latlongLayer") {
          event.layerView.visible = false;
        }
        else if (event.layer.id === "latlong180Layer") {
          event.layerView.visible = false;
        }
        else if (event.layer.id === "eezLayer") {
          event.layerView.visible = false;
        }  
        else if (event.layer.id === "freeAssocLayer") {
          event.layerView.visible = false;
        }  
      });
    // Print the map scale to the console
    console.log("Scale: " + mainView.scale);
    await mainView.when();
    reactiveUtils.watch(() => mainView.scale, (newScale) => {
      const label = document.getElementById("mainViewScaleValue");
      if (label) label.textContent = Math.round(newScale).toLocaleString();
    }, { initial: true });
    disableDefaultPopupActions(mainView);
    const prView = new MapView({
      container: "prViewDiv",
      map,
      spatialReference: albersProj ? prAlbersSR : prSR,
      center: new Point(viewDefaults.puertoRico.center),
      scale: mainView.scale,
      rotation: viewDefaults.puertoRico.rotation,
      popup: {
        highlightEnabled: false,
        dockEnabled: true,
        dockOptions: { breakpoint: false, buttonEnabled: false, position: "top-center" },
      },
      ui: { components: [] },
    });
    window.prView = prView;
    prView.on("layerview-create", (event) => {
      if (["latlongLayer", "latlong180Layer"].includes(event.layer.id)) {
        event.layerView.visible = false;
      }
    });
    prView.ui.add(new ScaleBar({ view: prView, unit: "dual" }), "bottom-left");
    disableDefaultPopupActions(prView);
    const prCenterAtScale = connectZoomAnchor(prView, viewDefaults.puertoRico);
    connectPrExtent(prView, true);
    connectScaleViews([mainView, prView], true);
    if (globeTrial) {
      const { addLocatorGlobe } = await import("./locator-globe.js");
      addLocatorGlobe(mainView, "Continental US");
      await prView.when();
      addLocatorGlobe(prView, "Puerto Rico / USVI", prCenterAtScale);
    }
    return mainView;
    }
    if (!document.getElementById("akViewDiv")) return null;
    // Alaska map
    let akViewCenterPt = new Point({
        ...viewDefaults.alaska.center,
        spatialReference: akSR
    });
    const akView = new MapView({
        container: "akViewDiv",
        map: map,
        popup: {
          highlightEnabled: false,
          dockEnabled: true,
          dockOptions: {
            breakpoint: false,
            buttonEnabled: false,
            position: "top-center"
          }
        },
        center: akViewCenterPt,
        scale: viewDefaults.alaska.scale,
        rotation: viewDefaults.alaska.rotation,
        spatialReference: albersProj ? akAlbersSR : akSR,
        ui: {
          components: []//["attribution"]
        }
    });
    // Turn off unwanted layers in Alaska map
    akView.on("layerview-create", (event) => {
      if (event.layer.id === "latlongLayer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "latlong180Layer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "eezLayer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "freeAssocLayer") {
        event.layerView.visible = false;
      }  
    });

    let akScaleBar = new ScaleBar({
      view: akView,
      unit: "dual" // Options are metric, imperial, or dual
    });
    // Add widget to the bottom left corner of the view
    akView.ui.add(akScaleBar, {
      position: "bottom-left"
    });
/*        let akCompass = new Compass({
      view: akView
    });
    akView.ui.add(akCompass, {
      position: "top-right",
    });*/
    // Make akView globally accessible
    window.akView = akView;
    console.log("akView has been attached to the window object:", window.akView);
    if (typeof akView === "undefined") {
      console.error("akView is not defined. Ensure map2.js is loaded and akView is attached to the window object.");
    }
/*    var overviewMap = new WebMap({
        portalItem: {
            //id: "84fde078b9c7464a94bb890c24aee634" // US and EEZs
            id: "0296c8ff596c456c94307c1709288d1a" // Feature layer basemap
        }
    });
*/    // Overview map
    let overViewCenterPt = new Point({
        ...viewDefaults.overview.center,
        spatialReference: overviewSR
    });

    const overView = new MapView({
        container: "overViewDiv",
        map: map,
        background: { 
          color: "#DCDCDC" 
        },
        popup: {
          highlightEnabled: false,
          dockEnabled: true,
          dockOptions: {
            breakpoint: false,
            buttonEnabled: false,
            position: "top-center"
          }
        },
        center: overViewCenterPt,
        scale: viewDefaults.overview.scale,
        rotation: viewDefaults.overview.rotation,
        constraints: {
          rotationEnabled: true
        },
        spatialReference: albersProj ? overviewAlbersSR : overviewSR,
        ui: {
          components: []//["attribution"]
        }
    });
    let ovScaleBar = new ScaleBar({
      view: overView,
      unit: "dual" // Options are metric, imperial, or dual
    });
    overView.ui.add(ovScaleBar, {
      position: "bottom-right"
    });
    // Turn off unwanted layers in GU/MP
    overView.on("layerview-create", (event) => {
      if (event.layer.id === "imageryLayer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "airportRunways") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "airportGrounds") {
        event.layerView.visible = false;
      }
    });          
/*        let ovCompass = new Compass({
      view: overView
    });
    overView.ui.add(ovCompass, {
      position: "bottom-left",
    });*/

    // Guam/Northern Marianas map
    let guViewCenterPt = new Point({
        ...viewDefaults.guam.center,
        spatialReference: guSR
    });

    const guView = new MapView({
        container: "guViewDiv",
        map: map,
        popup: {
          highlightEnabled: false,
          dockEnabled: true,
          dockOptions: {
            breakpoint: false,
            buttonEnabled: false,
            position: "top-center"
          }
        },
        center: guViewCenterPt,
        scale: viewDefaults.guam.scale,
        rotation: viewDefaults.guam.rotation,
        spatialReference: albersProj ? guAlbersSR : guSR,
        ui: {
          components: []//["attribution"]
        }
    });
    let guScaleBar = new ScaleBar({
      view: guView,
      unit: "dual" // Options are metric, imperial, or dual
    });
    // Add widget to the bottom left corner of the view
    guView.ui.add(guScaleBar, {
      position: "bottom-left"
    });
    // Turn off unwanted layers in GU/MP
    guView.on("layerview-create", (event) => {
      if (event.layer.id === "latlongLayer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "latlong180Layer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "eezLayer") {
        event.layerView.visible = false;
      }  
      else if (event.layer.id === "freeAssocLayer") {
        event.layerView.visible = false;
      }  
    });
    // American Samoa map
    let asViewCenterPt = new Point({
        ...viewDefaults.americanSamoa.center,
        spatialReference: asSR
    });
    const asView = new MapView({
        container: "asViewDiv",
        map: map,
        popup: {
          highlightEnabled: false,
          dockEnabled: true,
          dockOptions: {
            breakpoint: false,
            buttonEnabled: false,
            position: "top-center"
          }
        },
        center: asViewCenterPt,
        scale: viewDefaults.americanSamoa.scale,
        rotation: viewDefaults.americanSamoa.rotation,
        spatialReference: albersProj ? asAlbersSR : asSR,
        ui: {
          components: []//["attribution"]
        }
    });
    let asScaleBar = new ScaleBar({
      view: asView,
      unit: "dual" // Options are metric, imperial, or dual
    });
    // Add widget to the bottom left corner of the view
    asView.ui.add(asScaleBar, {
      position: "bottom-left"
    });
    // Turn off unwanted layers in AS map
    asView.on("layerview-create", (event) => {
      if (event.layer.id === "latlongLayer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "latlong180Layer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "eezLayer") {
        event.layerView.visible = false;
      }  
      else if (event.layer.id === "freeAssocLayer") {
        event.layerView.visible = false;
      }  
    });
    // Hawaii map
    let hiViewCenterPt = new Point({
        ...viewDefaults.hawaii.center,
        spatialReference: hiSR
    });
    const hiView = new MapView({
        container: "hiViewDiv",
        map: map,
        popup: {
          highlightEnabled: false,
          dockEnabled: true,
          dockOptions: {
            breakpoint: false,
            buttonEnabled: false,
            position: "top-center"
          }
        },
        center: hiViewCenterPt,
        scale: viewDefaults.hawaii.scale,
        rotation: viewDefaults.hawaii.rotation,
        spatialReference: albersProj ? hiAlbersSR : hiSR,
        ui: {
          components: []//["attribution"]
        }
    });
    let hiScaleBar = new ScaleBar({
      view: hiView,
      unit: "dual" // Options are metric, imperial, or dual
    });
    // Add widget to the bottom left corner of the view
    hiView.ui.add(hiScaleBar, {
      position: "bottom-left"
    });
    // Turn off unwanted layers in HI map
    hiView.on("layerview-create", (event) => {
      if (event.layer.id === "latlongLayer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "latlong180Layer") {
        event.layerView.visible = false;
      }
      else if (event.layer.id === "eezLayer") {
        event.layerView.visible = false;
      }  
      else if (event.layer.id === "freeAssocLayer") {
        event.layerView.visible = false;
      }  
    });
    akView.when(() => {
        console.log("Alaska Map and View are ready");
        // Watch for changes to the scale property
        reactiveUtils.watch(() => akView.scale, (newScale) => {
          console.log("akView scale changed:", newScale);
          // Update the akScaleValue span
          const akScaleValueSpan = document.getElementById("akScaleValue");
          if (akScaleValueSpan) {
            akScaleValueSpan.textContent = Math.round(newScale).toLocaleString();
          }
        });
        // Initialize the scale value on page load
        const akScaleValueSpan = document.getElementById("akScaleValue");
        if (akScaleValueSpan) {
          akScaleValueSpan.textContent = Math.round(akView.scale).toLocaleString();
        }            
        }).catch((error) => {
        console.error("Error loading the Alaska map view:", error);
        });
    guView.when(() => {
        console.log("GU/MP Map and View are ready");
        }).catch((error) => {
        console.error("Error loading the GU/MP map view:", error);
        });
    asView.when(() => {
        console.log("AS Map and View are ready");
        }).catch((error) => {
        console.error("Error loading the AS map view:", error);
        });
    hiView.when(() => {
        console.log("HI Map and View are ready");
        }).catch((error) => {
        console.error("Error loading the HI map view:", error);
        });
    //remove zoom widgets from popup
    for (const view of [akView, overView, guView, asView, hiView]) {
      disableDefaultPopupActions(view);
    }
    
    // Add an extent box to the overview map from the GU/MP map
    overView.when(() => {
      guView.when(() => {
        guExtentSetup();
      });
    });
    function guExtentSetup() {
      const guExtentGraphic = new Graphic({
        geometry: null,
        symbol: {
          type: "simple-fill",
          color: [0, 0, 0, 0],
          outline: {  // autocasts as new SimpleLineSymbol()
            color: [64, 64, 64, 0.5],
            width: "0.5px"
          }
        }
      });
      overView.graphics.add(guExtentGraphic);
      addExtentLeader(overView, guView, guExtentGraphic);

      reactiveUtils.watch(
        () => guView.extent,
        (extent) => {
          guExtentGraphic.geometry = extent;
        },
        {
          initial: true
        }
      );
    }     
    // Add an extent box to the overview map from the AS map
    overView.when(() => {
        asView.when(() => {
          asExtentSetup();
        });
      });
      function asExtentSetup() {
        const asExtentGraphic = new Graphic({
          geometry: null,
          symbol: {
            type: "simple-fill",
            color: [0, 0, 0, 0],
            outline: {  // autocasts as new SimpleLineSymbol()
              color: [64, 64, 64, 0.5],
              width: "0.5px"
            }
          }
        });
        overView.graphics.add(asExtentGraphic);
        addExtentLeader(overView, asView, asExtentGraphic);

        reactiveUtils.watch(
          () => asView.extent,
          (extent) => {
            asExtentGraphic.geometry = extent;
          },
          {
            initial: true
          }
        );
      }
    // Add an extent box to the overview map from the HI map
    overView.when(() => {
        hiView.when(() => {
          hiExtentSetup();
        });
      });
      function hiExtentSetup() {
        const hiExtentGraphic = new Graphic({
          geometry: null,
          symbol: {
            type: "simple-fill",
            color: [0, 0, 0, 0],
            outline: {  // autocasts as new SimpleLineSymbol()
              color: [64, 64, 64, 0.5],
              width: "0.5px"
            }
          }
        });
        overView.graphics.add(hiExtentGraphic);
        addExtentLeader(overView, hiView, hiExtentGraphic);

        reactiveUtils.watch(
          () => hiView.extent,
          (extent) => {
            hiExtentGraphic.geometry = extent;
          },
          {
            initial: true
          }
        );
      }
      connectPrExtent(overView, false);

      await Promise.all([akView, guView, asView, hiView].map((view) => view.when()));
      const insetViews = [
        [akView, "Alaska", { ...viewDefaults.alaska, center: akViewCenterPt.toJSON() }],
        [guView, "Guam / CNMI", { ...viewDefaults.guam, center: guViewCenterPt.toJSON() }],
        [asView, "American Samoa", { ...viewDefaults.americanSamoa, center: asViewCenterPt.toJSON() }],
        [hiView, "Hawaii", { ...viewDefaults.hawaii, center: hiViewCenterPt.toJSON() }],
      ].map(([view, label, defaults]) => [view, label, connectZoomAnchor(view, defaults)]);
      connectScaleViews([akView, guView, asView, hiView], false);
      if (framingPreview) {
        akView.addHandles(reactiveUtils.watch(() => [akView.width, akView.height], () => {
          window.frameElement?.dispatchEvent(new Event("framing-preview-resize"));
        }));
      }
      if (globeTrial) {
        const { addLocatorGlobe } = await import("./locator-globe.js");
        for (const [view, label, centerAtScale] of insetViews) {
          addLocatorGlobe(view, label, centerAtScale);
        }
      }
};
}).catch((error) => {
    console.error("Error loading projectOperator:", error);
});
}
export default App;

window.mainViewReady = App();
if (framingPreview && document.getElementById("mainViewDiv")) {
  window.framingPreviewReady = window.mainViewReady.then(async (view) => {
    const { connectFramingPreview } = await import("./framing-preview.js");
    return connectFramingPreview(view);
  });
  window.framingPreviewReady.catch(error => console.error("Could not initialize framing preview", error));
}