// The badge shows the note's character count while the synced "badge"
// setting is on. Both halves live in storage, never in variables: this
// worker is killed after ~30s idle and reborn with zero memory.

// Registration is synchronous and top-level — before any await — so Chrome
// can route the very first event to a freshly spawned worker.
chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === 'local' && changes.note) {
		updateBadge(changes.note.newValue ?? ''); // remove() has no newValue
	}
	if (areaName === 'sync' && changes.badge) {
		chrome.storage.local.get('note').then(({ note = '' }) => updateBadge(note));
	}
});

function compactCount(n) {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

async function updateBadge(note) {
	const { badge } = await chrome.storage.sync.get({ badge: true });
	const text = badge && note.length > 0 ? compactCount(note.length) : '';
	await chrome.action.setBadgeText({ text });
	await chrome.action.setBadgeBackgroundColor({ color: '#FB5B1A' });
}

// Cold start (install, browser launch, worker revival): restore the badge
// from storage, because the worker's own memory did not survive.
chrome.storage.local.get('note').then(({ note = '' }) => updateBadge(note));
