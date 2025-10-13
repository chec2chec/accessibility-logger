/**
 * Background service worker for Accessibility Logger
 * Handles message passing between content scripts and DevTools panel
 */

// Store DevTools connection state per tab
const devToolsConnections = new Map();

/**
 * Check if URL is valid for content script injection
 */
function isValidUrl(url) {
    if (!url) return false;
    
    // Exclude chrome:// urls and other restricted protocols
    const restrictedProtocols = [
        'chrome://',
        'chrome-extension://',
        'chrome-devtools://',
        'edge://',
        'about:',
        'moz-extension://',
        'safari-extension://'
    ];
    
    return !restrictedProtocols.some(protocol => url.startsWith(protocol));
}

// Handle messages from content scripts and DevTools
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'accessibility-event') {
        // Forward accessibility events to DevTools panel
        
        // Check if chrome.storage is available
        if (chrome.storage && chrome.storage.local) {
            // Store the event data for the DevTools panel to retrieve
            chrome.storage.local.get(['accessibilityEvents'], (result) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }
                
                const events = result.accessibilityEvents || [];
                
                // Add unique ID if not present
                if (!message.data.id) {
                    message.data.id = Date.now() + Math.random();
                }
                
                events.push(message.data); // Add to end
                
                // Keep only last 1000 events to prevent memory issues
                if (events.length > 1000) {
                    events.splice(0, events.length - 1000);
                }
                
                chrome.storage.local.set({ accessibilityEvents: events }, () => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true });
                    }
                });
            });
        } else {
            sendResponse({ success: false, error: 'Storage API not available' });
        }
        
        // Return true to indicate we will respond asynchronously
        return true;
    }
    
    // Handle ping from content script to verify connection
    if (message.action === 'ping') {
        sendResponse({ success: true });
        return true;
    }

    // Handle DevTools panel ready signal
    if (message.action === 'devtools-ready') {
        const tabId = message.tabId;
        devToolsConnections.set(tabId, true);
        
        // Notify content script that DevTools is ready
        chrome.tabs.sendMessage(tabId, {
            action: 'devtools-ready'
        }).catch(() => {
            // Ignore connection errors
        });
        
        sendResponse({ success: true });
        return true;
    }

    // Handle DevTools panel closed signal
    if (message.action === 'devtools-closed') {
        const tabId = message.tabId;
        devToolsConnections.delete(tabId);
        
        // Optionally notify content script
        chrome.tabs.sendMessage(tabId, {
            action: 'devtools-closed'
        }).catch(() => {
            // Ignore connection errors
        });
        
        sendResponse({ success: true });
        return true;
    }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
    // Clear any previous event data
    if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.clear(() => {
            // Installation complete
        });
    }
});

// Handle tab updates to reinitialize monitoring
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && isValidUrl(tab.url)) {
        // Clear events for new page
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ accessibilityEvents: [] });
        }
        
        // Clear DevTools connection state for this tab
        devToolsConnections.delete(tabId);
        
        // Re-inject content script if needed (only for valid URLs)
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }).catch(() => {
            // Content script might already be injected, or page might not allow injection
        });
    } else if (changeInfo.status === 'complete' && tab.url && !isValidUrl(tab.url)) {
        // Clear events for restricted pages
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ accessibilityEvents: [] });
        }
        
        // Clear DevTools connection state
        devToolsConnections.delete(tabId);
    }
});

// Handle navigation within single-page applications
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    chrome.tabs.get(details.tabId, (tab) => {
        if (chrome.runtime.lastError) {
            return;
        }
        
        if (!isValidUrl(tab.url)) {
            return;
        }
        
        // Clear events for new page state
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ accessibilityEvents: [] });
        }
        
        // Send message to content script to reinitialize if needed
        chrome.tabs.sendMessage(details.tabId, {
            action: 'reinitialize'
        }).catch(() => {
            // Try re-injecting content script (only for valid URLs)
            chrome.scripting.executeScript({
                target: { tabId: details.tabId },
                files: ['content.js']
            }).catch(() => {
                // Failed to re-inject content script
            });
        });
    });
});

// Clean up connections when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
    devToolsConnections.delete(tabId);
});