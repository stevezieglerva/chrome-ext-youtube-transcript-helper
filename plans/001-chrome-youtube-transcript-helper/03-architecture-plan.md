# Architecture Plan: Chrome YouTube Transcript Helper

## Components

| Name | Responsibility | Language/Runtime | Inputs | Outputs |
|---|---|---|---|---|
| `manifest.json` | Extension config: permissions, host patterns, entry points, keyboard shortcut declaration | JSON / Chrome MV3 | — | Wires all other components |
| `content.js` | Always-active content script on `youtube.com/watch*`; MutationObserver for transcript panel; injects Save button; scrapes DOM; sends transcript payload to background | JavaScript / Browser DOM | YouTube DOM mutations, user button click | Message to `background.js` with TranscriptPayload |
| `background.js` | MV3 service worker; receives transcript payload; builds file text; calls `chrome.downloads`; fires notification; writes SaveLog entry to `chrome.storage.local` | JavaScript / Chrome Service Worker | Messages from `content.js` or toolbar icon click; `chrome.action.onClicked` | Downloaded `.txt` file, Chrome notification, updated SaveLog |
| `history.html` + `history.js` | Extension page showing log of saved transcripts from `chrome.storage.local` | HTML + JavaScript | `chrome.storage.local` SaveLog | Rendered table of past saves (title, channel, date, filepath) |

## Data Entities

| Name | Fields | Persistence |
|---|---|---|
| `TranscriptPayload` | `video_id: string`, `video_title: string`, `channel_name: string`, `video_url: string`, `lines: Array<{timestamp: string, text: string}>` | In-memory only (passed via message) |
| `TranscriptFile` | Header block (title, channel, URL, date) + lines formatted as `[HH:MM:SS] text` | `~/Downloads/youtube-transcripts/<safe_channel>/<video_id>_<safe_title>.txt` via `chrome.downloads` |
| `SaveLogEntry` | `video_id: string`, `video_title: string`, `channel_name: string`, `safe_channel: string`, `safe_title: string`, `video_url: string`, `saved_at: string (ISO)`, `filename: string`, `line_count: number` | `chrome.storage.local` key `"saveLog"` (array, max 500 entries, oldest dropped) |

## DOM Selectors

| Target | Primary Selector | Fallback Selector |
|---|---|---|
| Transcript panel (open detection) | `ytd-transcript-renderer` | `[target-id="engagement-panel-searchable-transcript"]` |
| Transcript segment rows | `ytd-transcript-segment-renderer` | `div[class*="segment"]` inside panel |
| Timestamp per segment | `.segment-timestamp` | `[class*="timestamp"]` inside segment |
| Transcript text per segment | `.segment-text` | `[class*="cue"]` inside segment |
| Channel name | `ytd-channel-name yt-formatted-string` | `#channel-name a` |
| Video title | `ytd-watch-metadata h1 yt-formatted-string` | `#title h1` |

## Integrations

| Name | Direction | Protocol | Auth |
|---|---|---|---|
| YouTube DOM | Inbound | Browser DOM API / MutationObserver | None (same-origin content script) |
| Chrome Downloads API | Outbound | `chrome.downloads.download()` | Extension permission `"downloads"` |
| Chrome Notifications API | Outbound | `chrome.notifications.create()` | Extension permission `"notifications"` |
| Chrome Storage API | Outbound (read + write) | `chrome.storage.local.get/set()` | Extension permission `"storage"` |
| Content ↔ Background messaging | Bidirectional | `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` | Extension internal |

## Runtime

| Component | Where it runs |
|---|---|
| `content.js` | Injected into every `https://www.youtube.com/watch*` page tab |
| `background.js` | Chrome MV3 service worker (spun up on demand, idles after) |
| `history.html` | Chrome extension page, opened via `chrome.tabs.create({ url: chrome.runtime.getURL("history.html") })` |

## Non-functional Notes

- **Auth:** None — local personal extension, no remote services
- **Secrets:** None
- **Permissions required in manifest:** `downloads`, `notifications`, `storage`, `activeTab`
- **Host permissions:** `*://www.youtube.com/*`
- **MV3 service worker note:** service worker may be killed between saves; all state must persist to `chrome.storage.local` before the worker idles
- **SPA navigation:** YouTube navigates between videos without full page reload; `content.js` must re-run panel detection and button injection on `yt-navigate-finish` custom event in addition to initial load
- **Filename sanitization:** replace `/[^a-zA-Z0-9]/g` with `_`, then replace `/_+/g` with `_`, then trim leading/trailing underscores — applied to both `safe_channel` and `safe_title`
- **Download subdirectory:** `chrome.downloads.download({ filename: "youtube-transcripts/<safe_channel>/<video_id>_<safe_title>.txt", ... })` — Chrome creates subdirectories automatically
