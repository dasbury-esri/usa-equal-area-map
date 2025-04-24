document.addEventListener("DOMContentLoaded", () => {
    // Check if mainView is defined and accessible
    if (typeof window.mainView === "undefined") {
        console.error("mainView is not defined. Ensure map2.js is loaded and mainView is attached to the window object.");
    } else {
        console.log("mainView is available:", window.mainView);
    }
    // Check if akView is defined and accessible
    if (typeof window.akView === "undefined") {
        console.error("akView is not defined. Ensure map2.js is loaded and akView is attached to the window object.");
    } else {
        console.log("akView is available:", window.akView);
    }    
    const toggleButton = document.getElementById("drawer-toggle");
    const drawerContainer = document.getElementById("drawer-container");
    const esriBottomLeft = document.querySelector(".esri-ui-bottom-left");

    if (!toggleButton || !drawerContainer) {
        console.error("Toggle button or drawer container not found.");
        return;
    }

    // Function to update the position of .esri-ui-bottom-left
    const updateEsriBottomLeftPosition = () => {
        if (esriBottomLeft) {
            const drawerWidth = drawerContainer.offsetWidth; // Get the current width of the drawer
            if (drawerContainer.classList.contains("drawer-open")) {
                esriBottomLeft.style.transform = `translateX(${drawerWidth}px)`; // Move based on drawer width
            } else {
                esriBottomLeft.style.transform = "translateX(0)"; // Reset to original position
            }
        }
    };

    // Wait for mainView to be ready
    if (window.mainViewReady) {
        window.mainViewReady.then((mainView) => {
        console.log("mainView is available:", mainView);
                toggleButton.addEventListener("click", () => {
                    console.log("Toggle button clicked"); // Debugging log
                    // Toggle the "drawer-open" and "drawer-closed" classes
                    if (drawerContainer.classList.contains("drawer-closed")) {
                        drawerContainer.classList.remove("drawer-closed");
                        drawerContainer.classList.add("drawer-open");
                        // Update the center point of the mainView map
                        if (typeof mainView !== "undefined" && mainView.scale === 24000000) {
                            mainView.goTo({
                                center: [-115, 36], // Example center point (longitude, latitude)
                            }).then(() => {
                                console.log("mainView center updated to [-115, 36]");
                            }).catch((error) => {
                                console.error("Error updating mainView center:", error);
                            });
                        }
                    // Update the position of .esri-ui-bottom-left
                    updateEsriBottomLeftPosition();
                    } else {
                        drawerContainer.classList.remove("drawer-open");
                        drawerContainer.classList.add("drawer-closed");
                        // Optionally reset the center point of the mainView map
                        if (typeof mainView !== "undefined") {
                            mainView.goTo({
                                center: [-97, 38], // Reset to original center point
                            }).then(() => {
                                console.log("mainView center reset to [-97, 38]");
                            }).catch((error) => {
                                console.error("Error resetting mainView center:", error);
                            });
                        }
                    }
                    console.log("Current classes on drawer-container:", drawerContainer.className); // Log current classes
                });
                // Initial position update
                updateEsriBottomLeftPosition();    
        }).catch((error) => {
            console.error("Error waiting for mainView:", error);
        });  
    } else {
        console.error("mainViewReady Promise is not defined. Ensure map2.js is loaded.");
        }
});
