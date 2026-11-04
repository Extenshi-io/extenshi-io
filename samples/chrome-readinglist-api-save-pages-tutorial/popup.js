const saveButton = document.getElementById('save');
const statusEl = document.getElementById('status');
const listEl = document.getElementById('entries');
const emptyEl = document.getElementById('empty');

function showStatus(message, isError = false) {
	statusEl.textContent = message;
	statusEl.classList.toggle('error', isError);
	statusEl.hidden = false;
}

async function render() {
	const entries = await chrome.readingList.query({});
	// query() promises no order — "newest first" is ours to enforce.
	entries.sort((a, b) => b.creationTime - a.creationTime);

	listEl.replaceChildren();
	emptyEl.hidden = entries.length > 0;

	for (const entry of entries) {
		const li = document.createElement('li');
		if (entry.hasBeenRead) li.classList.add('read');

		const a = document.createElement('a');
		a.href = entry.url;
		a.target = '_blank'; // open in a real tab, not inside the popup
		a.rel = 'noopener';
		a.textContent = entry.title; // titles are untrusted input — never innerHTML
		a.title = entry.url;

		const readButton = document.createElement('button');
		readButton.textContent = entry.hasBeenRead ? 'Unread' : 'Read';
		readButton.addEventListener('click', () => {
			chrome.readingList.updateEntry({
				url: entry.url,
				hasBeenRead: !entry.hasBeenRead
			});
		});

		const removeButton = document.createElement('button');
		removeButton.textContent = '✕';
		removeButton.addEventListener('click', () => {
			chrome.readingList.removeEntry({ url: entry.url });
		});

		li.append(a, readButton, removeButton);
		listEl.append(li);
	}
}

saveButton.addEventListener('click', async () => {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.url) {
		showStatus('Chrome hides this page from extensions — nothing to park.', true);
		return;
	}
	const result = await chrome.runtime.sendMessage({
		type: 'save',
		url: tab.url,
		title: tab.title
	});
	showStatus(
		result?.message ?? 'The background worker did not answer — reload the extension.',
		!result?.ok
	);
});

// Every write fires one of these: our own Read/✕ clicks, a save from the
// worker, sync from another device. Re-rendering on all three keeps the
// list honest without any bookkeeping of our own.
chrome.readingList.onEntryAdded.addListener(render);
chrome.readingList.onEntryUpdated.addListener(render);
chrome.readingList.onEntryRemoved.addListener(render);

render();
