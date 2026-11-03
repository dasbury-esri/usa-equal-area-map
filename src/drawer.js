import Point from "@arcgis/core/geometry/Point.js";
import viewDefaults from "./view-defaults.js";

const toggleButton = document.getElementById("drawer-toggle");
const drawerContainer = document.getElementById("drawer-container");
const drawerFrame = document.getElementById("drawer-iframe");

if (toggleButton && drawerContainer && drawerFrame) {
  const updatePosition = () => {
    const controls = document.querySelector("#mainViewDiv .esri-ui-bottom-left");
    const isOpen = drawerContainer.classList.contains("drawer-open");
    if (controls) {
      controls.style.transform = isOpen
        ? `translateX(${drawerContainer.offsetWidth}px)`
        : "translateX(0)";
    }
  };
  const updateMap = async () => {
    await window.mainViewReady;
    const view = await window.updateMapViews({ reframe: true });
    if (!view) return;
    updatePosition();
    if (window.framingPreviewReady) {
      return;
    }
    const isOpen = drawerContainer.classList.contains("drawer-open");
    if (!isOpen || Math.abs(view.scale - viewDefaults.main.scale) < 1) {
      await view.goTo({
        center: new Point(isOpen
          ? viewDefaults.main.drawerOpenCenter
          : viewDefaults.main.center),
        scale: view.scale,
      }, { animate: false });
    }
  };
  toggleButton.setAttribute("aria-controls", "drawer-iframe");
  toggleButton.setAttribute("aria-expanded", "false");
  toggleButton.setAttribute("aria-label", "Show inset maps");
  drawerFrame.inert = true;
  toggleButton.addEventListener("click", () => {
    const isOpen = drawerContainer.classList.toggle("drawer-open");
    drawerContainer.classList.toggle("drawer-closed", !isOpen);
    toggleButton.setAttribute("aria-expanded", String(isOpen));
    toggleButton.setAttribute("aria-label", isOpen ? "Hide inset maps" : "Show inset maps");
    drawerFrame.inert = !isOpen;
    updatePosition();
    updateMap().catch((error) => {
      if (error.name !== "AbortError") console.error("Could not recenter the map:", error);
    });
  });
  new ResizeObserver(updatePosition).observe(drawerContainer);
  window.addEventListener("map-views-ready", updatePosition);
}

const prDrawer = document.getElementById("pr-drawer");
const prToggle = document.getElementById("pr-drawer-toggle");
const prContainer = document.getElementById("prViewDiv");

if (prDrawer && prToggle && prContainer) {
  const setOpen = (isOpen) => {
    if (!isOpen && prContainer.contains(document.activeElement)) prToggle.focus();
    prDrawer.classList.toggle("drawer-open", isOpen);
    prContainer.inert = !isOpen;
    prToggle.setAttribute("aria-expanded", String(isOpen));
    const label = `${isOpen ? "Hide" : "Show"} Puerto Rico and US Virgin Islands`;
    prToggle.setAttribute("aria-label", label);
    prToggle.title = label;
    Promise.resolve(window.mainViewReady).then(() => window.updateMapViews())
      .catch(error => console.error("Could not update Puerto Rico view", error));
  };
  prToggle.addEventListener("click", () => {
    setOpen(!prDrawer.classList.contains("drawer-open"));
  });
  prDrawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && prDrawer.classList.contains("drawer-open")) {
      setOpen(false);
      prToggle.focus();
    }
  });
}
