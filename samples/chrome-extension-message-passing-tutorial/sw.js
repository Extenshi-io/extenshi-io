// Marker — service worker, the hub. Holds the privileged chrome.* APIs,
// sees no page. Commands from the popup are routed from here to the right tab.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	// Commands must come from our own extension's pages (the popup).
	// A content-script message would carry sender.tab; a web page could
	// only reach us via onMessageExternal, which we never register.
	if (sender.id !== chrome.runtime.id || sender.tab) return;

	if (message?.type === 'highlight' || message?.type === 'clear') {
		routeToActiveTab(message)
			.then(sendResponse)
			.catch((error) => sendResponse({ ok: false, error: error.message }));
		return true; // the response comes after awaits — keep the channel open
	}
});

async function routeToActiveTab(message) {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id) return { ok: false, error: 'Could not find the active tab.' };
	console.log('[Marker] hub routing', message.type, '→ tab', tab.id);
	try {
		const result = await chrome.tabs.sendMessage(tab.id, message);
		if (message.type === 'highlight' && result?.ok) flashBadge(String(result.count));
		return result;
	} catch {
		return {
			ok: false,
			error: 'No content script there. Reload the tab — and chrome:// pages never get one.'
		};
	}
}

function flashBadge(text) {
	chrome.action.setBadgeBackgroundColor({ color: '#fb5b1a' });
	chrome.action.setBadgeText({ text });
	setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

// --- Step 5: the relay. 'page-stream' ports come from content scripts,
// 'popup-stream' ports from open popups. The hub forwards every page event
// to every listening popup.
const popupPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
	if (port.name === 'popup-stream') {
		// A popup-stream port must come from one of OUR pages, never from a tab.
		if (port.sender?.id !== chrome.runtime.id || port.sender.tab) {
			port.disconnect();
			return;
		}
		popupPorts.add(port);
		port.onDisconnect.addListener(() => popupPorts.delete(port));
		return;
	}
	if (port.name === 'page-stream') {
		// A page-stream port must come from a content script of THIS extension.
		if (!port.sender?.tab || port.sender.id !== chrome.runtime.id) {
			port.disconnect();
			return;
		}
		port.onMessage.addListener((message) => {
			for (const popupPort of popupPorts) {
				try {
					popupPort.postMessage(message);
				} catch {
					popupPorts.delete(popupPort);
				}
			}
		});
	}
});
