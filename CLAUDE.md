# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal Chrome extension (Manifest V3) that scrapes the open YouTube transcript panel and saves it as a structured text file for 2nd Brain ingestion. No build step — load `src/` directly as an unpacked extension.

## Installing / reloading

1. `chrome://extensions/` → Enable **Developer mode** → **Load unpacked** → select `src/`
2. After any code change: click the reload icon on the extension card
3. After reloading, **refresh any open YouTube tabs** — content scripts injected before the reload are stale and will show "Extension context invalidated" on click

## Versioning

Use `1.0.<increment>` — e.g. `1.0.9` → `1.0.10`. Never bump major/minor. Version lives only in `src/manifest.json`; `background.js` reads it at runtime via `chrome.runtime.getManifest().version`.

## Architecture

Three execution contexts — each isolated by Chrome:

| Context | File | Lifetime |
|---|---|---|
| **Service worker** | `background.js` | Ephemeral — terminates when idle |
| **Content script** | `content.js` | Injected into `youtube.com/watch*` pages |
| **Offscreen document** | `offscreen.js` | Created on demand; one at a time |

### Data flow

**In-page button path** (content script):
`content.js` button click → `chrome.runtime.sendMessage({type:"save"})` → `background.js` `saveTranscript()`

**Toolbar / shortcut path** (service worker):
`background.js` `triggerActiveTab()` → `chrome.scripting.executeScript({ func: pageScrapeTranscript })` → result returned directly → `saveTranscript()`

The scraper function `pageScrapeTranscript` in `background.js` is **self-contained** (no closures, no imports) because `executeScript` serialises it to run in the page context.

### Download filename problem (see ADR 0002)

Chrome MV3 ignores the `filename` parameter on `chrome.downloads.download()` when the source is a `blob:` or `data:` URL. The current approach:

1. `createBlobUrl()` creates a blob URL via the offscreen document (which has `window` context and can call `URL.createObjectURL`)
2. Register the intended filename in `pendingFilenames` map before calling `chrome.downloads.download()`
3. `chrome.downloads.onDeterminingFilename` fires before the file is written — that listener calls `suggest({ filename })` to apply the correct name

Files land in `~/Downloads/` as `yt_transcript_<video_id>_<safe_title>.transcript`.

### DOM scraping

YouTube uses shadow DOM and web components. `pageScrapeTranscript` in `background.js` walks the entire document recursively piercing shadow roots (`deepAll`/`deepFirst`). Primary target elements: `<transcript-segment-view-model>` (current YouTube) with `<ytd-transcript-segment-renderer>` as legacy fallback.

Selectors are defined in `SELECTORS` in `content.js` (used for button injection / panel detection only) and inline in `pageScrapeTranscript` (used for scraping — must be self-contained).

### Debugging failed scrapes

On `no-segments` or `no-lines` failure, `background.js` writes `_DEBUG.txt` to Downloads containing the failure reason, a document-wide tag census, and sample HTML. Check this before touching selectors.

## Key constraints

- **No build step** — plain JS, no npm, no bundler
- **`pageScrapeTranscript` must stay self-contained** — it runs via `executeScript` in the page context; any reference to an outer variable will silently fail
- `chrome.offscreen` allows only **one document at a time** — `createDocument` is wrapped in try/catch to reuse the existing one
- The `onDeterminingFilename` listener may only be registered **once** per extension — do not add it inside a function

## ADRs

Key decisions are in `docs/adr/`:
- `0001` — why `executeScript` instead of content-script messaging; shadow DOM scraper; toast banners
- `0002` — why `data:`/`blob:` URLs fail for filenames; offscreen blob + `onDeterminingFilename` approach
