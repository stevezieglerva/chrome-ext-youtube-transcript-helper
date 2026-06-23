# Product Brief: Chrome YouTube Transcript Helper

## Problem
YouTube's web UI blocks headless/automated transcript extraction (UA detection, spinner-hang). A Chrome extension can access the live transcript panel DOM directly, bypassing these restrictions and producing clean local files ready for 2nd Brain ingestion.

## Users
- **Steve (solo power user)** — developer who watches YouTube for research and needs transcripts ingested into his 2nd Brain knowledge base without fighting YouTube's anti-automation measures.

## Value
After navigating to any YouTube video and opening the transcript panel, Steve triggers the extension and a timestamped transcript file appears immediately at a predictable local path, structured for downstream ingestion scripts.

## Scope — In
- Scrape all visible transcript lines + timestamps from the open transcript panel DOM
- Scrape channel name from the YouTube page DOM; sanitize to `safe_channel` (alphanumeric + underscores)
- Extract `video_id` from the current URL
- Scrape video title; sanitize to `safe_title`
- Save file via `chrome.downloads` API to:
  `~/Downloads/youtube-transcripts/<safe_channel>/<video_id>_<safe_title>.txt`
- Each line format: `[HH:MM:SS] Transcript text here.`
- File header block: video title, channel, URL, date saved
- Three trigger methods: toolbar icon click, keyboard shortcut (configurable), injected "Save Transcript" button on YouTube page
- Overwrite existing file if same path already exists
- Show success/error notification after save attempt

## Scope — Out
- S3 upload (Steve handles this separately before ingesting)
- Auto-opening the transcript panel (must be open before triggering)
- Multi-user support or cloud sync
- Translation or summarization of transcript content
- Support for non-YouTube video sites

## Success Signals
- File appears at correct `~/Downloads/youtube-transcripts/<safe_channel>/` path within 2 seconds of trigger
- Channel name and title are correctly scraped and sanitized on ≥95% of standard YouTube videos
- Zero manual cleanup needed on the filename before running the downstream ingest script

## Primary Risk
**YouTube DOM structure changes break the transcript line selector or channel name scraper.**
Mitigation: use multiple fallback CSS selectors for each target element; log which selector succeeded so breakage is immediately obvious.
