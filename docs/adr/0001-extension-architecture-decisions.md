# ADR 0001 — Extension Architecture Decisions

**Status:** Accepted
**Date:** 2026-06-23
**Context:** Decisions below were forced (or revised) while getting the MV3 extension working end-to-end against live YouTube. Each entry pairs the problem observed with the decision taken.

---

## 1. Use `chrome.scripting.executeScript` for the toolbar/shortcut path — not a pre-injected content script

**Problem:** The first design had the content script (`content.js`) always injected via `manifest.content_scripts`, with the toolbar icon / shortcut sending it a `requestScrape` message. Saving silently failed: after reloading the extension, any **already-open** YouTube tab still ran the old (or no) content script, so `chrome.tabs.sendMessage` had nothing to talk to and produced no file.

**Decision:** The toolbar-icon and keyboard-shortcut paths inject the scrape function on demand with `chrome.scripting.executeScript({ target, func })` from the service worker. The scrape function is self-contained (no external references) because it runs in the page.

**Consequences:** Saving works immediately after an extension reload without refreshing the YouTube tab. Requires the `scripting` permission. The in-page button path still uses the content script (it's already in the page).

---

## 2. In-page toast banners instead of relying on `chrome.notifications`

**Problem:** "Nothing happens on click." The code was calling `chrome.notifications.create`, but macOS was silently suppressing Chrome's system notifications, so successful and failed runs looked identical (invisible) to the user — making the extension appear dead.

**Decision:** Inject a fixed-position banner directly onto the YouTube page (`pageToast` via `executeScript`) for trigger / success / failure. `chrome.notifications` is kept as a secondary signal.

**Consequences:** Feedback is always visible in the tab the user is looking at, independent of OS notification settings and without needing the service-worker console. The banner also became the primary live diagnostic during development.

---

## 3. Deep, shadow-DOM-piercing, document-wide segment scraper

**Problem:** Scraping returned `no-segments` even with the transcript clearly open. The original selectors (`ytd-transcript-renderer` / `ytd-transcript-segment-renderer`, scoped to the matched panel) found nothing. Diagnostics revealed YouTube migrated transcripts to **view-model web components**: container `transcript-segment-view-model`, timestamp `div.ytwTranscriptSegmentViewModelTimestamp`. The matched engagement-panel wrapper was empty in the light DOM; content lived deeper.

**Decision:** Walk the entire document with a recursive traversal that **pierces shadow roots**, and match the segment container tag (`transcript-segment-view-model`, with `ytd-transcript-segment-renderer` as legacy fallback) document-wide rather than scoped to a panel element.

**Consequences:** Resilient to YouTube moving content between DOM subtrees / shadow roots. Slightly more expensive (full-document walk) but negligible for a manual, on-demand action.

---

## 4. Move the keyboard shortcut off `Cmd+Shift+T`

**Problem:** `Cmd+Shift+T` is reserved by Chrome ("reopen closed tab"); the extension command never fired.

**Decision:** Default shortcut is `Cmd+Shift+Y` / `Ctrl+Shift+Y`, rebindable at `chrome://extensions/shortcuts`.

**Consequences:** Avoid colliding with built-in browser shortcuts when choosing defaults.

---

## 5. Text-only output; strip the screen-reader duration label

**Problem:** Each view-model segment's text node was preceded by an accessibility duration label (e.g. `0:14` → "14 seconds"), which leaked into the saved text as `14 secondsHi and welcome...`. The actual caption-text element's class was not discoverable by simple selectors.

**Decision:** Extract text by cloning the segment, removing the timestamp node, then stripping a leading duration phrase (`/^(?:\d+\s+(?:hours?|minutes?|seconds?)(?:,\s*)?)+/i`). Per user preference, **timestamps are omitted from the output entirely** — the file is clean text only.

**Consequences:** Clean prose suitable for 2nd Brain ingestion. Small risk: a caption that genuinely begins with a duration phrase ("30 seconds left…") could be over-stripped — acceptable for personal use. Timestamp data is still parsed internally (used to clean text) but not written.

---

## 6. Self-diagnostic `_DEBUG.txt` fallback

**Problem:** Iterating on selectors was slow because runtime state lived in the service-worker console, which was hard to access and easy to confuse with the noisy YouTube page console.

**Decision:** On scrape failure, write `youtube-transcripts/_DEBUG.txt` to Downloads containing the failure reason, version, URL, a document-wide tag census, and a sample segment's HTML.

**Consequences:** DOM-structure changes can be diagnosed from a file rather than console screenshots. The debug file is overwritten each failure and can be deleted freely.

---

## 7. Files land in `~/Downloads/` (Chrome API constraint)

**Problem:** The desired output path was an S3-style local tree at an arbitrary location. Chrome extensions cannot write to arbitrary filesystem paths without a native-messaging host.

**Decision:** Use `chrome.downloads.download` with a subdirectory under Downloads: `youtube-transcripts/<safe_channel>/<video_id>_<safe_title>.txt`, `conflictAction: "overwrite"`. A separate user-owned script handles polishing and S3 upload before ingestion.

**Consequences:** No native host needed. Output is confined to `~/Downloads/youtube-transcripts/`; the downstream pipeline bridges to the final S3 location.
