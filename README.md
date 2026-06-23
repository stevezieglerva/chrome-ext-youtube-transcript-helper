# YouTube Transcript Helper

A personal, local-only Chrome extension (Manifest V3) that saves the **open YouTube transcript panel** to a structured local file ready for 2nd Brain ingestion.

It works around YouTube's anti-automation measures (headless UA detection, transcript-API spinner hang) by reading the live transcript panel DOM directly from a real browser session.

## What it does

1. You navigate to a YouTube video and open the transcript panel manually.
2. You trigger the extension (three ways — see below).
3. It scrapes every transcript line + timestamp, plus the channel name and title.
4. It writes a file to:

   ```
   ~/Downloads/youtube-transcripts/<safe_channel>/<video_id>_<safe_title>.txt
   ```

   Example:
   ```
   ~/Downloads/youtube-transcripts/Gordon_Crum/40Dia4xBDBY_Why_Are_The_Fireflies_Disappearing.txt
   ```

### File format

```
Title:    Why Are The Fireflies Disappearing
Channel:  Gordon Crum
URL:      https://www.youtube.com/watch?v=40Dia4xBDBY
Saved:    2026-06-23T12:47:03.123Z
Lines:    312
Saved by: YouTube Transcript Helper v1.7.0
============================================================
First line of the transcript.
Second line of the transcript.
...
```

> Transcript lines are saved as **text only** — timestamps are omitted from the output.

> **Note:** Chrome extensions can only write inside the Downloads folder via the
> `chrome.downloads` API — arbitrary filesystem paths require a native-messaging
> host. Files land in `~/Downloads/youtube-transcripts/`; move/polish them with
> your own script before S3 upload + ingestion.

## Triggers

| Method | How |
|---|---|
| **Toolbar icon** | Click the extension icon in the Chrome toolbar. Works on any open transcript panel — independent of the in-page button. |
| **Keyboard shortcut** | `Cmd+Shift+Y` (Mac) / `Ctrl+Shift+Y` (Win/Linux). Rebind at `chrome://extensions/shortcuts`. |
| **Injected button** | A "💾 Save Transcript" button appears at the top of the transcript panel. |

> `Cmd+Shift+T` is **not** usable — Chrome reserves it for "reopen closed tab". The shortcut is `Cmd+Shift+Y`.

The transcript panel **must be open** before triggering, or you'll get a notification telling you to open it.

## Saved-transcript log

Every save is logged to `chrome.storage.local`. **Right-click the toolbar icon → "View saved transcripts"** to open a history page listing title, channel, line count, date, and file path.

## Install (unpacked)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `src/` folder of this repo
5. Pin the icon to the toolbar (optional)

## Files

| File | Role |
|---|---|
| `src/manifest.json` | MV3 config, permissions, commands |
| `src/content.js` | DOM scraper, panel detection, button injection, SPA-nav handling |
| `src/background.js` | Service worker: file build, download, notification, save log, context menu |
| `src/history.html` / `history.js` | Saved-transcript log viewer |
| `src/icons/` | Toolbar/notification icons |
| `plans/` | plan-mega planning artifacts |

## Known limitations

- Relies on YouTube's DOM structure (`ytd-transcript-segment-renderer`, etc.). If YouTube changes these, update the selectors in `content.js` (`SELECTORS`). Each target has a primary + fallback selector.
- Does not auto-open the transcript panel — by design.
- Files always land in `~/Downloads/` (Chrome API constraint).
