// Session Replay Content Script
// Records user interactions and DOM changes for later replay

(function() {
    // Storage for events
    let events = [];
    let startTime = Date.now();
    
    // Helper to get element selector
    function getElementSelector(element) {
        if (!element || !(element instanceof Element)) return '';
        
        // Try ID first
        if (element.id) {
            return '#' + element.id;
        }
        
        // Try class name
        if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\s+/);
            if (classes.length) {
                return element.tagName.toLowerCase() + '.' + classes.join('.');
            }
        }
        
        // Fallback to tag + nth-child
        const selector = [];
        let elem = element;
        while (elem && elem.nodeType === Node.ELEMENT_NODE) {
            let idx = 1;
            let sib = elem.previousSibling;
            while (sib) {
                if (sib.nodeType === Node.ELEMENT_NODE && sib.tagName === elem.tagName) {
                    idx++;
                }
                sib = sib.previousSibling;
            }
            const name = elem.tagName.toLowerCase();
            selector.unshift(name + (idx > 1 ? `:nth-of-type(${idx})` : ''));
            elem = elem.parentNode;
        }
        return selector.length ? selector.join(' > ') : '';
    }
    
    // Record various events
    function recordEvent(type, data) {
        events.push({
            type: type,
            timestamp: Date.now() - startTime,
            data: data
        });
    }
    
    // Mouse events
    ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave'].forEach(eventType => {
        document.addEventListener(eventType, function(e) {
            recordEvent(eventType, {
                x: e.clientX,
                y: e.clientY,
                target: getElementSelector(e.target),
                button: e.button
            });
        }, true);
    });
    
    // Keyboard events
    ['keydown', 'keyup', 'keypress'].forEach(eventType => {
        document.addEventListener(eventType, function(e) {
            recordEvent(eventType, {
                key: e.key,
                code: e.code,
                keyCode: e.keyCode,
                target: getElementSelector(e.target)
            });
        }, true);
    });
    
    // Form events
    ['submit', 'change', 'input', 'focus', 'blur'].forEach(eventType => {
        document.addEventListener(eventType, function(e) {
            let value = '';
            if (e.target && e.target.value !== undefined) {
                value = e.target.value;
            }
            recordEvent(eventType, {
                target: getElementSelector(e.target),
                value: value.substring(0, 100) // Limit length
            });
        }, true);
    });
    
    // Scroll events
    window.addEventListener('scroll', function() {
        recordEvent('scroll', {
            x: window.scrollX,
            y: window.scrollY
        });
    }, true);
    
    // Page visibility
    document.addEventListener('visibilitychange', function() {
        recordEvent('visibilitychange', {
            hidden: document.hidden
        });
    });
    
    // Record initial page state
    recordEvent('pageload', {
        url: window.location.href,
        title: document.title,
        referrer: document.referrer
    });
    
    // Send events to background script periodically
    setInterval(function() {
        if (events.length > 0) {
            chrome.runtime.sendMessage({
                type: 'session-replay-events',
                events: events.splice(0) // Get and clear events
            });
        }
    }, 2000); // Send every 2 seconds
    
    // Send remaining events on page unload
    window.addEventListener('beforeunload', function() {
        if (events.length > 0) {
            chrome.runtime.sendMessage({
                type: 'session-replay-events',
                events: events
            });
        }
    });
})();