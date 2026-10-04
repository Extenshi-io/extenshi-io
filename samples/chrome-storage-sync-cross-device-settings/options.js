const DEFAULTS = { theme: 'light', fontSize: 14, badge: true };

const themeEl = document.getElementById('theme');
const fontSizeEl = document.getElementById('font-size');
const fontSizeValueEl = document.getElementById('font-size-value');
const badgeEl = document.getElementById('badge');

function render(settings) {
	themeEl.value = settings.theme;
	fontSizeEl.value = String(settings.fontSize);
	fontSizeValueEl.textContent = settings.fontSize;
	badgeEl.checked = settings.badge;
}

/* ---------- save: every control writes straight to sync ---------- */

themeEl.addEventListener('change', () => {
	chrome.storage.sync.set({ theme: themeEl.value });
});

badgeEl.addEventListener('change', () => {
	chrome.storage.sync.set({ badge: badgeEl.checked });
});

// The slider fires far faster than the sync write budget (120 ops/minute),
// so the label updates per tick and storage only hears about it 400ms
// after the user stops dragging.
let fontTimer;
fontSizeEl.addEventListener('input', () => {
	fontSizeValueEl.textContent = fontSizeEl.value;
	clearTimeout(fontTimer);
	fontTimer = setTimeout(() => {
		chrome.storage.sync.set({ fontSize: Number(fontSizeEl.value) });
	}, 400);
});

/* ---------- quotas you can see ---------- */

async function refreshQuotas() {
	const [syncBytes, localBytes] = await Promise.all([
		chrome.storage.sync.getBytesInUse(null),
		chrome.storage.local.getBytesInUse(null)
	]);
	const fmt = (n) => n.toLocaleString('en-US');
	document.getElementById('quota-sync').textContent =
		`sync: ${fmt(syncBytes)} of ${fmt(chrome.storage.sync.QUOTA_BYTES)} bytes`;
	document.getElementById('quota-local').textContent =
		`local: ${fmt(localBytes)} of ${fmt(chrome.storage.local.QUOTA_BYTES)} bytes`;
}

/* ---------- mirror changes made elsewhere: another window, another device ---------- */

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === 'sync') {
		if (changes.theme) themeEl.value = changes.theme.newValue;
		if (changes.fontSize) {
			fontSizeEl.value = String(changes.fontSize.newValue);
			fontSizeValueEl.textContent = changes.fontSize.newValue;
		}
		if (changes.badge) badgeEl.checked = changes.badge.newValue;
	}
	refreshQuotas();
});

/* ---------- load: get() with defaults, render once ---------- */

async function init() {
	// get() with a defaults object fills in every missing key — nothing is
	// written on first run, so there is nothing to seed and nothing to race.
	render(await chrome.storage.sync.get(DEFAULTS));
	refreshQuotas();
}

init();
