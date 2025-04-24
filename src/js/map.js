window.mainViewReady = new Promise((resolve, reject) => {

require([
    "esri/views/MapView",
    "esri/Map",
    "esri/WebMap",
    "esri/layers/WFSLayer",
    "esri/geometry/Point",
    "esri/layers/FeatureLayer",
    "esri/layers/ImageryLayer",
    "esri/geometry/projection",
    "esri/geometry/SpatialReference",
    "esri/widgets/ScaleBar",
    "esri/widgets/Compass",
    "esri/Graphic", 
    "esri/core/reactiveUtils", 
    "esri/core/promiseUtils"
  ], (MapView, Map, WebMap, WFSLayer, Point, FeatureLayer, ImageryLayer, projection, SpatialReference, ScaleBar, Compass, Graphic, reactiveUtils, promiseUtils) => {
    projection.load().then(function() {
        //Projection parameters              
        {
        // Lambert Equal Area Projection for continental US
        var conusSR = new SpatialReference(
            'PROJCS["Lambert Azimuthal Equal Area_North America_alt",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-99.0],PARAMETER["Latitude_Of_Origin",40.0],UNIT["Meter",1.0]]');
        // Lambert Equal Area projection for Alaska map
        var akSR = new SpatialReference(
            'PROJCS["Lambert Azimuthal Equal Area_Alaska",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-148.0],PARAMETER["Latitude_Of_Origin",64.0],UNIT["Meter",1.0]]');
        // Lambert Equal Area projection for Hawaii map
        var hiSR = new SpatialReference(
            'PROJCS["Lambert Azimuthal Equal Area_Hawaii",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-156.0],PARAMETER["Latitude_Of_Origin",20.0],UNIT["Meter",1.0]]');
        // Lambert Equal Area Projection for Puerto Rico map
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
            'PROJCS["Lambert Azimuthal Equal Area_US_global_extent",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-148.0],PARAMETER["Latitude_Of_Origin",17.25],UNIT["Meter",1.0]]');
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
            //id: "6100fd30484645e6b3ec7006d95aa7b8" // 119th Congressional Districts
            //id: "2706fbe2d7c74b488a609938df8f9578" // USA Airport Areas (Esri Data and Maps)
            //id:"dd834ef507244f96baa6b29eab5dd396" // 2019 Population density
            //id: "67ab7f7c535c4687b6518e6d2343e8a2" // Ocean basemap
            //id: "055f54c736c44955a2f2e808df5280b1" // National Water Model Maximum Flow (10 Day Forecast)
            id: "6ec4f16b6f334cedab28bb7c585ff410" // Environmental Justice Grants (Public Environmental Data Partners)
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
        var imageryLayer = new ImageryLayer({
            id: "imageryLayer",
            portalItem:{
              //id: "901cc91db11f4ec79b21decbf5677aaf" // Precip Imagery
              id: "275e8cef559e4d75a0f10ba93d553ecd" // Black Marble VIIRS composite (Black and White)
              //id: "2232d6e5d932492292072f941dcc4a3b" // Black Marble VIIRS composite (Blue / Yellow)
            },
            sharedViews: true,
        });
        var latlongLayer = new FeatureLayer({
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
        var eezLayer = new WFSLayer({
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

        var backgroundLayer = new FeatureLayer({
            id: "backgroundLayer",
            portalItem:{
              id:"75ea506613f847e48ab0f91e93ac538d" // Admin-0 World Countries
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
              id:"1ec2ffa0ebd34e4eac694adb9fa18184" // Admin-1 World Countries
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
          layers: [oceanLayer,latlongLayer, latlong180Layer, backgroundLayer, usStatesLayer, layer, airportGrounds, airportRunways] //imageryLayer] //oceanLayer,
        });
        var map = layerMap;
        var scale = 24000000;
        // CONUS map
        // Set the center point for the view
        let conusViewCenterPt = new Point({
          x: -97,
          y: 38,
          spatialReference: {
          wkid: 4326  
          }
      });
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
          spatialReference: conusSR,
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
        var mainViewScale = mainView.scale;
        // Alaska map
        let akViewCenterPt = new Point({
            x: -161.5,
            y: 62.5,
            spatialReference: {
              wkid: 4326  
            }
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
            scale: mainViewScale,
            spatialReference: akSR,
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
          position: "top-left"
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
        var overviewMap = new WebMap({
            portalItem: {
                //id: "84fde078b9c7464a94bb890c24aee634" // US and EEZs
                id: "0296c8ff596c456c94307c1709288d1a" // Feature layer basemap
            }
        });
        // Overview map
        let overViewCenterPt = new Point({
            x: -154,
            y: 23,
            spatialReference: {
              wkid: 4326  
            }
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
            scale: 110000000,
            rotation: 20,
            constraints: {
              rotationEnabled: false
            },
            spatialReference: overviewSR,
            ui: {
              components: []//["attribution"]
            }
        });
        let ovScaleBar = new ScaleBar({
          view: overView,
          unit: "dual" // Options are metric, imperial, or dual
        });
        // Add widget to the bottom left corner of the view
        overView.ui.add(ovScaleBar, {
          position: "bottom-left"
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
            x: 143,
            y: 16.8,
            spatialReference: {
              wkid: 4326  
            }
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
            scale: mainViewScale,
            spatialReference: guSR,
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
            x: -170,
            y: -13.8,
            spatialReference: {
              wkid: 4326  
            }
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
            scale: mainViewScale,
            spatialReference: asSR,
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
            x: -158,
            y: 20.5,
            spatialReference: {
              wkid: 4326  
            }
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
            scale: mainViewScale,
            spatialReference: hiSR,
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
        // Resolve the Promise when mainView is ready
        mainView.when(() => {
          resolve(mainView);
          // Watch for changes to the scale property
          mainView.watch("scale", (newScale) => {
            console.log("mainView scale changed:", newScale);
            // Update the mainViewScaleValue span
            const mainViewScaleValueSpan = document.getElementById("mainViewScaleValue");
            if (mainViewScaleValueSpan) {
              mainViewScaleValueSpan.textContent = Math.round(newScale).toLocaleString();
            }
          });
          // Initialize the scale value on page load
          const mainViewScaleValueSpan = document.getElementById("mainViewScaleValue");
          if (mainViewScaleValueSpan) {
            mainViewScaleValueSpan.textContent = Math.round(mainView.scale).toLocaleString();
          }           
      /*    const attributionWidget = mainView.ui.find("attribution");
          // Append the attribution widget to the custom container
          const customContainer = document.getElementById("customAttributionText");
          if (customContainer) {
            customContainer.appendChild(attributionWidget.container);
          } else {
            console.error("Custom attribution container not found.");
          }    */      
        }).catch((error) => {
          console.error("Error loading the mainView:", error);
          reject(error);
        });        
        akView.when(() => {
            console.log("Alaska Map and View are ready");
            // Watch for changes to the scale property
            akView.watch("scale", (newScale) => {
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
        overView.when(() => {
            console.log("Overview Map and View are ready");
            // Watch for changes to the scale property
            overView.watch("scale", (newScale) => {
              console.log("overView scale changed:", newScale);
              // Update the overViewScaleValue span
              const overViewScaleValueSpan = document.getElementById("overViewScaleValue");
              if (overViewScaleValueSpan) {
                overViewScaleValueSpan.textContent = Math.round(newScale).toLocaleString();
              }
            });
            // Initialize the scale value on page load
            const overViewScaleValueSpan = document.getElementById("overViewScaleValue");
            if (overViewScaleValueSpan) {
              overViewScaleValueSpan.textContent = Math.round(overView.scale).toLocaleString();
            }  
            }).catch((error) => {
            console.error("Error loading the Overview map view:", error);
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
        mainView.popup.viewModel.includeDefaultActions = false;
        akView.popup.viewModel.includeDefaultActions = false;
        overView.popup.viewModel.includeDefaultActions = false;
        guView.popup.viewModel.includeDefaultActions = false;
        asView.popup.viewModel.includeDefaultActions = false;
        hiView.popup.viewModel.includeDefaultActions = false;
        
        // Sync Alaska scale
        akView.when(() => {
          syncScale(akView, hiView);
          syncScale(akView, asView);
          syncScale(akView, guView);
          syncScale(akView, mainView);
        });

        // Add an extent box to the overview map from the GU/MP map
        overView.when(() => {
          guView.when(() => {
            guExtentSetup();
            syncScale(guView, akView);
            syncScale(guView, asView);
            syncScale(guView, hiView);
            syncScale(guView, mainView);
          });
        });
        const guExtentDebouncer = promiseUtils.debounce(async () => {
          if (guView.stationary) {
            await overView.goTo({
              center: guView.center,
              scale:
                guView.scale * 2 *
                Math.max(
                  guView.width / overView.width,
                  guView.height / overView.height
                )
            });
          }
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

          reactiveUtils.watch(
            () => guView.extent,
            (extent) => {
              // Sync the overview map location
              // whenever the guView is stationary
              guExtentDebouncer().then(() => {
                guExtentGraphic.geometry = extent;
              });
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
              syncScale(asView, akView);
              syncScale(asView, guView);
              syncScale(asView, hiView);
              syncScale(asView, mainView);
            });
          });
          const asExtentDebouncer = promiseUtils.debounce(async () => {
            if (asView.stationary) {
              await overView.goTo({
                center: asView.center,
                scale:
                  asView.scale * 2 *
                  Math.max(
                    asView.width / overView.width,
                    asView.height / overView.height
                  )
              });
            }
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
  
            reactiveUtils.watch(
              () => asView.extent,
              (extent) => {
                // Sync the overview map location
                // whenever the guView is stationary
                asExtentDebouncer().then(() => {
                  asExtentGraphic.geometry = extent;
                });
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
              syncScale(hiView, akView);
              syncScale(hiView, asView);
              syncScale(hiView, guView);
              syncScale(hiView, mainView);
            });
          });
          const hiExtentDebouncer = promiseUtils.debounce(async () => {
            if (hiView.stationary) {
              await overView.goTo({
                center: hiView.center,
                scale:
                  hiView.scale * 2 *
                  Math.max(
                    hiView.width / overView.width,
                    hiView.height / overView.height
                  )
              });
            }
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
  
            reactiveUtils.watch(
              () => hiView.extent,
              (extent) => {
                // Sync the overview map location
                // whenever the guView is stationary
                hiExtentDebouncer().then(() => {
                  hiExtentGraphic.geometry = extent;
                });
              },
              {
                initial: true
              }
            );
          }
          // Sync scales across insets
          function syncScale(view, targetView) {
            view.watch("scale", function(newScale) {
              console.log("Inset changed: " + newScale);
              targetView.set({ scale: newScale });
            });
          }
          // Sync scale between mainView and other views
          mainView.watch("scale", (newScale) => {
            console.log("Main changed:", newScale);
            localStorage.setItem("mainViewScale", newScale); // Store the scale in localStorage
            const storedScale = localStorage.getItem("mainViewScale");
            console.log("Stored scale:", storedScale);
            if (storedScale) {
              const scale = parseFloat(storedScale);
              console.log("Updating scale:", scale);
  
              akView.set({ scale });
              console.log("AK scale: ", akView.scale)
              guView.set({ scale });
              asView.set({ scale });
              hiView.set({ scale });
            }
          });
    });
  });
});