// Cookie-Monster - Background Service Worker
// Minimal MV3 service worker; logic lives in popup.js

chrome.runtime.onInstalled.addListener(() => {
  console.log('Cookie-Monster installed');
});
