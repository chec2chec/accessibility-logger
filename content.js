/**
 * Content script for Accessibility Logger
 * Monitors accessibility events on web pages and sends them to background script
 */

// Prevent multiple injections
if (window.accessibilityLoggerContentScript) {
    console.log('Accessibility Logger content script already loaded');
} else {
    window.accessibilityLoggerContentScript = true;

    /**
     * Accessibility Event Monitor
     * Tracks focus changes, ARIA updates, and keyboard interactions
     */
    class AccessibilityMonitor {
        constructor() {
            this.isDevToolsReady = false;
            this.eventQueue = [];
            this.init();
        }

        init() {
            this.setupDevToolsListener();
            this.setupFocusMonitoring();
            this.setupAriaMonitoring();
            this.setupKeyboardMonitoring();
            console.log('Accessibility Logger: Content script monitoring started');
        }

        /**
         * Listen for DevTools panel ready signal
         */
        setupDevToolsListener() {
            window.addEventListener('message', (event) => {
                if (event.data.type === 'DEVTOOLS_PANEL_READY' && 
                    event.data.source === 'accessibility-logger') {
                    console.log('DevTools panel ready signal received');
                    this.isDevToolsReady = true;
                    
                    // Process any queued events
                    this.processEventQueue();
                }
            });
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
         * Monitor focus changes
         */
        setupFocusMonitoring() {
            document.addEventListener('focus', (e) => {
                const element = e.target;
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
                
                this.queueOrSendEvent(eventData);
            }, true);

            document.addEventListener('blur', (e) => {
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
                
                this.queueOrSendEvent(eventData);
            }, true);
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
        }

        /**
         * Monitor keyboard interactions
         */
        setupKeyboardMonitoring() {
            document.addEventListener('keydown', (e) => {
                // Only log meaningful keyboard interactions
                if (this.isSignificantKeyEvent(e)) {
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
                            isScreenReaderKey: this.isScreenReaderKey(e)
                        }
                    };
                    
                    this.queueOrSendEvent(eventData);
                }
            }, true);
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
                    chrome.runtime.sendMessage({
                        action: 'accessibility-event',
                        data: eventData
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('Failed to send accessibility event:', chrome.runtime.lastError);
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
    }

    // Initialize the monitor
    const monitor = new AccessibilityMonitor();

    // Handle messages from popup or background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "buttonClicked") {
            alert("Hello from your Chrome extension!");
            sendResponse({ success: true });
        }
    });
}