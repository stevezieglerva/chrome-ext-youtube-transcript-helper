# User Stories: Chrome YouTube Transcript Helper

## US-001 — Save Transcript to Local File
**As a** solo power user  
**I want** to save the full transcript from the open YouTube transcript panel to a structured local file  
**So that** I have a clean, consistently-named file ready for 2nd Brain ingestion

**Priority:** P0  
**Acceptance Criteria:**
- File is written to `~/Downloads/youtube-transcripts/<safe_channel>/<video_id>_<safe_title>.txt`
- File begins with a metadata header: video title, channel name, video URL, date saved (ISO format)
- Each transcript line is formatted as `[HH:MM:SS] Transcript text here.`
- If the file already exists at that path, it is overwritten silently
- `safe_channel` and `safe_title` replace all non-alphanumeric characters with underscores and collapse runs of underscores to one

---

## US-002 — View Saved Transcript in New Tab
**As a** solo power user  
**I want** the saved transcript file to open automatically in a new browser tab after saving  
**So that** I can immediately verify the content without hunting through Finder

**Priority:** P0  
**Acceptance Criteria:**
- After a successful save, Chrome opens the downloaded file in a new tab (`chrome://` or `file://` URL via `chrome.downloads` `open` method)
- A Chrome toast notification also fires: "Transcript saved: `<filename>`"
- Both the tab and the notification appear within 2 seconds of the trigger

---

## US-003 — Trigger via Toolbar Icon
**As a** solo power user  
**I want** to click the extension toolbar icon to save the transcript  
**So that** I can trigger it without leaving the keyboard or memorizing a shortcut

**Priority:** P0  
**Acceptance Criteria:**
- Clicking the toolbar icon while on a YouTube video page with the transcript panel open triggers US-001 + US-002
- Clicking when the transcript panel is not open shows a Chrome notification: "Open the YouTube transcript panel first, then click again"
- Clicking on a non-YouTube page shows a Chrome notification: "Navigate to a YouTube video first"

---

## US-004 — Trigger via Keyboard Shortcut
**As a** solo power user  
**I want** a keyboard shortcut to save the transcript  
**So that** I can trigger it without moving my hand to the mouse

**Priority:** P1  
**Acceptance Criteria:**
- Default shortcut: `Ctrl+Shift+T` (Windows/Linux) / `Cmd+Shift+T` (Mac) — configurable via `chrome://extensions/shortcuts`
- Shortcut behavior is identical to toolbar icon click (US-003 acceptance criteria apply)

---

## US-005 — Trigger via Injected Button in Transcript Panel
**As a** solo power user  
**I want** a "Save Transcript" button injected at the top of the YouTube transcript panel  
**So that** the save action is visually anchored to where I'm already looking

**Priority:** P1  
**Acceptance Criteria:**
- A "Save Transcript" button appears at the top of the transcript panel whenever the panel is open on a YouTube video page
- Button is injected after the panel becomes visible (MutationObserver detects panel open)
- Clicking the button triggers US-001 + US-002
- Button re-injects if YouTube's SPA navigation loads a new video without a full page reload
- Button does not appear on non-video YouTube pages (search, home, channel pages)

---

## US-006 — Graceful Handling When Panel Not Open
**As a** solo power user  
**I want** a clear error message when I trigger the extension without the transcript panel open  
**So that** I know exactly what to do next instead of seeing a silent failure

**Priority:** P0  
**Acceptance Criteria:**
- When toolbar icon or keyboard shortcut is triggered and no transcript panel DOM element is detected, a Chrome notification fires: "Open the YouTube transcript panel first, then try again"
- No file is written, no tab is opened
- The notification dismisses automatically after 5 seconds
