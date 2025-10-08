/**
 * Accessibility Logger Panel - Main functionality and NVDA-like navigation
 * Provides real-time logging of accessibility events with screen reader simulation
 */

class AccessibilityLogger {
    constructor() {
        this.logEntries = [];
        this.currentFocusIndex = -1;
        this.isLoggingEnabled = true;
        this.announcementQueue = [];
        this.pollingInterval = null;
        this.connectionEstablished = false;
        this.currentTabId = null;
        
        this.init();
    }

    /**
     * Initialize the accessibility logger panel
     */
    init() {
        this.bindElements();
        this.setupEventListeners();
        this.setupKeyboardNavigation();
        this.connectToContentScript();
        this.startPollingForEvents();
        this.setupNavigationMonitoring();
        this.updateStatus();
    }

    /**
     * Bind DOM elements for easy access
     */
    bindElements() {
        this.logEntriesContainer = document.getElementById('logEntries');
        this.clearLogButton = document.getElementById('clearLog');
        this.exportLogButton = document.getElementById('exportLog');
        this.enableLoggingCheckbox = document.getElementById('enableLogging');
        this.navigationInfo = document.getElementById('navigationInfo');
        this.logCount = document.getElementById('logCount');
        this.connectionStatus = document.getElementById('connectionStatus');
    }

    /**
     * Setup event listeners for UI controls
     */
    setupEventListeners() {
        this.clearLogButton.addEventListener('click', () => this.clearLog());
        this.exportLogButton.addEventListener('click', () => this.exportLog());
        this.enableLoggingCheckbox.addEventListener('change', (e) => {
            this.isLoggingEnabled = e.target.checked;
            this.updateStatus();
        });

        // Handle panel lifecycle events
        window.addEventListener('message', (event) => {
            if (event.data.type === 'PANEL_SHOWN') {
                this.onPanelShown();
            }
        });
    }

    /**
     * Monitor navigation changes to maintain connection
     */
    setupNavigationMonitoring() {
        // Check for navigation changes periodically
        let lastUrl = '';
        const navigationCheckInterval = setInterval(() => {
            chrome.devtools.inspectedWindow.eval(`window.location.href`, (result, isException) => {
                if (!isException && result !== lastUrl) {
                    if (lastUrl !== '') {
                        console.log('Navigation detected from', lastUrl, 'to', result);
                        this.handleNavigation(result);
                    }
                    lastUrl = result;
                }
            });
        }, 1000); // Check every second

        // Store interval for cleanup
        this.navigationCheckInterval = navigationCheckInterval;
    }

    /**
     * Handle navigation to maintain logging
     */
    handleNavigation(newUrl) {
        console.log('Handling navigation to:', newUrl);
        
        // Don't clear existing logs on navigation - keep them for comparison
        // But do add a navigation marker
        this.addNavigationMarker(newUrl);
        
        // Re-establish connection after a short delay to allow page to load
        setTimeout(() => {
            this.reconnectAfterNavigation();
        }, 1000);
    }

    /**
     * Add a navigation marker to the log
     */
    addNavigationMarker(url) {
        const navigationEvent = {
            id: Date.now() + Math.random(),
            type: 'navigation',
            timestamp: Date.now(),
            element: null,
            details: {
                url: url,
                marker: true
            }
        };
        
        this.addLogEntry(navigationEvent);
    }

    /**
     * Reconnect to content script after navigation
     */
    reconnectAfterNavigation() {
        console.log('Reconnecting after navigation...');
        this.connectionEstablished = false;
        this.connectToContentScript();
    }

    /**
     * Setup NVDA-like keyboard navigation
     */
    setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            switch(e.key) {
                case 'Tab':
                    if (!e.shiftKey && this.logEntriesContainer.contains(document.activeElement)) {
                        this.navigateToNext();
                        e.preventDefault();
                    } else if (e.shiftKey && this.logEntriesContainer.contains(document.activeElement)) {
                        this.navigateToPrevious();
                        e.preventDefault();
                    }
                    break;
                
                case 'ArrowUp':
                    if (this.logEntriesContainer.contains(document.activeElement)) {
                        this.navigateByLine(-1);
                        e.preventDefault();
                    }
                    break;
                
                case 'ArrowDown':
                    if (this.logEntriesContainer.contains(document.activeElement)) {
                        this.navigateByLine(1);
                        e.preventDefault();
                    }
                    break;
                
                case 'Enter':
                    if (this.logEntriesContainer.contains(document.activeElement)) {
                        this.toggleEntryExpansion();
                        e.preventDefault();
                    }
                    break;
                
                case 'Escape':
                    this.closeCurrentDialog();
                    break;
                
                case 'Home':
                    if (this.logEntriesContainer.contains(document.activeElement)) {
                        this.navigateToFirst();
                        e.preventDefault();
                    }
                    break;
                
                case 'End':
                    if (this.logEntriesContainer.contains(document.activeElement)) {
                        this.navigateToLast();
                        e.preventDefault();
                    }
                    break;
            }
        });

        // Handle focus events for announcements
        this.logEntriesContainer.addEventListener('focus', () => {
            this.announceNavigationState();
        });
    }

    /**
     * Connect to content script for accessibility event monitoring
     */
    connectToContentScript() {
        console.log('Establishing DevTools connection...');
        this.currentTabId = chrome.devtools.inspectedWindow.tabId;
        
        // Immediately send the devtools-ready signal
        this.sendDevToolsReadySignal();
        
        // Also try after a short delay to ensure everything is loaded
        setTimeout(() => {
            if (!this.connectionEstablished) {
                this.sendDevToolsReadySignal();
            }
        }, 500);
        
        // And periodically retry if connection isn't established
        const connectionRetryInterval = setInterval(() => {
            if (!this.connectionEstablished) {
                console.log('Retrying DevTools connection...');
                this.sendDevToolsReadySignal();
            } else {
                clearInterval(connectionRetryInterval);
            }
        }, 3000); // Retry every 3 seconds
        
        // Store interval for cleanup
        this.connectionRetryInterval = connectionRetryInterval;
        
        // Stop retrying after 30 seconds
        setTimeout(() => {
            if (this.connectionRetryInterval) {
                clearInterval(this.connectionRetryInterval);
                this.connectionRetryInterval = null;
            }
        }, 30000);
    }

    /**
     * Send DevTools ready signal to background script
     */
    sendDevToolsReadySignal() {
        const tabId = chrome.devtools.inspectedWindow.tabId;
        console.log('Sending DevTools ready signal for tab:', tabId);
        
        chrome.runtime.sendMessage({
            action: 'devtools-ready',
            tabId: tabId
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Failed to notify background script:', chrome.runtime.lastError);
                this.updateConnectionStatus(false);
            } else {
                console.log('Successfully notified background script that DevTools is ready:', response);
                this.connectionEstablished = true;
                this.updateConnectionStatus(true);
                
                // Process any queued events in storage immediately
                this.fetchEventsFromStorage();
            }
        });
    }

    /**
     * Start polling for events from chrome.storage
     */
    startPollingForEvents() {
        console.log('Starting to poll for events...');
        this.pollingInterval = setInterval(() => {
            this.fetchEventsFromStorage();
        }, 300); // Poll every 300ms for very responsive logging
    }

    /**
     * Fetch events from chrome.storage
     */
    fetchEventsFromStorage() {
        chrome.storage.local.get(['accessibilityEvents'], (result) => {
            if (chrome.runtime.lastError) {
                console.error('Failed to fetch events from storage:', chrome.runtime.lastError);
                return;
            }

            const events = result.accessibilityEvents || [];
            
            if (events.length > 0) {
                const newEvents = events.filter(event => 
                    !this.logEntries.some(existing => existing.id === event.id)
                );

                if (newEvents.length > 0) {
                    console.log('Processing new events:', newEvents.length);
                    
                    newEvents.forEach(event => {
                        this.addLogEntry(event);
                    });

                    // Mark events as processed
                    this.markEventsAsProcessed(newEvents);
                }
            }
        });
    }

    /**
     * Mark events as processed to avoid re-processing
     */
    markEventsAsProcessed(processedEvents) {
        chrome.storage.local.get(['accessibilityEvents'], (result) => {
            if (chrome.runtime.lastError) return;
            
            const allEvents = result.accessibilityEvents || [];
            const processedIds = new Set(processedEvents.map(e => e.id));
            
            // Remove processed events from storage
            const remainingEvents = allEvents.filter(event => !processedIds.has(event.id));
            
            chrome.storage.local.set({ accessibilityEvents: remainingEvents });
        });
    }

    /**
     * Add accessibility event to log
     */
    addLogEntry(eventData) {
        if (!this.isLoggingEnabled) return;

        console.log('Adding log entry:', eventData.type, eventData);

        const entry = {
            id: eventData.id || (Date.now() + Math.random()),
            ...eventData,
            expanded: false
        };

        // Check if entry already exists
        if (this.logEntries.some(existing => existing.id === entry.id)) {
            console.log('Event already exists, skipping:', entry.id);
            return;
        }

        this.logEntries.unshift(entry); // Add to beginning for latest-first order
        this.renderLogEntry(entry);
        this.updateLogCount();
        
        // Auto-scroll to new entry
        if (this.logEntriesContainer.children.length > 0) {
            this.logEntriesContainer.children[0].scrollIntoView({ behavior: 'smooth' });
        }
    }

    /**
     * Render a single log entry
     */
    renderLogEntry(entry) {
        const entryElement = document.createElement('div');
        entryElement.className = 'log-entry new-entry';
        entryElement.tabIndex = 0;
        entryElement.setAttribute('data-entry-id', entry.id);
        entryElement.setAttribute('role', 'option');
        
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const elementInfo = this.getElementDisplayInfo(entry.element);
        
        // Special styling for navigation markers
        if (entry.type === 'navigation') {
            entryElement.classList.add('navigation-marker');
        }
        
        entryElement.innerHTML = `
            <div class="entry-time">${time}</div>
            <div class="entry-event ${entry.type}">${this.formatEventType(entry.type)}</div>
            <div class="entry-element">${elementInfo}</div>
            <div class="entry-details">${this.formatDetails(entry)}</div>
        `;

        // Add click handler for expansion
        entryElement.addEventListener('click', () => {
            this.focusLogEntry(entryElement);
            this.toggleEntryExpansion();
        });

        // Insert at the beginning
        this.logEntriesContainer.insertBefore(entryElement, this.logEntriesContainer.firstChild);

        // Remove new-entry class after animation
        setTimeout(() => {
            entryElement.classList.remove('new-entry');
        }, 1000);
    }

    /**
     * Get display info for element
     */
    getElementDisplayInfo(element) {
        if (!element) return 'unknown';
        
        let info = element.tagName || 'unknown';
        
        if (element.id) {
            info += `#${element.id}`;
        } else if (element.className) {
            const firstClass = element.className.split(' ')[0];
            if (firstClass) {
                info += `.${firstClass}`;
            }
        }
        
        return info;
    }

    /**
     * Format event type for display
     */
    formatEventType(type) {
        const typeMap = {
            'focus': 'Focus Change',
            'blur': 'Blur',
            'aria-change': 'ARIA Update',
            'keyboard': 'Key Press',
            'live-region-update': 'Live Region',
            'mutation': 'DOM Change',
            'navigation': '🧭 Navigation'
        };
        return typeMap[type] || type;
    }

    /**
     * Format event details for display
     */
    formatDetails(entry) {
        if (!entry.element && !entry.details) return 'No details';
        
        switch (entry.type) {
            case 'navigation':
                return `Navigated to: ${entry.details?.url || 'unknown URL'}`;
            case 'focus':
                return entry.element?.ariaLabel || 
                       entry.element?.textContent?.substring(0, 50) || 
                       entry.element?.value?.substring(0, 50) ||
                       'Focusable element';
            case 'blur':
                return 'Element lost focus';
            case 'aria-change':
                return `${entry.details?.attribute}: ${entry.details?.newValue || 'null'}`;
            case 'keyboard':
                const key = entry.details?.key || 'Unknown';
                const modifiers = [];
                if (entry.details?.ctrlKey) modifiers.push('Ctrl');
                if (entry.details?.altKey) modifiers.push('Alt');
                if (entry.details?.shiftKey) modifiers.push('Shift');
                if (entry.details?.metaKey) modifiers.push('Meta');
                
                const keyCombo = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key;
                
                // Show text content for arrow keys
                if (entry.details?.textContent) {
                    return entry.details.textContent;
                }
                
                // Show line position for arrow keys
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key) && 
                    entry.details?.currentLineIndex !== undefined) {
                    const direction = entry.details.navigationDirection || 'unknown';
                    const lineInfo = `Line ${entry.details.currentLineIndex + 1}/${entry.details.totalLines}`;
                    return `${keyCombo} - ${direction} (${lineInfo})`;
                }
                
                return keyCombo;
            case 'live-region-update':
                return `Added: ${entry.details?.addedContent?.substring(0, 50) || 'content'}`;
            default:
                if (entry.details && typeof entry.details === 'object') {
                    const detailStr = JSON.stringify(entry.details);
                    return detailStr.length > 50 ? detailStr.substring(0, 50) + '...' : detailStr;
                }
                return 'Event details';
        }
    }

    /**
     * NVDA-like navigation methods
     */
    navigateToNext() {
        const entries = this.logEntriesContainer.children;
        if (entries.length === 0) return;

        this.currentFocusIndex = Math.min(this.currentFocusIndex + 1, entries.length - 1);
        this.focusLogEntry(entries[this.currentFocusIndex]);
    }

    navigateToPrevious() {
        const entries = this.logEntriesContainer.children;
        if (entries.length === 0) return;

        this.currentFocusIndex = Math.max(this.currentFocusIndex - 1, 0);
        this.focusLogEntry(entries[this.currentFocusIndex]);
    }

    navigateByLine(direction) {
        const entries = this.logEntriesContainer.children;
        if (entries.length === 0) return;

        const newIndex = this.currentFocusIndex + direction;
        if (newIndex >= 0 && newIndex < entries.length) {
            this.currentFocusIndex = newIndex;
            this.focusLogEntry(entries[this.currentFocusIndex]);
        }
    }

    navigateToFirst() {
        const entries = this.logEntriesContainer.children;
        if (entries.length === 0) return;

        this.currentFocusIndex = 0;
        this.focusLogEntry(entries[0]);
    }

    navigateToLast() {
        const entries = this.logEntriesContainer.children;
        if (entries.length === 0) return;

        this.currentFocusIndex = entries.length - 1;
        this.focusLogEntry(entries[this.currentFocusIndex]);
    }

    /**
     * Focus a specific log entry
     */
    focusLogEntry(entryElement) {
        // Remove previous focus styling
        document.querySelectorAll('.log-entry.focused').forEach(el => {
            el.classList.remove('focused');
        });

        // Add focus styling and focus
        entryElement.classList.add('focused');
        entryElement.focus();
        entryElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

        // Update current index
        const entries = Array.from(this.logEntriesContainer.children);
        this.currentFocusIndex = entries.indexOf(entryElement);

        this.announceEntryContent(entryElement);
    }

    /**
     * Toggle expansion of current log entry
     */
    toggleEntryExpansion() {
        const entries = this.logEntriesContainer.children;
        if (this.currentFocusIndex < 0 || this.currentFocusIndex >= entries.length) return;

        const currentEntry = entries[this.currentFocusIndex];
        const entryId = currentEntry.getAttribute('data-entry-id');
        const logEntry = this.logEntries.find(entry => entry.id == entryId);

        if (!logEntry) return;

        logEntry.expanded = !logEntry.expanded;
        currentEntry.classList.toggle('expanded');

        let expandedDetails = currentEntry.querySelector('.entry-expanded-details');
        
        if (logEntry.expanded && !expandedDetails) {
            expandedDetails = document.createElement('div');
            expandedDetails.className = 'entry-expanded-details';
            expandedDetails.textContent = JSON.stringify(logEntry, null, 2);
            currentEntry.appendChild(expandedDetails);
            this.announce(`Expanded details for ${this.formatEventType(logEntry.type)} event`);
        } else if (!logEntry.expanded && expandedDetails) {
            expandedDetails.remove();
            this.announce(`Collapsed details for ${this.formatEventType(logEntry.type)} event`);
        }
    }

    /**
     * Announce entry content for screen reader simulation
     */
    announceEntryContent(entryElement) {
        const time = entryElement.querySelector('.entry-time').textContent;
        const eventType = entryElement.querySelector('.entry-event').textContent;
        const element = entryElement.querySelector('.entry-element').textContent;
        const details = entryElement.querySelector('.entry-details').textContent;

        const announcement = `${eventType} at ${time}, Element: ${element}, ${details}`;
        this.announce(announcement);
    }

    /**
     * Announce navigation state
     */
    announceNavigationState() {
        const totalEntries = this.logEntriesContainer.children.length;
        if (totalEntries === 0) {
            this.announce("No accessibility events logged");
            return;
        }

        const currentPosition = this.currentFocusIndex + 1;
        this.announce(`Accessibility log, ${currentPosition} of ${totalEntries} entries`);
    }

    /**
     * Announce text to screen reader simulation
     */
    announce(text) {
        this.announcementQueue.push(text);
        this.processAnnouncementQueue();
    }

    /**
     * Process announcement queue
     */
    processAnnouncementQueue() {
        if (this.announcementQueue.length === 0) return;

        const announcement = this.announcementQueue.shift();
        this.navigationInfo.textContent = announcement;

        // Clear announcement after delay
        setTimeout(() => {
            if (this.navigationInfo.textContent === announcement) {
                this.navigationInfo.textContent = "Press Tab to navigate, Arrow keys for line navigation, Escape to close dialogs";
            }
        }, 3000);

        // Process next announcement
        if (this.announcementQueue.length > 0) {
            setTimeout(() => this.processAnnouncementQueue(), 1000);
        }
    }

    /**
     * Clear all log entries
     */
    clearLog() {
        this.logEntries = [];
        this.logEntriesContainer.innerHTML = '';
        this.currentFocusIndex = -1;
        this.updateLogCount();
        
        // Also clear storage
        chrome.storage.local.set({ accessibilityEvents: [] });
        
        this.announce("Accessibility log cleared");
    }

    /**
     * Export log to JSON
     */
    exportLog() {
        const dataStr = JSON.stringify(this.logEntries, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `accessibility-log-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
        this.announce("Accessibility log exported");
    }

    /**
     * Update log count display
     */
    updateLogCount() {
        const count = this.logEntries.length;
        this.logCount.textContent = `${count} event${count !== 1 ? 's' : ''} logged`;
    }

    /**
     * Update connection status
     */
    updateConnectionStatus(connected) {
        this.connectionStatus.textContent = connected ? 'Connected to page' : 'Disconnected';
        this.connectionStatus.className = connected ? 'connected' : 'disconnected';
    }

    /**
     * Update overall status
     */
    updateStatus() {
        if (!this.isLoggingEnabled) {
            this.announce("Accessibility logging disabled");
        }
    }

    /**
     * Handle panel shown event
     */
    onPanelShown() {
        console.log('Panel shown, establishing connection...');
        this.announce("Accessibility Logger panel opened");
        
        // Re-establish connection
        this.connectionEstablished = false;
        this.connectToContentScript();
        
        // Start polling if not already started
        if (!this.pollingInterval) {
            this.startPollingForEvents();
        }
    }

    /**
     * Cleanup when panel is destroyed
     */
    destroy() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }

        if (this.navigationCheckInterval) {
            clearInterval(this.navigationCheckInterval);
            this.navigationCheckInterval = null;
        }

        if (this.connectionRetryInterval) {
            clearInterval(this.connectionRetryInterval);
            this.connectionRetryInterval = null;
        }

        // Notify background script that DevTools is closing
        chrome.runtime.sendMessage({
            action: 'devtools-closed',
            tabId: chrome.devtools.inspectedWindow.tabId
        }).catch(() => {
            // Ignore errors when extension is being unloaded
        });
    }
}

// Initialize the Accessibility Logger when the panel loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('Panel DOM loaded, initializing Accessibility Logger...');
    window.accessibilityLogger = new AccessibilityLogger();
});

// Cleanup when page is unloaded
window.addEventListener('beforeunload', () => {
    if (window.accessibilityLogger) {
        window.accessibilityLogger.destroy();
    }
});