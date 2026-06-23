// background.js — YouTube Transcript Helper (MV3 service worker)
// Receives a TranscriptPayload, builds the file text, downloads it via
// chrome.downloads, fires a notification, and appends a SaveLogEntry to
// chrome.storage.local. Also handles toolbar-icon and keyboard triggers.

const DOWNLOAD_ROOT = "youtube-transcripts";
const SAVE_LOG_KEY = "saveLog";
const SAVE_LOG_MAX = 500;
const VERSION = chrome.runtime.getManifest().version;

console.log(`[YTH] service worker loaded — v${VERSION}`);

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
  console.log("[YTH] downloading:", filename, `(${payload.lines.length} lines)`);

  chrome.downloads.download(
    {
      url: dataUrl,
      filename,
      conflictAction: "overwrite",
      saveAs: false,
    },
    (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        console.error("[YTH] download failed:", chrome.runtime.lastError);
        notify("Save failed", chrome.runtime.lastError?.message || "Unknown download error");
        return;
      }
      console.log("[YTH] download started, id =", downloadId);
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

// --- Page-injected scraper (runs in the YouTube tab via chrome.scripting) -
// Self-contained: no external references, since it executes in the page.

function pageScrapeTranscript() {
  const SELECTORS = {
    panel: ["ytd-transcript-renderer", '[target-id="engagement-panel-searchable-transcript"]'],
    segment: ["ytd-transcript-segment-renderer", 'div[class*="segment"]'],
    timestamp: [".segment-timestamp", '[class*="timestamp"]'],
    text: [".segment-text", '[class*="cue"]'],
    channel: ["ytd-channel-name yt-formatted-string", "#channel-name a"],
    title: ["ytd-watch-metadata h1 yt-formatted-string", "#title h1"],
  };
  const first = (sels, root = document) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const all = (sels, root = document) => {
    for (const s of sels) {
      const els = root.querySelectorAll(s);
      if (els.length) return Array.from(els);
    }
    return [];
  };
  const normTs = (raw) => {
    const p = (raw || "").trim().split(":").map((x) => Number(x.trim()) || 0);
    let h = 0, m = 0, s = 0;
    if (p.length === 3) [h, m, s] = p;
    else if (p.length === 2) [m, s] = p;
    else s = p[0] || 0;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  const panel = first(SELECTORS.panel);
  if (!panel) return { ok: false, reason: "no-panel" };
  const segs = all(SELECTORS.segment, panel);
  if (!segs.length) return { ok: false, reason: "no-segments" };

  const lines = [];
  for (const seg of segs) {
    const txt = (first(SELECTORS.text, seg)?.textContent || "").trim().replace(/\s+/g, " ");
    if (!txt) continue;
    const tsEl = first(SELECTORS.timestamp, seg);
    lines.push({ timestamp: tsEl ? normTs(tsEl.textContent) : "00:00:00", text: txt });
  }
  if (!lines.length) return { ok: false, reason: "no-lines" };

  return {
    ok: true,
    payload: {
      video_id: new URLSearchParams(location.search).get("v") || "",
      video_title: (first(SELECTORS.title)?.textContent || document.title.replace(/ - YouTube$/, "")).trim(),
      channel_name: (first(SELECTORS.channel)?.textContent || "Unknown_Channel").trim(),
      video_url: location.href.split("&")[0],
      lines,
    },
  };
}

// --- Trigger from toolbar icon / keyboard shortcut ------------------------

async function triggerActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log("[YTH] trigger; active tab url =", tab?.url);
  notify(`Scraping transcript… (v${VERSION})`, "Reading the open transcript panel.");
  if (!tab || !/^https?:\/\/www\.youtube\.com\/watch/.test(tab.url || "")) {
    notify("Not a YouTube video", "Navigate to a YouTube video first.");
    return;
  }
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageScrapeTranscript,
    });
  } catch (e) {
    console.error("[YTH] executeScript failed:", e);
    notify("Save failed", "Could not read the page. Reload the YouTube tab and try again.");
    return;
  }
  const result = results?.[0]?.result;
  console.log("[YTH] scrape result:", result);
  if (result?.ok) {
    saveTranscript(result.payload);
  } else {
    notify("Open the transcript panel", `Open the YouTube transcript panel first (${result?.reason || "no result"}).`);
  }
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
