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

async function saveTranscript(payload, tabId) {
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
        const msg = chrome.runtime.lastError?.message || "Unknown download error";
        notify("Save failed", msg);
        if (tabId) showToast(tabId, `❌ Save failed: ${msg}`, "#d83933");
        return;
      }
      console.log("[YTH] download started, id =", downloadId);
      const rel = `${safeChannel}/${payload.video_id}_${safeTitle}.txt`;
      notify("Transcript saved", rel);
      if (tabId) showToast(tabId, `✅ Saved ${payload.lines.length} lines → ${rel}`, "#00a91c");
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
  const first = (sels, root = document) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
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

  // Locate the transcript panel (fall back to whole document).
  const panel =
    first(["ytd-transcript-renderer", '[target-id="engagement-panel-searchable-transcript"]']) || document;

  // Find segment rows: known element first, then any class containing
  // "segment" that holds a timestamp, then any small element whose text
  // begins with a timestamp.
  let segs = Array.from(panel.querySelectorAll("ytd-transcript-segment-renderer"));
  if (!segs.length) {
    segs = Array.from(panel.querySelectorAll('[class*="segment"]')).filter((el) =>
      /\b\d{1,2}:\d{2}\b/.test(el.textContent || "")
    );
  }

  // Diagnostics (returned on failure, written to _DEBUG.txt by background).
  const debug = { panelTag: panel.tagName || "DOCUMENT", segCount: segs.length, tagCounts: {}, sampleHTML: "" };
  if (panel.querySelectorAll) {
    panel.querySelectorAll("*").forEach((e) => {
      const t = e.tagName.toLowerCase();
      if (/segment|cue|transcript/.test(t)) debug.tagCounts[t] = (debug.tagCounts[t] || 0) + 1;
    });
  }
  if (segs[0]) {
    debug.sampleHTML = segs[0].outerHTML.slice(0, 700);
  } else {
    const any = Array.from(panel.querySelectorAll ? panel.querySelectorAll("*") : []).find(
      (e) => /^\s*\d{1,2}:\d{2}/.test(e.textContent || "") && e.children.length <= 3
    );
    debug.sampleHTML = any ? any.outerHTML.slice(0, 700) : "(no timestamp-like element found)";
  }

  if (!segs.length) {
    return { ok: false, reason: panel === document ? "no-panel" : "no-segments", debug };
  }

  const lines = [];
  for (const seg of segs) {
    let timestamp = "";
    let text = "";
    const tsEl = seg.querySelector('.segment-timestamp, [class*="timestamp"]');
    const txtEl = seg.querySelector('.segment-text, [class*="cue"], yt-formatted-string');
    if (txtEl) text = (txtEl.textContent || "").trim().replace(/\s+/g, " ");
    if (tsEl) timestamp = normTs(tsEl.textContent);
    // Generic fallback: parse "MM:SS rest of line" out of the row text.
    if (!text || !timestamp) {
      const full = (seg.textContent || "").trim().replace(/\s+/g, " ");
      const m = full.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/);
      if (m) {
        if (!timestamp) timestamp = normTs(m[1]);
        if (!text) text = m[2];
      }
    }
    if (text) lines.push({ timestamp: timestamp || "00:00:00", text });
  }
  if (!lines.length) return { ok: false, reason: "no-lines", debug };

  return {
    ok: true,
    payload: {
      video_id: new URLSearchParams(location.search).get("v") || "",
      video_title: (
        first(["ytd-watch-metadata h1 yt-formatted-string", "#title h1"])?.textContent ||
        document.title.replace(/ - YouTube$/, "")
      ).trim(),
      channel_name: (
        first(["ytd-channel-name yt-formatted-string", "#channel-name a"])?.textContent || "Unknown_Channel"
      ).trim(),
      video_url: location.href.split("&")[0],
      lines,
    },
  };
}

// --- In-page toast (injected) --------------------------------------------
// Shows a banner directly on the YouTube page — independent of macOS
// notification settings and visible in the tab the user is looking at.

function pageToast(message, bgColor) {
  let el = document.getElementById("yth-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "yth-toast";
    el.style.cssText =
      "position:fixed;top:72px;right:20px;z-index:2147483647;padding:12px 18px;" +
      "border-radius:8px;color:#fff;font-family:Roboto,Arial,sans-serif;font-size:14px;" +
      "font-weight:500;box-shadow:0 4px 14px rgba(0,0,0,0.35);max-width:380px;" +
      "transition:opacity 0.4s;";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.background = bgColor;
  el.style.opacity = "1";
  clearTimeout(el._ythTimer);
  el._ythTimer = setTimeout(() => (el.style.opacity = "0"), 5000);
}

async function showToast(tabId, message, bgColor) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: pageToast,
      args: [message, bgColor],
    });
  } catch (e) {
    console.error("[YTH] toast injection failed:", e);
  }
}

// --- Trigger from toolbar icon / keyboard shortcut ------------------------

async function triggerActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log("[YTH] trigger; active tab url =", tab?.url);
  if (!tab || !/^https?:\/\/www\.youtube\.com\/watch/.test(tab.url || "")) {
    notify("Not a YouTube video", "Navigate to a YouTube video first.");
    return;
  }

  await showToast(tab.id, `⏳ Scraping transcript… (v${VERSION})`, "#0b4778");

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageScrapeTranscript,
    });
  } catch (e) {
    console.error("[YTH] executeScript failed:", e);
    await showToast(tab.id, "❌ Could not read the page — reload the tab and retry", "#d83933");
    return;
  }

  const result = results?.[0]?.result;
  console.log("[YTH] scrape result:", result);
  if (result?.ok) {
    saveTranscript(result.payload, tab.id);
  } else {
    await showToast(tab.id, `❌ ${result?.reason || "no result"} — wrote _DEBUG.txt to Downloads`, "#d83933");
    const dbg =
      `REASON: ${result?.reason}\nVERSION: ${VERSION}\nURL: ${tab.url}\n\n` +
      JSON.stringify(result?.debug || {}, null, 2);
    chrome.downloads.download({
      url: "data:text/plain;charset=utf-8," + encodeURIComponent(dbg),
      filename: `${DOWNLOAD_ROOT}/_DEBUG.txt`,
      conflictAction: "overwrite",
      saveAs: false,
    });
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
