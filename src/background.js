// background.js — YouTube Transcript Helper (MV3 service worker)
// Receives a TranscriptPayload, builds the file text, downloads it via
// chrome.downloads, fires a notification, and appends a SaveLogEntry to
// chrome.storage.local. Also handles toolbar-icon and keyboard triggers.

const DOWNLOAD_ROOT = "youtube-transcripts";
const SAVE_LOG_KEY = "saveLog";
const SAVE_LOG_MAX = 500;

// --- Sanitization --------------------------------------------------------

function sanitize(name) {
  return (name || "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// --- File text ------------------------------------------------------------

function buildFileText(payload, savedAtIso) {
  const header = [
    `Title:   ${payload.video_title}`,
    `Channel: ${payload.channel_name}`,
    `URL:     ${payload.video_url}`,
    `Saved:   ${savedAtIso}`,
    `Lines:   ${payload.lines.length}`,
    "=".repeat(60),
    "",
  ].join("\n");

  const body = payload.lines.map((l) => `[${l.timestamp}] ${l.text}`).join("\n");
  return header + body + "\n";
}

// --- Notifications --------------------------------------------------------

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

// --- Save log -------------------------------------------------------------

async function appendSaveLog(entry) {
  const stored = await chrome.storage.local.get(SAVE_LOG_KEY);
  const log = Array.isArray(stored[SAVE_LOG_KEY]) ? stored[SAVE_LOG_KEY] : [];
  log.push(entry);
  // Keep newest SAVE_LOG_MAX, drop oldest
  const trimmed = log.slice(-SAVE_LOG_MAX);
  await chrome.storage.local.set({ [SAVE_LOG_KEY]: trimmed });
}

// --- Core save ------------------------------------------------------------

async function saveTranscript(payload) {
  const savedAtIso = new Date().toISOString();
  const safeChannel = sanitize(payload.channel_name) || "Unknown_Channel";
  const safeTitle = sanitize(payload.video_title) || "untitled";
  const filename = `${DOWNLOAD_ROOT}/${safeChannel}/${payload.video_id}_${safeTitle}.txt`;

  const text = buildFileText(payload, savedAtIso);
  // Service workers have no URL.createObjectURL; use a data URL.
  const dataUrl = "data:text/plain;charset=utf-8," + encodeURIComponent(text);

  chrome.downloads.download(
    {
      url: dataUrl,
      filename,
      conflictAction: "overwrite",
      saveAs: false,
    },
    (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        notify("Save failed", chrome.runtime.lastError?.message || "Unknown download error");
        return;
      }
      notify("Transcript saved", `${safeChannel}/${payload.video_id}_${safeTitle}.txt`);
    }
  );

  await appendSaveLog({
    video_id: payload.video_id,
    video_title: payload.video_title,
    channel_name: payload.channel_name,
    safe_channel: safeChannel,
    safe_title: safeTitle,
    video_url: payload.video_url,
    saved_at: savedAtIso,
    filename,
    line_count: payload.lines.length,
  });
}

// --- Trigger from toolbar icon / keyboard shortcut ------------------------

async function triggerActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:\/\/www\.youtube\.com\/watch/.test(tab.url || "")) {
    notify("Not a YouTube video", "Navigate to a YouTube video first.");
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "requestScrape" }, (result) => {
    if (chrome.runtime.lastError || !result) {
      notify("Open the transcript panel", "Open the YouTube transcript panel first, then try again.");
      return;
    }
    if (result.ok) {
      saveTranscript(result.payload);
    } else {
      notify("Open the transcript panel", "Open the YouTube transcript panel first, then try again.");
    }
  });
}

chrome.action.onClicked.addListener(triggerActiveTab);

chrome.commands.onCommand.addListener((command) => {
  if (command === "save-transcript") triggerActiveTab();
});

// --- Context menu: open the saved-transcript history page -----------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-history",
    title: "View saved transcripts",
    contexts: ["action"],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "open-history") {
    chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
  }
});

// --- Messages from content script (injected button) ----------------------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "save" && msg.payload) {
    saveTranscript(msg.payload);
  } else if (msg.type === "scrape-failed") {
    notify("Open the transcript panel", "Open the YouTube transcript panel first, then try again.");
  }
});
