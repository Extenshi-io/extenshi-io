// Bookmark Janitor — popup logic.
// Every bookmark lives in `allBookmarks` as a flat record:
// { id, title, url, dateAdded, unmodifiable, synced, folder }

const searchInput = document.getElementById('search');
const resultsList = document.getElementById('results');
const statusLine = document.getElementById('status');
const dedupeButton = document.getElementById('dedupe');
const planPanel = document.getElementById('plan');
const planList = document.getElementById('plan-list');
const removeButton = document.getElementById('remove-selected');

let allBookmarks = [];

init();

async function init() {
	await reindex();
	renderResults(allBookmarks.slice(0, 20));
}

async function reindex() {
	const [root] = await chrome.bookmarks.getTree();
	const top = root.children ?? [];
	// Signed-in Chrome can hold a synced AND a local-only copy of each
	// permanent folder. Only when it does, label which copy is which.
	const types = top.map((f) => f.folderType).filter(Boolean);
	const dual = new Set(types).size < types.length;
	allBookmarks = [];
	for (const folder of top) {
		const name = dual ? `${folder.title} (${folder.syncing ? 'account' : 'this device'})` : folder.title;
		flatten(folder.children ?? [], [name], allBookmarks);
	}
	statusLine.textContent = `${allBookmarks.length} bookmarks indexed`;
}

// One walk turns a subtree into flat records. `path` holds the folder
// titles above the current level.
function flatten(nodes, path, out) {
	for (const node of nodes) {
		// Firefox reports separators with the URL "data:" — skip them.
		if (node.url && node.type !== 'separator') {
			out.push({
				id: node.id,
				title: node.title,
				url: node.url,
				dateAdded: node.dateAdded ?? 0,
				unmodifiable: node.unmodifiable,
				synced: node.syncing === true,
				folder: path.join(' / ')
			});
		}
		if (node.children) {
			flatten(node.children, [...path, node.title], out);
		}
	}
	return out;
}

// --- search --------------------------------------------------------------

searchInput.addEventListener('input', () => {
	const q = searchInput.value.trim().toLowerCase();
	if (!q) {
		renderResults(allBookmarks.slice(0, 20));
		return;
	}
	const matches = allBookmarks.filter(
		(b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
	);
	renderResults(matches.slice(0, 50));
});

// Bookmark titles are untrusted strings — everything is built with
// textContent/createElement, never innerHTML, so a bookmark titled
// `<img src=x onerror=...>` stays inert text.
function renderResults(bookmarks) {
	planPanel.hidden = true;
	resultsList.textContent = '';
	if (bookmarks.length === 0) {
		const empty = document.createElement('li');
		empty.className = 'empty';
		empty.textContent = 'No matches.';
		resultsList.appendChild(empty);
		return;
	}
	for (const b of bookmarks) {
		resultsList.appendChild(renderRow(b));
	}
}

function renderRow(b) {
	const li = document.createElement('li');

	const open = document.createElement('a');
	open.href = b.url;
	open.textContent = b.title || b.url;
	open.addEventListener('click', (e) => {
		e.preventDefault();
		// No "tabs" permission needed. Chrome refuses some URLs (javascript:
		// bookmarklets, for one), so report that instead of failing silently.
		chrome.tabs.create({ url: b.url }).catch((err) => {
			statusLine.textContent = `Can't open this one: ${err.message}`;
		});
	});

	const folder = document.createElement('span');
	folder.className = 'folder';
	folder.textContent = b.folder || '(root)';

	li.append(open, folder);
	return li;
}

// --- de-duplication ------------------------------------------------------

// Two URLs are "the same page" if they match after lowercasing the host,
// dropping the fragment and one trailing slash. Anything unparseable
// compares verbatim.
function normalizeUrl(raw) {
	try {
		const u = new URL(raw);
		u.hostname = u.hostname.toLowerCase();
		u.hash = '';
		let key = u.toString();
		if (key.endsWith('/')) key = key.slice(0, -1);
		return key;
	} catch {
		return raw;
	}
}

dedupeButton.addEventListener('click', () => {
	const groups = new Map();
	for (const b of allBookmarks) {
		const key = normalizeUrl(b.url);
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(b);
	}
	const plans = [...groups.values()]
		.filter((g) => g.length > 1)
		// Keeper first: a synced copy beats a local-only one, then the oldest wins.
		.map((g) => g.sort((a, b) => b.synced - a.synced || a.dateAdded - b.dateAdded));
	renderPlan(plans);
});

function renderPlan(plans) {
	planList.textContent = '';
	resultsList.textContent = '';
	if (plans.length === 0) {
		const clean = document.createElement('li');
		clean.className = 'empty';
		clean.textContent = 'No duplicates found. Nothing to do.';
		planList.appendChild(clean);
		updateRemoveCount();
		planPanel.hidden = false;
		return;
	}
	for (const group of plans) {
		const [keeper, ...extras] = group;

		const keepRow = document.createElement('li');
		keepRow.className = 'keeper';
		keepRow.append(document.createTextNode(`keep · ${keeper.title || keeper.url}`));
		const keepWhere = document.createElement('span');
		keepWhere.className = 'folder';
		keepWhere.textContent = keeper.folder || '(root)';
		keepRow.appendChild(keepWhere);
		planList.appendChild(keepRow);

		for (const dup of extras) {
			const row = document.createElement('li');
			const label = document.createElement('label');
			const box = document.createElement('input');
			box.type = 'checkbox';
			box.className = 'dup-remove';
			box.dataset.id = dup.id;
			box.dataset.keeper = keeper.id;
			box.checked = !dup.unmodifiable;
			box.disabled = Boolean(dup.unmodifiable); // managed nodes can't be removed
			label.append(box, document.createTextNode(`remove · ${dup.title || dup.url}`));
			const where = document.createElement('span');
			where.className = 'folder';
			where.textContent = dup.folder || '(root)';
			row.append(label, where);
			planList.appendChild(row);
		}
	}
	updateRemoveCount();
	planPanel.hidden = false;
}

// The button always states what it will do, and is disabled when that is nothing.
function updateRemoveCount() {
	const n = planList.querySelectorAll('.dup-remove:checked').length;
	removeButton.textContent = `Remove ${n} selected`;
	removeButton.disabled = n === 0;
}

planList.addEventListener('change', updateRemoveCount);

removeButton.addEventListener('click', async () => {
	const boxes = [...planList.querySelectorAll('.dup-remove:checked')];
	removeButton.disabled = true;
	let removed = 0;
	let skipped = 0;
	for (const box of boxes) {
		try {
			// Re-read the copy and its keeper right before deleting: sync or
			// another window may have changed the tree since the preview.
			const [[copy], [keeper]] = await Promise.all([
				chrome.bookmarks.get(box.dataset.id),
				chrome.bookmarks.get(box.dataset.keeper)
			]);
			if (!copy.url || copy.unmodifiable || normalizeUrl(copy.url) !== normalizeUrl(keeper.url ?? '')) {
				skipped++;
				continue;
			}
			await chrome.bookmarks.remove(copy.id);
			removed++;
		} catch {
			skipped++; // get() rejects: the copy or its keeper is gone
		}
	}
	await reindex();
	renderResults(allBookmarks.slice(0, 20));
	statusLine.textContent =
		`${allBookmarks.length} bookmarks indexed · removed ${removed}` +
		(skipped ? `, skipped ${skipped}` : '');
});
