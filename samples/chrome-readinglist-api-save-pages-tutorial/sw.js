// Park It — service worker. Owns every write-through of a save,
// so the query-then-add logic exists exactly once.

const BADGE_MS = 1200;

/**
 * Save a URL into Chrome's Reading List.
 * Entries are keyed by URL and adding an existing one fails,
 * so: query first, then add or update. Returns a status object.
 */
async function saveEntry(url, title) {
	if (!url || !/^https?:/i.test(url)) {
		return { ok: false, message: 'Chrome only saves ordinary web pages' };
	}
	try {
		const existing = await chrome.readingList.query({ url });
		if (existing.length > 0) {
			await chrome.readingList.updateEntry({ url, title });
			return { ok: true, message: 'Already parked — title refreshed' };
		}
		await chrome.readingList.addEntry({ url, title, hasBeenRead: false });
		return { ok: true, message: 'Parked in your Reading List' };
	} catch (e) {
		return { ok: false, message: e.message || 'Could not save this page' };
	}
}

// Context-menu saves happen with no UI open, so the badge is the receipt.
function flashBadge(ok) {
	chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e7d32' : '#c62828' });
	chrome.action.setBadgeText({ text: ok ? '✓' : '✕' });
	setTimeout(() => chrome.action.setBadgeText({ text: '' }), BADGE_MS);
}

// The popup's Save button delegates here — same function, same badge.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type !== 'save') return;
	saveEntry(message.url, message.title).then((result) => {
		flashBadge(result.ok);
		sendResponse(result);
	});
	return true; // the channel must stay open for the async response
});

// Two right-click items: the page you're on, or a link you haven't opened.
chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: 'park-page',
		title: 'Park this page in your Reading List',
		contexts: ['page']
	});
	chrome.contextMenus.create({
		id: 'park-link',
		title: 'Park this link in your Reading List',
		contexts: ['link']
	});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	const isLink = info.menuItemId === 'park-link';
	const url = isLink ? info.linkUrl : info.pageUrl;
	const title = isLink ? info.linkUrl : tab?.title || info.pageUrl;
	const result = await saveEntry(url, title);
	flashBadge(result.ok);
});
