# ADR 0002 — Download Filename Strategy

**Status:** Accepted  
**Date:** 2026-06-24  
**Context:** `chrome.downloads.download()` in MV3 service workers silently ignores the `filename` parameter when the source URL is a `data:` URI and the path includes a subdirectory. This caused every save to land as `download.txt` or `download (N).txt` in the root Downloads folder regardless of the `filename` value passed.

---

## 1. `data:` URIs ignore subdirectory paths in `filename`

**Problem:** Original code saved to `youtube-transcripts/<channel>/<video_id>_<title>.txt` using a `data:text/plain` URL. Chrome MV3 stripped the entire suggested filename — files landed as `download.txt`.

**Decision:** Removing the subdirectory was not enough on its own. The `data:` URI + subdirectory combination is what triggers the bug; the root cause is that Chrome does not honor subdirectory paths in `filename` when the download source is a `data:` URI.

---

## 2. Offscreen document approach abandoned

**Problem:** The standard MV3 workaround is to use an offscreen document to call `URL.createObjectURL()` and return a `blob:` URL, which Chrome does respect. This was implemented (v2.0.0) but added significant complexity: an extra HTML file, a JS message handler, and an `offscreen` manifest permission.

**Decision:** Abandoned. The offscreen approach was not verified to work before being superseded by the simpler flat-file strategy below.

---

## 3. `yt_transcript_` prefix, flat Downloads root, `.transcript` extension (intermediate)

**Problem:** Need reliable filename control without a subdirectory. Also need files to be identifiable when Chrome ignores the name.

**Decision:** Save directly to the Downloads root with a fixed prefix and `.transcript` extension:

```
~/Downloads/yt_transcript_<video_id>_<safe_title>.transcript
```

- No subdirectory avoids Chrome's path-stripping behavior on `data:` URIs  
- `.transcript` extension distinguishes saves from other Downloads files  
- Tradeoff: `data:` and `blob:` URLs still resulted in UUID-named or no-extension files — Chrome ignored both the base name and extension regardless

**Outcome:** Did not fully solve the problem — Chrome still ignored the `filename` parameter for blob: URLs, producing bare UUID files with no extension.

---

## 4. Content script "Extension context invalidated" guard

**Problem:** When the extension is reloaded (e.g. during development), already-injected content scripts lose their runtime connection. Clicking the Save button called `chrome.runtime.sendMessage()` on a stale context and threw `Uncaught Error: Extension context invalidated`, showing no feedback to the user.

**Decision:** Wrap the click handler in `try/catch`. On error, change the button label to "⚠️ Reload page" with a tooltip explaining the extension was reloaded. The user must refresh the YouTube tab to reinject the content script — this is a Chrome limitation with no silent workaround.

---

## 5. `chrome.downloads.onDeterminingFilename` — correct solution (current)

**Problem:** Chrome ignores the `filename` parameter on `chrome.downloads.download()` for `blob:` and `data:` source URLs. Files land as UUID names or `download (N).txt` regardless of what `filename` is set to.

**Decision:** Use `chrome.downloads.onDeterminingFilename`, the API designed specifically for this case. The flow:

1. `createBlobUrl()` creates a blob URL via the offscreen document (required in MV3 service workers which lack `window` context)
2. `chrome.downloads.download({ url: blobUrl, saveAs: false })` starts the download without a filename hint
3. The download ID is stored in `pendingFilenames` map
4. `onDeterminingFilename` fires before Chrome writes the file — the listener calls `suggest({ filename, conflictAction: "uniquify" })` to apply the correct name

```
~/Downloads/yt_transcript_<video_id>_<safe_title>.transcript
```

- Confirmed working in Chrome MV3 as of 2026-06-24  
- `onDeterminingFilename` listener must be registered at the top level (not inside a function) — Chrome allows only one registration per extension

**Version:** 1.0.9
