// Settings live in chrome.storage.sync; the note lives in chrome.storage.local.
const DEFAULTS = { theme: 'light', fontSize: 14, badge: true };
const settings = { ...DEFAULTS };

const noteEl = document.getElementById('note');
const statusEl = document.getElementById('status');

function applySettings() {
	document.body.dataset.theme = settings.theme;
	noteEl.style.fontSize = `${settings.fontSize}px`;
}

/* ---------- the note: autosave, debounced, local ---------- */

let saveTimer;
noteEl.addEventListener('input', () => {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(async () => {
		await chrome.storage.local.set({ note: noteEl.value });
		statusEl.textContent = `Saved · ${noteEl.value.length} chars`;
	}, 400);
});

document.getElementById('open-options').addEventListener('click', (e) => {
	e.preventDefault();
	chrome.runtime.openOptionsPage();
});

/* ---------- live updates from any window — or any device ---------- */

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'sync') return; // the note changes constantly; ignore local
	for (const key of Object.keys(DEFAULTS)) {
		if (key in changes) settings[key] = changes[key].newValue;
	}
	applySettings();
	statusEl.textContent = 'Settings updated — another window or device';
});

/* ---------- load both areas ---------- */

async function init() {
	Object.assign(settings, await chrome.storage.sync.get(DEFAULTS));
	applySettings();
	const { note = '' } = await chrome.storage.local.get('note');
	noteEl.value = note;
	statusEl.textContent = `${note.length} chars · kept on this device`;
}

init();
