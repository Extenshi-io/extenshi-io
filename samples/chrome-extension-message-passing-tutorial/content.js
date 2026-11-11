// Marker — content script. Sees the page, holds almost no privileges.
// It answers commands from the extension; it never initiates privileged work.

function highlightWord(word) {
	const needle = word.trim().toLowerCase();
	if (!needle) return 0;

	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const el = node.parentElement;
			if (!el || el.closest('script, style, textarea, mark[data-marker]')) {
				return NodeFilter.FILTER_REJECT;
			}
			return node.nodeValue.toLowerCase().includes(needle)
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_REJECT;
		}
	});

	const nodes = [];
	while (walker.nextNode()) nodes.push(walker.currentNode);

	let count = 0;
	for (const node of nodes) {
		const text = node.nodeValue;
		const lower = text.toLowerCase();
		// Rare Unicode case folding changes string length and shifts offsets — skip those nodes.
		if (lower.length !== text.length) continue;
		// Wrap matches from the end backwards: each split keeps earlier offsets valid.
		let start = lower.lastIndexOf(needle);
		while (start !== -1) {
			const range = document.createRange();
			range.setStart(node, start);
			range.setEnd(node, start + needle.length);
			const mark = document.createElement('mark');
			mark.dataset.marker = 'hit';
			range.surroundContents(mark);
			count += 1;
			const nextFrom = start - needle.length;
			start = nextFrom >= 0 ? lower.lastIndexOf(needle, nextFrom) : -1;
		}
	}
	return count;
}

function clearHighlights() {
	const marks = document.querySelectorAll('mark[data-marker="hit"]');
	for (const mark of marks) {
		const parent = mark.parentNode;
		while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
		mark.remove();
		parent.normalize();
	}
	return marks.length;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	// Accept commands from our own extension only — never from the page.
	if (sender.id !== chrome.runtime.id) return;
	console.log('[Marker] content script got:', message?.type);

	if (message?.type === 'highlight') {
		sendResponse({ ok: true, count: highlightWord(String(message.word ?? '')) });
	} else if (message?.type === 'clear') {
		sendResponse({ ok: true, cleared: clearHighlights() });
	}
	// Both answers are ready synchronously, so no `return true` is needed here.
});

// --- Step 5: the stream. A long-lived port pushes page events to the hub.
// One connection, many small messages — the case where a port beats a
// sendMessage round trip.
let hubPort = null;

function connectHub() {
	hubPort = chrome.runtime.connect({ name: 'page-stream' });
	hubPort.onDisconnect.addListener(() => {
		hubPort = null; // the worker restarted or the extension reloaded
	});
}

document.addEventListener('mouseup', () => {
	const selected = window.getSelection()?.toString().trim();
	if (!selected) return;
	if (!hubPort) connectHub(); // reconnect lazily — only when there is something to say
	hubPort.postMessage({
		type: 'selection',
		text: selected.slice(0, 120),
		url: location.href
	});
});
