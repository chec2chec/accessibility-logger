/**
 * DevTools initialization script
 * Creates the Accessibility Logger panel in Chrome DevTools
 */

chrome.devtools.panels.create(
    "Accessibility Logger",
    "icon16.png", // Icon for the panel tab
    "panel.html", // Panel content
    (panel) => {
        console.log("Accessibility Logger panel created");
        
        // Handle panel lifecycle events
        panel.onShown.addListener((window) => {
            console.log("Accessibility Logger panel shown");
            // Send message to panel when it's shown
            window.postMessage({ type: 'PANEL_SHOWN' }, '*');
        });

        panel.onHidden.addListener(() => {
            console.log("Accessibility Logger panel hidden");
        });
    }
);