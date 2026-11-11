const form = document.getElementById('marker-form');
const wordInput = document.getElementById('word');
const statusEl = document.getElementById('status');
const clearButton = document.getElementById('clear');

async function send(command) {
	try {
		const result = await chrome.runtime.sendMessage(command);
		if (result?.ok) return result;
		return {
			ok: false,
			error: result?.error ?? 'The service worker did not answer — reload the extension.'
		};
	} catch (error) {
		return { ok: false, error: error.message };
	}
}

form.addEventListener('submit', async (event) => {
	event.preventDefault();
	const word = wordInput.value.trim();
	if (!word) return;
	statusEl.textContent = 'Highlighting…';
	const result = await send({ type: 'highlight', word });
	statusEl.textContent = result.ok ? `Marked ${result.count} × “${word}”.` : result.error;
});

clearButton.addEventListener('click', async () => {
	const result = await send({ type: 'clear' });
	statusEl.textContent = result.ok ? `Cleared ${result.cleared} highlight(s).` : result.error;
});

// --- Step 5: the other end of the stream. While this popup is open, its
// port receives whatever the page reports. Closing the popup disconnects
// the port — and the hub's onDisconnect drops it from the relay list.
const liveSection = document.getElementById('live');
const feedEl = document.getElementById('feed');

function openStream() {
	const stream = chrome.runtime.connect({ name: 'popup-stream' });
	stream.onMessage.addListener((message) => {
		if (message?.type !== 'selection') return;
		liveSection.hidden = false;
		const item = document.createElement('li');
		// Page text is untrusted input — textContent only, never innerHTML.
		item.append(document.createTextNode(message.text));
		feedEl.prepend(item);
		while (feedEl.children.length > 6) feedEl.lastElementChild.remove();
	});
	stream.onDisconnect.addListener(() => {
		// The worker went to sleep and took the port with it. Reconnecting wakes
		// it up — acceptable while someone is watching, and it ends with the popup.
		setTimeout(openStream, 500);
	});
}

openStream();
