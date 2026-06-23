// history.js — renders the SaveLog from chrome.storage.local.

const SAVE_LOG_KEY = "saveLog";

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  return String(s || "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function render(log) {
  const countEl = document.getElementById("count");
  const contentEl = document.getElementById("content");

  if (!log.length) {
    countEl.textContent = "No transcripts saved yet";
    contentEl.innerHTML = '<p class="empty">Save a transcript from a YouTube video to see it here.</p>';
    return;
  }

  countEl.textContent = `${log.length} saved transcript${log.length === 1 ? "" : "s"}`;

  const rows = log
    .slice()
    .reverse() // newest first
    .map(
      (e) => `
      <tr>
        <td>${fmtDate(e.saved_at)}</td>
        <td><a href="${escapeHtml(e.video_url)}" target="_blank" rel="noreferrer">${escapeHtml(e.video_title)}</a></td>
        <td>${escapeHtml(e.channel_name)}</td>
        <td>${e.line_count}</td>
        <td class="filename">${escapeHtml(e.filename)}</td>
      </tr>`
    )
    .join("");

  contentEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Saved</th>
          <th>Title</th>
          <th>Channel</th>
          <th>Lines</th>
          <th>File</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function load() {
  const stored = await chrome.storage.local.get(SAVE_LOG_KEY);
  render(Array.isArray(stored[SAVE_LOG_KEY]) ? stored[SAVE_LOG_KEY] : []);
}

document.getElementById("version").textContent = "v" + chrome.runtime.getManifest().version;

document.getElementById("clear").addEventListener("click", async () => {
  if (confirm("Clear the entire saved-transcript log? This does not delete the files.")) {
    await chrome.storage.local.set({ [SAVE_LOG_KEY]: [] });
    load();
  }
});

load();
