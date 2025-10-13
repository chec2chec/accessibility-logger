/**
 * Content script for Accessibility Logger
 * Monitors only Tab-triggered focus changes and arrow key navigation
 */

// Prevent multiple injections and handle reinitialization
(function() {
    'use strict';
    
    let accessibilityMonitor = null;
    
    /**
     * Initialize or reinitialize the accessibility monitor
     */
    function initializeMonitor() {
        // Clean up existing monitor if it exists
        if (accessibilityMonitor) {
            accessibilityMonitor.cleanup();
        }
        
        // Create new monitor instance
        accessibilityMonitor = new AccessibilityMonitor();
    }

    /**
     * Text Navigation Helper
     * Handles text content extraction for arrow key navigation
     */
    class TextReader {
        constructor() {
            this.currentElement = null;
            this.currentLineIndex = 0;
            this.textLines = [];
            this.initializeTextContent();
        }

        /**
         * Initialize text content from the page
         */
        initializeTextContent() {
            this.textLines = this.extractTextLines();
        }

        /**
         * Extract text lines from the page content
         */
        extractTextLines() {
            const lines = [];
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: (node) => {
                        // Only include visible text nodes with meaningful content
                        const parent = node.parentElement;
                        if (!parent) return NodeFilter.FILTER_REJECT;
                        
                        const style = window.getComputedStyle(parent);
                        const text = node.textContent.trim();
                        
                        if (text.length === 0) return NodeFilter.FILTER_REJECT;
                        if (style.display === 'none') return NodeFilter.FILTER_REJECT;
                        if (style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
                        if (['script', 'style', 'noscript'].includes(parent.tagName?.toLowerCase())) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            let node;
            while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                const parent = node.parentElement;
                
                // Split by natural line breaks and sentences for better navigation
                const textSegments = this.splitIntoLines(text, parent);
                textSegments.forEach(segment => {
                    if (segment.trim().length > 0) {
                        lines.push({
                            text: segment.trim(),
                            element: parent,
                            node: node
                        });
                    }
                });
            }

            return lines;
        }

        /**
         * Split text into logical lines based on content and element type
         */
        splitIntoLines(text, element) {
            const tagName = element.tagName?.toLowerCase();
            
            // For headings, paragraphs, and list items - treat as single lines
            if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th', 'button', 'a'].includes(tagName)) {
                return [text];
            }
            
            // For longer text blocks, split by sentences or line breaks
            if (text.length > 100) {
                // Split by periods, exclamation marks, question marks followed by space or end
                const sentences = text.split(/([.!?]+\s+|[.!?]+$)/).filter(s => s.trim().length > 0);
                const result = [];
                for (let i = 0; i < sentences.length; i += 2) {
                    const sentence = sentences[i] + (sentences[i + 1] || '');
                    if (sentence.trim().length > 0) {
                        result.push(sentence.trim());
                    }
                }
                return result.length > 0 ? result : [text];
            }
            
            // For shorter text, treat as single line
            return [text];
        }

        /**
         * Get next line text
         */
        getNextLineText() {
            const nextIndex = this.currentLineIndex + 1;
            if (nextIndex < this.textLines.length) {
                this.currentLineIndex = nextIndex;
                return this.textLines[nextIndex].text;
            }
            return null;
        }

        /**
         * Get previous line text
         */
        getPreviousLineText() {
            const prevIndex = this.currentLineIndex - 1;
            if (prevIndex >= 0) {
                this.currentLineIndex = prevIndex;
                return this.textLines[prevIndex].text;
            }
            return null;
        }

        /**
         * Get character-level navigation text
         */
        getCharacterNavigation(direction) {
            const currentLine = this.getCurrentLineText();
            if (!currentLine) return null;
            
            // For character navigation, return a portion of the current line
            const maxLength = 50;
            if (currentLine.length <= maxLength) {
                return currentLine;
            }
            
            // Return beginning or end portion based on direction
            if (direction === 'next') {
                return currentLine.substring(0, maxLength) + '...';
            } else {
                return '...' + currentLine.substring(currentLine.length - maxLength);
            }
        }

        /**
         * Get current line text
         */
        getCurrentLineText() {
            if (this.currentLineIndex >= 0 && this.currentLineIndex < this.textLines.length) {
                return this.textLines[this.currentLineIndex].text;
            }
            return null;
        }

        /**
         * Find line index based on currently focused element
         */
        findLineFromElement(element) {
            if (!element) return -1;
            
            // Find the closest text line that belongs to this element or its children
            for (let i = 0; i < this.textLines.length; i++) {
                const line = this.textLines[i];
                if (element.contains(line.element) || line.element.contains(element) || line.element === element) {
                    this.currentLineIndex = i;
                    return i;
                }
            }
            
            return -1;
        }

        /**
         * Refresh text content (call after page changes)
         */
        refresh() {
            this.initializeTextContent();
            this.currentLineIndex = 0;
        }
    }

    /**
     * Accessibility Event Monitor
     * Simplified to only track Tab-triggered focus changes and arrow key navigation
     */
    class AccessibilityMonitor {
        constructor() {
            this.isDevToolsReady = false;
            this.eventQueue = [];
            this.observers = [];
            this.eventListeners = [];
            this.connectionCheckInterval = null;
            this.textReader = new TextReader();
            this.lastKeyPressed = null; // Track the last key pressed
            
            this.init();
        }

        init() {
            this.setupConnectionCheck();
            this.setupRuntimeMessageListener();
            this.setupFocusMonitoring();
            this.setupKeyboardMonitoring();
            this.setupNavigationListener();
        }

        /**
         * Check connection to background script periodically
         */
        setupConnectionCheck() {
            this.connectionCheckInterval = setInterval(() => {
                chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
                    if (chrome.runtime.lastError) {
                        // Connection lost, may need reinitialization
                    }
                });
            }, 30000); // Check every 30 seconds
        }

        /**
         * Listen for messages from background script
         */
        setupRuntimeMessageListener() {
            const messageListener = (request, sender, sendResponse) => {
                if (request.action === 'devtools-ready') {
                    this.isDevToolsReady = true;
                    this.processEventQueue();
                    sendResponse({ success: true });
                }
                
                if (request.action === 'devtools-closed') {
                    this.isDevToolsReady = false;
                    sendResponse({ success: true });
                }
                
                if (request.action === 'reinitialize') {
                    this.reinitialize();
                    sendResponse({ success: true });
                }
            };
            
            chrome.runtime.onMessage.addListener(messageListener);
            this.eventListeners.push({ 
                target: chrome.runtime.onMessage, 
                listener: messageListener 
            });
        }

        /**
         * Listen for navigation and reinitialization messages
         */
        setupNavigationListener() {
            // Listen for page visibility changes
            const visibilityChangeListener = () => {
                if (document.visibilityState === 'visible') {
                    this.checkAndReinitialize();
                }
            };
            
            document.addEventListener('visibilitychange', visibilityChangeListener);
            this.eventListeners.push({ 
                target: document, 
                event: 'visibilitychange', 
                listener: visibilityChangeListener 
            });

            // Listen for DOM changes to refresh text reader
            const mutationObserver = new MutationObserver((mutations) => {
                let shouldRefresh = false;
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList' && 
                        (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                        shouldRefresh = true;
                    }
                });
                
                if (shouldRefresh) {
                    this.textReader.refresh();
                }
            });
            
            mutationObserver.observe(document, {
                childList: true,
                subtree: true
            });
            
            this.observers.push(mutationObserver);
        }

        /**
         * Check if monitor needs reinitialization and do it if necessary
         */
        checkAndReinitialize() {
            // Simple check - if we have no observers, we probably need to reinitialize
            if (this.observers.length === 0) {
                this.reinitialize();
            }
        }

        /**
         * Reinitialize the monitor (for navigation events)
         */
        reinitialize() {
            this.cleanup();
            this.isDevToolsReady = false;
            this.eventQueue = [];
            this.observers = [];
            this.eventListeners = [];
            
            // Small delay to ensure page is ready
            setTimeout(() => {
                this.init();
            }, 100);
        }

        /**
         * Process queued events when DevTools becomes ready
         */
        processEventQueue() {
            while (this.eventQueue.length > 0) {
                const event = this.eventQueue.shift();
                this.sendAccessibilityEvent(event);
            }
        }

        /**
         * Monitor focus changes - only log if caused by Tab key
         */
        setupFocusMonitoring() {
            const focusListener = (e) => {
                // Only log focus changes if the last key pressed was Tab
                if (this.lastKeyPressed !== 'Tab') {
                    return;
                }

                const element = e.target;
                
                // Update text reader position based on focused element
                this.textReader.findLineFromElement(element);
                
                const eventData = {
                    type: 'focus',
                    timestamp: Date.now(),
                    id: Date.now() + Math.random(),
                    element: this.getElementInfo(element),
                    details: {
                        triggeredByTab: true,
                        focusable: element.tabIndex >= 0,
                        visible: this.isElementVisible(element),
                        hasAriaLabel: !!element.getAttribute('aria-label'),
                        hasAriaLabelledby: !!element.getAttribute('aria-labelledby'),
                        role: element.getAttribute('role')
                    }
                };
                
                this.queueOrSendEvent(eventData);
                
                // Reset the last key pressed after processing
                this.lastKeyPressed = null;
            };

            document.addEventListener('focus', focusListener, true);
            
            this.eventListeners.push({ 
                target: document, 
                event: 'focus', 
                listener: focusListener, 
                options: true 
            });
        }

        /**
         * Monitor keyboard interactions - only track Tab and Arrow keys
         */
        setupKeyboardMonitoring() {
            const keydownListener = (e) => {
                // Track Tab key for focus monitoring
                if (e.key === 'Tab') {
                    this.lastKeyPressed = 'Tab';
                    // Don't log Tab key itself, only the resulting focus change
                    return;
                }

                // Only log arrow key presses
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    let textContent = null;
                    let navigationDirection = null;

                    // Enhanced arrow key handling with text content
                    if (e.key === 'ArrowUp') {
                        const previousText = this.textReader.getPreviousLineText();
                        if (previousText) {
                            textContent = `Previous line: "${previousText}"`;
                            navigationDirection = 'previous';
                        } else {
                            textContent = 'Beginning of content reached';
                            navigationDirection = 'previous';
                        }
                    } else if (e.key === 'ArrowDown') {
                        const nextText = this.textReader.getNextLineText();
                        if (nextText) {
                            textContent = `Next line: "${nextText}"`;
                            navigationDirection = 'next';
                        } else {
                            textContent = 'End of content reached';
                            navigationDirection = 'next';
                        }
                    } else if (e.key === 'ArrowLeft') {
                        const charText = this.textReader.getCharacterNavigation('previous');
                        if (charText) {
                            textContent = `Character navigation: "${charText}"`;
                            navigationDirection = 'previous';
                        } else {
                            textContent = 'Beginning of line reached';
                            navigationDirection = 'previous';
                        }
                    } else if (e.key === 'ArrowRight') {
                        const charText = this.textReader.getCharacterNavigation('next');
                        if (charText) {
                            textContent = `Character navigation: "${charText}"`;
                            navigationDirection = 'next';
                        } else {
                            textContent = 'End of line reached';
                            navigationDirection = 'next';
                        }
                    }

                    const eventData = {
                        type: 'keyboard',
                        timestamp: Date.now(),
                        id: Date.now() + Math.random(),
                        element: this.getElementInfo(e.target),
                        details: {
                            key: e.key,
                            isArrowKey: true,
                            textContent: textContent,
                            navigationDirection: navigationDirection,
                            currentLineIndex: this.textReader.currentLineIndex,
                            totalLines: this.textReader.textLines.length
                        }
                    };
                    
                    this.queueOrSendEvent(eventData);
                }

                // Clear last key pressed for non-Tab keys to prevent false focus logging
                if (e.key !== 'Tab') {
                    this.lastKeyPressed = null;
                }
            };

            document.addEventListener('keydown', keydownListener, true);
            this.eventListeners.push({ 
                target: document, 
                event: 'keydown', 
                listener: keydownListener, 
                options: true 
            });
        }

        /**
         * Queue event if DevTools not ready, otherwise send immediately
         */
        queueOrSendEvent(eventData) {
            if (this.isDevToolsReady) {
                this.sendAccessibilityEvent(eventData);
            } else {
                this.eventQueue.push(eventData);
                
                // Prevent queue from growing too large
                if (this.eventQueue.length > 100) {
                    this.eventQueue.shift();
                }
            }
        }

        /**
         * Get comprehensive element information
         */
        getElementInfo(element) {
            if (!element) return null;

            return {
                tagName: element.tagName?.toLowerCase(),
                id: element.id,
                className: element.className,
                role: element.getAttribute('role'),
                ariaLabel: element.getAttribute('aria-label'),
                ariaLabelledby: element.getAttribute('aria-labelledby'),
                ariaDescribedby: element.getAttribute('aria-describedby'),
                textContent: element.textContent?.substring(0, 100),
                value: element.value,
                href: element.href,
                src: element.src,
                alt: element.alt,
                title: element.title,
                tabIndex: element.tabIndex,
                disabled: element.disabled,
                readonly: element.readOnly,
                required: element.required
            };
        }

        /**
         * Check if element is visible
         */
        isElementVisible(element) {
            if (!element) return false;
            
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0' &&
                   element.offsetParent !== null;
        }

        /**
         * Send accessibility event to background script
         */
        sendAccessibilityEvent(eventData) {
            try {
                if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({
                        action: 'accessibility-event',
                        data: eventData
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            // Failed to send accessibility event
                        }
                    });
                } else {
                    this.eventQueue.push(eventData);
                }
            } catch (error) {
                // Error sending accessibility event
            }
        }

        /**
         * Clean up all event listeners and observers
         */
        cleanup() {
            // Clear connection check interval
            if (this.connectionCheckInterval) {
                clearInterval(this.connectionCheckInterval);
                this.connectionCheckInterval = null;
            }

            // Disconnect all mutation observers
            this.observers.forEach(observer => observer.disconnect());
            this.observers = [];

            // Remove all event listeners
            this.eventListeners.forEach(({ target, event, listener, options }) => {
                if (target.removeEventListener) {
                    target.removeEventListener(event, listener, options);
                } else if (target.removeListener) {
                    target.removeListener(listener);
                }
            });
            this.eventListeners = [];
        }
    }

    // Initialize monitor when script loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeMonitor);
    } else {
        initializeMonitor();
    }

    // Handle page unload
    window.addEventListener('beforeunload', () => {
        if (accessibilityMonitor) {
            accessibilityMonitor.cleanup();
        }
    });

})();