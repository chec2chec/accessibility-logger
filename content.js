/**
 * Content script for Accessibility Logger
 * Monitors accessibility events on web pages and sends them to background script
 * Includes enhanced arrow key navigation with text content logging
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
        console.log('Accessibility Logger: Monitor initialized/reinitialized');
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
            console.log('Found', this.textLines.length, 'text lines for navigation');
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
         * Get current line text
         */
        getCurrentLineText() {
            if (this.currentLineIndex >= 0 && this.currentLineIndex < this.textLines.length) {
                return this.textLines[this.currentLineIndex].text;
            }
            return null;
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
         * Refresh text content (call after page changes)
         */
        refresh() {
            this.initializeTextContent();
            this.currentLineIndex = 0;
        }
    }

    /**
     * Accessibility Event Monitor
     * Enhanced with text content logging for arrow key navigation
     */
    class AccessibilityMonitor {
        constructor() {
            this.isDevToolsReady = false;
            this.eventQueue = [];
            this.observers = [];
            this.eventListeners = [];
            this.connectionCheckInterval = null;
            this.textReader = new TextReader();
            
            this.init();
        }

        init() {
            this.setupConnectionCheck();
            this.setupRuntimeMessageListener();
            this.setupFocusMonitoring();
            this.setupAriaMonitoring();
            this.setupKeyboardMonitoring();
            this.setupNavigationListener();
            console.log('Accessibility Logger: Content script monitoring started');
        }

        /**
         * Check connection to background script periodically
         */
        setupConnectionCheck() {
            this.connectionCheckInterval = setInterval(() => {
                chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log('Connection to background script lost, may need reinitialization');
                    }
                });
            }, 30000); // Check every 30 seconds
        }

        /**
         * Listen for messages from background script
         */
        setupRuntimeMessageListener() {
            const messageListener = (request, sender, sendResponse) => {
                console.log('Content script received message:', request);
                
                if (request.action === 'devtools-ready') {
                    console.log('DevTools panel is ready, enabling event monitoring');
                    this.isDevToolsReady = true;
                    this.processEventQueue();
                    sendResponse({ success: true });
                }
                
                if (request.action === 'devtools-closed') {
                    console.log('DevTools panel closed, disabling event monitoring');
                    this.isDevToolsReady = false;
                    sendResponse({ success: true });
                }
                
                if (request.action === 'reinitialize') {
                    console.log('Reinitializing accessibility monitor due to navigation');
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
                    console.log('Page became visible, checking monitor status');
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
                    console.log('DOM changed, refreshing text reader');
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
                console.log('No observers found, reinitializing monitor');
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
            console.log('Processing event queue, length:', this.eventQueue.length);
            while (this.eventQueue.length > 0) {
                const event = this.eventQueue.shift();
                this.sendAccessibilityEvent(event);
            }
        }

        /**
         * Monitor focus changes
         */
        setupFocusMonitoring() {
            const focusListener = (e) => {
                const element = e.target;
                
                // Update text reader position based on focused element
                this.textReader.findLineFromElement(element);
                
                const eventData = {
                    type: 'focus',
                    timestamp: Date.now(),
                    id: Date.now() + Math.random(),
                    element: this.getElementInfo(element),
                    details: {
                        focusable: element.tabIndex >= 0,
                        visible: this.isElementVisible(element),
                        hasAriaLabel: !!element.getAttribute('aria-label'),
                        hasAriaLabelledby: !!element.getAttribute('aria-labelledby'),
                        role: element.getAttribute('role')
                    }
                };
                
                console.log('Focus event detected:', eventData);
                this.queueOrSendEvent(eventData);
            };

            const blurListener = (e) => {
                const element = e.target;
                const eventData = {
                    type: 'blur',
                    timestamp: Date.now(),
                    id: Date.now() + Math.random(),
                    element: this.getElementInfo(element),
                    details: {
                        relatedTarget: e.relatedTarget ? this.getElementInfo(e.relatedTarget) : null
                    }
                };
                
                console.log('Blur event detected:', eventData);
                this.queueOrSendEvent(eventData);
            };

            document.addEventListener('focus', focusListener, true);
            document.addEventListener('blur', blurListener, true);
            
            this.eventListeners.push({ 
                target: document, 
                event: 'focus', 
                listener: focusListener, 
                options: true 
            });
            this.eventListeners.push({ 
                target: document, 
                event: 'blur', 
                listener: blurListener, 
                options: true 
            });

            console.log('Focus monitoring setup complete');
        }

        /**
         * Monitor ARIA attribute changes
         */
        setupAriaMonitoring() {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes') {
                        const attributeName = mutation.attributeName;
                        
                        if (attributeName?.startsWith('aria-') || attributeName === 'role') {
                            const element = mutation.target;
                            const eventData = {
                                type: 'aria-change',
                                timestamp: Date.now(),
                                id: Date.now() + Math.random(),
                                element: this.getElementInfo(element),
                                details: {
                                    attribute: attributeName,
                                    oldValue: mutation.oldValue,
                                    newValue: element.getAttribute(attributeName),
                                    elementVisible: this.isElementVisible(element)
                                }
                            };
                            
                            console.log('ARIA change detected:', eventData);
                            this.queueOrSendEvent(eventData);
                        }
                    } else if (mutation.type === 'childList') {
                        // Monitor for live region updates
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const liveRegion = this.findLiveRegion(node);
                                if (liveRegion) {
                                    const eventData = {
                                        type: 'live-region-update',
                                        timestamp: Date.now(),
                                        id: Date.now() + Math.random(),
                                        element: this.getElementInfo(liveRegion),
                                        details: {
                                            addedContent: node.textContent?.substring(0, 200),
                                            ariaLive: liveRegion.getAttribute('aria-live'),
                                            ariaAtomic: liveRegion.getAttribute('aria-atomic')
                                        }
                                    };
                                    
                                    console.log('Live region update detected:', eventData);
                                    this.queueOrSendEvent(eventData);
                                }
                            }
                        });
                    }
                });
            });

            observer.observe(document, {
                attributes: true,
                attributeOldValue: true,
                childList: true,
                subtree: true,
                attributeFilter: [
                    'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
                    'aria-expanded', 'aria-hidden', 'aria-live', 'aria-atomic',
                    'aria-busy', 'aria-checked', 'aria-disabled', 'aria-selected',
                    'aria-pressed', 'aria-current', 'aria-invalid'
                ]
            });

            this.observers.push(observer);
            console.log('ARIA monitoring setup complete');
        }

        /**
         * Monitor keyboard interactions with enhanced arrow key text logging
         */
        setupKeyboardMonitoring() {
            const keydownListener = (e) => {
                // Only log meaningful keyboard interactions
                if (this.isSignificantKeyEvent(e)) {
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
                        }
                    } else if (e.key === 'ArrowDown') {
                        const nextText = this.textReader.getNextLineText();
                        if (nextText) {
                            textContent = `Next line: "${nextText}"`;
                            navigationDirection = 'next';
                        } else {
                            textContent = 'End of content reached';
                        }
                    } else if (e.key === 'ArrowLeft') {
                        const charText = this.textReader.getCharacterNavigation('previous');
                        if (charText) {
                            textContent = `Character navigation: "${charText}"`;
                            navigationDirection = 'previous';
                        }
                    } else if (e.key === 'ArrowRight') {
                        const charText = this.textReader.getCharacterNavigation('next');
                        if (charText) {
                            textContent = `Character navigation: "${charText}"`;
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
                            code: e.code,
                            altKey: e.altKey,
                            ctrlKey: e.ctrlKey,
                            shiftKey: e.shiftKey,
                            metaKey: e.metaKey,
                            isNavigation: this.isNavigationKey(e.key),
                            isScreenReaderKey: this.isScreenReaderKey(e),
                            textContent: textContent,
                            navigationDirection: navigationDirection,
                            currentLineIndex: this.textReader.currentLineIndex,
                            totalLines: this.textReader.textLines.length
                        }
                    };
                    
                    console.log('Keyboard event detected:', eventData);
                    this.queueOrSendEvent(eventData);
                }
            };

            document.addEventListener('keydown', keydownListener, true);
            this.eventListeners.push({ 
                target: document, 
                event: 'keydown', 
                listener: keydownListener, 
                options: true 
            });

            console.log('Keyboard monitoring setup complete');
        }

        /**
         * Queue event if DevTools not ready, otherwise send immediately
         */
        queueOrSendEvent(eventData) {
            if (this.isDevToolsReady) {
                console.log('DevTools ready, sending event immediately:', eventData.type);
                this.sendAccessibilityEvent(eventData);
            } else {
                console.log('DevTools not ready, queuing event:', eventData.type);
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
         * Find live region ancestor
         */
        findLiveRegion(element) {
            let current = element;
            while (current && current !== document) {
                if (current.getAttribute?.('aria-live')) {
                    return current;
                }
                current = current.parentElement;
            }
            return null;
        }

        /**
         * Check if key event is significant for accessibility
         */
        isSignificantKeyEvent(e) {
            // Navigation keys
            if (this.isNavigationKey(e.key)) return true;
            
            // Screen reader specific keys
            if (this.isScreenReaderKey(e)) return true;
            
            // Action keys on interactive elements
            if ((e.key === 'Enter' || e.key === ' ') && this.isInteractiveElement(e.target)) {
                return true;
            }
            
            // Escape key
            if (e.key === 'Escape') return true;
            
            return false;
        }

        /**
         * Check if key is a navigation key
         */
        isNavigationKey(key) {
            return ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 
                    'Home', 'End', 'PageUp', 'PageDown'].includes(key);
        }

        /**
         * Check if key combination is screen reader specific
         */
        isScreenReaderKey(e) {
            // Common NVDA key combinations
            if (e.ctrlKey && e.altKey) return true;
            if (e.key === 'Insert') return true;
            if (e.ctrlKey && ['h', 'l', 'k', 'f', 'g', 't', 'b'].includes(e.key)) return true;
            
            return false;
        }

        /**
         * Check if element is interactive
         */
        isInteractiveElement(element) {
            const interactiveTags = ['button', 'a', 'input', 'select', 'textarea'];
            const interactiveRoles = ['button', 'link', 'textbox', 'listbox', 'option', 'tab'];
            
            return interactiveTags.includes(element.tagName?.toLowerCase()) ||
                   interactiveRoles.includes(element.getAttribute('role')) ||
                   element.tabIndex >= 0;
        }

        /**
         * Send accessibility event to background script
         */
        sendAccessibilityEvent(eventData) {
            try {
                if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
                    console.log('Sending accessibility event to background script:', eventData);
                    chrome.runtime.sendMessage({
                        action: 'accessibility-event',
                        data: eventData
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('Failed to send accessibility event:', chrome.runtime.lastError);
                        } else {
                            console.log('Event sent successfully:', response);
                        }
                    });
                } else {
                    console.warn('Chrome runtime API not available, queuing event');
                    this.eventQueue.push(eventData);
                }
            } catch (error) {
                console.error('Error sending accessibility event:', error);
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

            console.log('Accessibility Logger: Monitor cleaned up');
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