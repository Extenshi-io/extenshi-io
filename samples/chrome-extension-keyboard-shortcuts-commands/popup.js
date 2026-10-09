// getAll() returns an empty description for the reserved _execute_action,
// so it needs a label of its own. Custom commands use their manifest text.
const NAMES = {
	_execute_action: 'Open this popup'
};

const listEl = document.getElementById('command-list');

async function init() {
	const commands = await chrome.commands.getAll();
	for (const cmd of commands) {
		const row = document.createElement('li');

		const label = document.createElement('span');
		label.textContent = cmd.description || NAMES[cmd.name] || cmd.name;

		const key = document.createElement('kbd');
		key.textContent = cmd.shortcut || 'not set';
		if (!cmd.shortcut) key.classList.add('missing');

		row.append(label, key);
		listEl.append(row);
	}

	// The "!" badge did its job the moment this popup explained the situation.
	chrome.action.setBadgeText({ text: '' });
}

document.getElementById('rebind').addEventListener('click', () => {
	// chrome:// URLs can't be opened by a plain link from an extension page,
	// but tabs.create() may navigate to them — no permission needed.
	chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

init();
