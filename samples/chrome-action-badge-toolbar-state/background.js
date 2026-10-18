// Tab Pulse — the service worker.
//
// Two MV3 rules keep this file honest:
//   1. Register listeners top-level and synchronously. Chrome kills this
//      worker when it goes idle, and a freshly spawned worker only receives
//      events whose listeners were attached on the script's first turn.
//   2. Never trust a module-level variable to survive. The tap count lives in
//      chrome.storage.session, so the next tap still increments the real
//      number after the worker has been torn down and respawned.

const ACTIVE_COLOR = '#FB5B1A'; // badge background + "tapped" icon
const IDLE_COLOR = '#8A857E';   // hollow ring when a tab has no taps

// Clicking the toolbar icon is the whole input: bump this tab's count.
// This fires only because the manifest sets no default_popup.
chrome.action.onClicked.addListener((tab) => {
	if (typeof tab.id === 'number') {
		serial(() => bump(tab.id));
	}
});

// Give the action its idle look when the extension loads or the browser
// starts. No tabId means this sets the GLOBAL default, so every tab without
// an override of its own, including tabs opened later, shows the ring.
chrome.runtime.onInstalled.addListener(paintDefault);
chrome.runtime.onStartup.addListener(paintDefault);

// Chrome wipes a tab's badge, icon and title every time the tab loads a new
// document, reloads included. The count is still in storage, so put it back
// once the new page has finished loading.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === 'complete') {
		serial(() => repaint(tabId));
	}
});

// Per-tab action state dies with the tab; drop its count to match.
chrome.tabs.onRemoved.addListener((tabId) => {
	serial(() => forget(tabId));
});

// Two quick clicks can both read the old count before either write lands,
// and one tap is lost. Chaining every read-modify-write prevents that. This
// is the one module-level variable that is safe here: it only orders work
// that is still in flight, and holds nothing worth keeping.
let queue = Promise.resolve();
function serial(task) {
	queue = queue.then(task, task);
	return queue;
}

async function bump(tabId) {
	// Read-modify-write against session storage, never a local variable.
	const { counts = {} } = await chrome.storage.session.get('counts');
	counts[tabId] = (counts[tabId] || 0) + 1;
	await chrome.storage.session.set({ counts });
	await paint(tabId, counts[tabId]);
}

// One function paints every piece of the action for ONE tab: badge text,
// badge color, tooltip, icon. Passing tabId is what keeps the state from
// leaking across tabs — drop it and every setter becomes global.
async function paint(tabId, count) {
	const text = count > 99 ? '99+' : count > 0 ? String(count) : '';
	await chrome.action.setBadgeText({ text, tabId });
	await chrome.action.setBadgeBackgroundColor({ color: ACTIVE_COLOR, tabId });
	await chrome.action.setTitle({
		title: count > 0
			? `Tab Pulse — ${count} tap${count === 1 ? '' : 's'} on this tab`
			: 'Tab Pulse — click to count',
		tabId
	});
	await setDotIcon(tabId, count > 0);
}

// The icon is drawn in code — no PNG files to ship. OffscreenCanvas works in
// the service worker, and setIcon accepts raw ImageData keyed by size.
async function setDotIcon(tabId, active) {
	try {
		const imageData = {};
		for (const size of [16, 32]) {
			const canvas = new OffscreenCanvas(size, size);
			const ctx = canvas.getContext('2d');
			const pad = Math.max(2, Math.round(size / 12));
			ctx.beginPath();
			ctx.arc(size / 2, size / 2, size / 2 - pad, 0, Math.PI * 2);
			if (active) {
				ctx.fillStyle = ACTIVE_COLOR;
				ctx.fill();
			} else {
				ctx.strokeStyle = IDLE_COLOR;
				ctx.lineWidth = pad;
				ctx.stroke();
			}
			imageData[size] = ctx.getImageData(0, 0, size, size);
		}
		await chrome.action.setIcon({ imageData, tabId });
	} catch (err) {
		// The icon is cosmetic — never let it take the counter down with it.
		console.warn('setIcon failed', err);
	}
}

async function paintDefault() {
	await setDotIcon(undefined, false);
}

async function repaint(tabId) {
	const { counts = {} } = await chrome.storage.session.get('counts');
	if (counts[tabId]) {
		await paint(tabId, counts[tabId]);
	}
}

async function forget(tabId) {
	const { counts = {} } = await chrome.storage.session.get('counts');
	if (tabId in counts) {
		delete counts[tabId];
		await chrome.storage.session.set({ counts });
	}
}
