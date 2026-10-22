// Every listener sits at the top level: Chrome only delivers a lifecycle event
// to a worker that registered for it during its first synchronous run.

const LOG_KEY = "log";
const MAX_ENTRIES = 200;

const version = chrome.runtime.getManifest().version;
// The user-agent string is reduced to the major version ("158.0.0.0").
const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? "unknown";

// One wake can carry several events (an install fires onInstalled and, on
// Chrome 157+, onExtensionLoaded). Chain the writes so none overwrites another.
let writes = Promise.resolve();

function record(event, details = {}) {
  const entry = { event, ...details, version, chromeVersion, at: Date.now() };
  writes = writes.then(async () => {
    const { [LOG_KEY]: log = [] } = await chrome.storage.local.get(LOG_KEY);
    log.push(entry);
    await chrome.storage.local.set({ [LOG_KEY]: log.slice(-MAX_ENTRIES) });
    const events = log.filter((e) => e.event !== "worker-start");
    await chrome.action.setBadgeText({ text: String(events.length) });
  });
  return writes;
}

// 1. The raw events, each logged on its own, so you can see which ones fire.

chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) =>
  record("onInstalled", { reason, previousVersion })
);
chrome.runtime.onStartup.addListener(() => record("onStartup"));

// Chrome 155+. Undefined on older Chrome, Firefox and Safari.
chrome.runtime.onEnabled?.addListener(() => record("onEnabled"));

// Landed for Chrome 157.
chrome.runtime.onExtensionLoaded?.addListener(({ reason, previousVersion }) =>
  record("onExtensionLoaded", { reason, previousVersion })
);

// 2. The pattern your own extension should use: prefer onExtensionLoaded,
// fall back to the older trio, never both. bringUp() should run exactly once
// per wake; the log shows whether it does.

function bringUp(reason) {
  return record("bringUp", { reason });
}

if (chrome.runtime.onExtensionLoaded) {
  chrome.runtime.onExtensionLoaded.addListener(({ reason }) => bringUp(reason));
} else {
  chrome.runtime.onInstalled.addListener(({ reason }) => bringUp(reason));
  chrome.runtime.onStartup.addListener(() => bringUp("startup"));
  chrome.runtime.onEnabled?.addListener(() => bringUp("enable"));
}

// Not a lifecycle event: the worker also starts for ordinary reasons (the
// popup opening, a wake after idle). Logged so a silent re-enable — a worker
// start with no event next to it — is visible on Chrome before 155.
record("worker-start", {
  has: {
    onEnabled: Boolean(chrome.runtime.onEnabled),
    onExtensionLoaded: Boolean(chrome.runtime.onExtensionLoaded)
  }
});
