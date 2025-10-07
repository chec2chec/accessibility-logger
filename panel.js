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
     * This now just enables monitoring in the content script
     */
    connectToContentScript() {
        // Send a message to the content script to start monitoring
        chrome.devtools.inspectedWindow.eval(`
            // Signal to content script that DevTools panel is ready
            (function() {
                window.postMessage({
                    type: 'DEVTOOLS_PANEL_READY',
                    source: 'accessibility-logger'
                }, '*');
                console.log('Accessibility Logger: DevTools panel ready signal sent');
            })();
        `, (result, isException) => {
            if (isException) {
                console.error('Failed to signal content script:', isException);
                this.updateConnectionStatus(false);
            } else {
                console.log('DevTools panel ready signal sent successfully');
                this.updateConnectionStatus(true);
            }
        });
    }

    /**
     * Start polling for events from chrome.storage
     */
    startPollingForEvents() {
        this.pollingInterval = setInterval(() => {
            this.fetchEventsFromStorage();
        }, 1000); // Poll every second
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
            const newEvents = events.filter(event => 
                !this.logEntries.some(existing => existing.id === event.id)
            );

            newEvents.forEach(event => {
                this.addLogEntry(event);
            });

            // Clear processed events from storage to prevent re-processing
            if (newEvents.length > 0) {
                chrome.storage.local.set({ accessibilityEvents: [] });
            }
        });
    }

    /**
     * Add accessibility event to log
     */
    addLogEntry(eventData) {
        if (!this.isLoggingEnabled) return;

        const entry = {
            id: eventData.id || (Date.now() + Math.random()),
            ...eventData,
            expanded: false
        };

        // Check if entry already exists
        if (this.logEntries.some(existing => existing.id === entry.id)) {
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
        entryElement.className = 'log-entry';
        entryElement.tabIndex = 0;
        entryElement.setAttribute('data-entry-id', entry.id);
        entryElement.setAttribute('role', 'option');
        
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const elementInfo = `${entry.element?.tagName || 'unknown'}${entry.element?.id ? '#' + entry.element.id : ''}`;
        
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
            'mutation': 'DOM Change'
        };
        return typeMap[type] || type;
    }

    /**
     * Format event details for display
     */
    formatDetails(entry) {
        if (!entry.element && !entry.details) return 'No details';
        
        switch (entry.type) {
            case 'focus':
                return entry.element?.ariaLabel || entry.element?.textContent || 'Focusable element';
            case 'blur':
                return 'Element lost focus';
            case 'aria-change':
                return `${entry.details?.attribute}: ${entry.details?.newValue}`;
            case 'keyboard':
                return `Key: ${entry.details?.key}`;
            case 'live-region-update':
                return `Added: ${entry.details?.addedContent}`;
            default:
                return entry.details ? JSON.stringify(entry.details).substring(0, 50) + '...' : 'Event details';
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
        this.announce("Accessibility Logger panel opened");
        // Refresh connection to content script
        this.connectToContentScript();
        
        // Start polling if not already started
        if (!this.pollingInterval) {
            this.startPollingForEvents();
        }
    }

    /**
     * Close current dialog (Escape key handler)
     */
    closeCurrentDialog() {
        // Close any expanded details
        const expandedEntries = document.querySelectorAll('.log-entry.expanded');
        expandedEntries.forEach(entry => {
            const entryId = entry.getAttribute('data-entry-id');
            const logEntry = this.logEntries.find(e => e.id == entryId);
            if (logEntry) {
                logEntry.expanded = false;
                entry.classList.remove('expanded');
                const details = entry.querySelector('.entry-expanded-details');
                if (details) details.remove();
            }
        });

        if (expandedEntries.length > 0) {
            this.announce("Closed expanded details");
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
    }
}

// Initialize the Accessibility Logger when the panel loads
document.addEventListener('DOMContentLoaded', () => {
    window.accessibilityLogger = new AccessibilityLogger();
});

// Cleanup when page is unloaded
window.addEventListener('beforeunload', () => {
    if (window.accessibilityLogger) {
        window.accessibilityLogger.destroy();
    }
});