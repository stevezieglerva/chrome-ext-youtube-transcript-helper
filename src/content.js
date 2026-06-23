// content.js — YouTube Transcript Helper
// Always-active on youtube.com/watch*. Detects the open transcript panel,
// injects a "Save Transcript" button, scrapes transcript lines + metadata,
// and hands a TranscriptPayload to background.js.

const BUTTON_ID = "yth-save-transcript-btn";

// --- Selectors (primary + fallback) -------------------------------------

const SELECTORS = {
  panel: ["ytd-transcript-renderer", '[target-id="engagement-panel-searchable-transcript"]'],
  segment: ["ytd-transcript-segment-renderer", 'div[class*="segment"]'],
  timestamp: [".segment-timestamp", '[class*="timestamp"]'],
  text: [".segment-text", '[class*="cue"]'],
  channel: ["ytd-channel-name yt-formatted-string", "#channel-name a"],
  title: ["ytd-watch-metadata h1 yt-formatted-string", "#title h1"],
};

function queryFirst(selectors, root = document) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function queryAll(selectors, root = document) {
  for (const sel of selectors) {
    const els = root.querySelectorAll(sel);
    if (els.length) return Array.from(els);
  }
  return [];
}

// --- Scraping ------------------------------------------------------------

function getVideoId() {
  return new URLSearchParams(window.location.search).get("v") || "";
}

function normalizeTimestamp(raw) {
  // Accepts "0:05", "1:23", "12:34", "1:02:03" -> "HH:MM:SS"
  const parts = raw.trim().split(":").map((p) => p.trim());
  let h = 0,
    m = 0,
    s = 0;
  if (parts.length === 3) [h, m, s] = parts.map(Number);
  else if (parts.length === 2) [m, s] = parts.map(Number);
  else if (parts.length === 1) s = Number(parts[0]);
  const pad = (n) => String(n || 0).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function scrapeTranscript() {
  const panel = queryFirst(SELECTORS.panel);
  if (!panel) {
    return { ok: false, reason: "no-panel" };
  }

  const segments = queryAll(SELECTORS.segment, panel);
  if (!segments.length) {
    return { ok: false, reason: "no-segments" };
  }

  const lines = [];
  for (const seg of segments) {
    const tsEl = queryFirst(SELECTORS.timestamp, seg);
    const txtEl = queryFirst(SELECTORS.text, seg);
    const text = (txtEl?.textContent || "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    const timestamp = tsEl ? normalizeTimestamp(tsEl.textContent) : "00:00:00";
    lines.push({ timestamp, text });
  }

  if (!lines.length) {
    return { ok: false, reason: "no-lines" };
  }

  const channelEl = queryFirst(SELECTORS.channel);
  const titleEl = queryFirst(SELECTORS.title);

  return {
    ok: true,
    payload: {
      video_id: getVideoId(),
      video_title: (titleEl?.textContent || document.title.replace(/ - YouTube$/, "")).trim(),
      channel_name: (channelEl?.textContent || "Unknown_Channel").trim(),
      video_url: window.location.href.split("&")[0],
      lines,
    },
  };
}

// --- Button injection ----------------------------------------------------

function injectButton() {
  const panel = queryFirst(SELECTORS.panel);
  if (!panel) return;
  if (panel.querySelector(`#${BUTTON_ID}`)) return; // already injected

  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.textContent = "💾 Save Transcript";
  btn.style.cssText = [
    "display:block",
    "width:calc(100% - 24px)",
    "margin:8px 12px",
    "padding:8px 12px",
    "font-family:'Roboto',sans-serif",
    "font-size:14px",
    "font-weight:500",
    "color:#fff",
    "background:#0b4778",
    "border:none",
    "border-radius:18px",
    "cursor:pointer",
  ].join(";");
  btn.addEventListener("mouseenter", () => (btn.style.background = "#005ea2"));
  btn.addEventListener("mouseleave", () => (btn.style.background = "#0b4778"));
  btn.addEventListener("click", () => {
    const result = scrapeTranscript();
    if (result.ok) {
      btn.textContent = "⏳ Saving...";
      chrome.runtime.sendMessage({ type: "save", payload: result.payload }, () => {
        btn.textContent = "💾 Save Transcript";
      });
    } else {
      chrome.runtime.sendMessage({ type: "scrape-failed", reason: result.reason });
    }
  });

  panel.prepend(btn);
}

// --- Panel detection (MutationObserver) ----------------------------------

const observer = new MutationObserver(() => {
  if (queryFirst(SELECTORS.panel)) injectButton();
});

function startObserving() {
  observer.observe(document.body, { childList: true, subtree: true });
  // Attempt immediate injection in case panel is already open
  if (queryFirst(SELECTORS.panel)) injectButton();
}

// --- SPA navigation ------------------------------------------------------

window.addEventListener("yt-navigate-finish", () => {
  // New video may have loaded; re-attempt injection after DOM settles
  setTimeout(injectButton, 500);
});

// --- Message handling (toolbar / keyboard triggers from background) ------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "requestScrape") {
    sendResponse(scrapeTranscript());
  }
  return true;
});

// --- Init ----------------------------------------------------------------

startObserving();
