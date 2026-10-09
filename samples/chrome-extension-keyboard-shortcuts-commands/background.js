// Tab Tamer — service worker.
//
// Listener registration happens top-level and synchronously, before any
// await: Chrome kills this worker when it idles out, and a fresh worker
// only receives the event if its listeners existed on the very first turn.

chrome.commands.onCommand.addListener((command) => {
	if (command === 'toggle-pin') {
		togglePin();
	} else if (command === 'mute-tab' || command === 'mute-tab-global') {
		toggleMute();
	}
	// '_execute_action' never arrives here — reserved commands are handled
	// by the browser itself, which opens the popup without waking this file.
});

async function togglePin() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab) return;
	await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
}

async function toggleMute() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab) return;
	const muted = !(tab.mutedInfo && tab.mutedInfo.muted);
	await chrome.tabs.update(tab.id, { muted });
}

// A chord the browser or another extension already owns fails to register
// silently — the command just ends up with an empty shortcut. Check once,
// at install, and flag it on the badge so the popup can explain.
chrome.runtime.onInstalled.addListener((details) => {
	if (details.reason !== 'install') return;
	chrome.commands.getAll().then((commands) => {
		const unbound = commands.filter((c) => !c.shortcut);
		if (unbound.length > 0) {
			chrome.action.setBadgeBackgroundColor({ color: '#FB5B1A' });
			chrome.action.setBadgeText({ text: '!' });
		}
	});
});
