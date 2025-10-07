/**
 * Background service worker for Accessibility Logger
 * Handles message passing between content scripts and DevTools panel
 */

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'accessibility-event') {
        // Forward accessibility events to DevTools panel
        console.log('Accessibility event received:', message.data);
        
        // Check if chrome.storage is available
        if (chrome.storage && chrome.storage.local) {
            // Store the event data for the DevTools panel to retrieve
            chrome.storage.local.get(['accessibilityEvents'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('Storage get error:', chrome.runtime.lastError);
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
                        console.error('Storage set error:', chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true });
                    }
                });
            });
        } else {
            console.error('Chrome storage API not available');
            sendResponse({ success: false, error: 'Storage API not available' });
        }
        
        // Return true to indicate we will respond asynchronously
        return true;
    }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Accessibility Logger installed:', details.reason);
    
    // Clear any previous event data
    if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.clear(() => {
            if (chrome.runtime.lastError) {
                console.error('Failed to clear storage:', chrome.runtime.lastError);
            } else {
                console.log('Storage cleared successfully');
            }
        });
    }
});

// Handle tab updates to reset monitoring
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        console.log('Tab updated, accessibility monitoring may need reinitialization');
        
        // Clear events when navigating to new page
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ accessibilityEvents: [] });
        }
    }
});