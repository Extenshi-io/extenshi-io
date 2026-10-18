// With default_popup set, chrome.action.onClicked no longer fires — that IS
// the lesson of this step. So the popup is a control surface: it shows the
// count and hands the toolbar button back to click mode.

const countEl = document.getElementById('count');
const clickModeBtn = document.getElementById('click-mode');

async function activeTabId() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return typeof tab?.id === 'number' ? tab.id : null;
}

async function init() {
	const tabId = await activeTabId();
	if (tabId === null) {
		countEl.textContent = 'Open this on a normal tab.';
		return;
	}
	const { counts = {} } = await chrome.storage.session.get('counts');
	const n = counts[tabId] || 0;
	countEl.textContent = n === 0
		? 'No taps on this tab yet.'
		: `${n} tap${n === 1 ? '' : 's'} on this tab.`;
}

clickModeBtn.addEventListener('click', async () => {
	// Clearing the popup re-enables chrome.action.onClicked everywhere.
	// Runtime setPopup overrides the manifest until the extension reloads.
	await chrome.action.setPopup({ popup: '' });
	window.close();
});

init();
