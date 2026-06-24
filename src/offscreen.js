// offscreen.js — runs in the offscreen document (has window context)
// Creates blob URLs for transcript downloads so chrome.downloads respects the filename.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'yth-blob') return;
  const blob = new Blob([msg.content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  sendResponse({ url });
  // Revoke after download has time to start
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
});
