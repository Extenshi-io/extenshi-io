const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? "unknown";
const yesNo = (value) => (value ? "yes" : "no");

document.getElementById("support").textContent =
  `Chrome ${chromeVersion} · onEnabled: ${yesNo(chrome.runtime.onEnabled)}` +
  ` · onExtensionLoaded: ${yesNo(chrome.runtime.onExtensionLoaded)}`;

function describe(entry) {
  const reason = entry.reason ? ` (${entry.reason})` : "";
  const from = entry.previousVersion ? ` from ${entry.previousVersion}` : "";
  return `${entry.event}${reason}${from}`;
}

async function render() {
  const { log = [] } = await chrome.storage.local.get("log");
  const list = document.getElementById("log");
  list.replaceChildren(
    ...log.toReversed().map((entry) => {
      const item = document.createElement("li");
      if (entry.event === "worker-start") item.className = "quiet";
      if (entry.event === "bringUp") item.className = "pattern";
      const time = document.createElement("time");
      time.textContent = new Date(entry.at).toLocaleTimeString();
      const name = document.createElement("code");
      name.textContent = describe(entry);
      item.append(time, name);
      return item;
    })
  );
}

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.set({ log: [] });
  await chrome.action.setBadgeText({ text: "" });
  render();
});

chrome.storage.onChanged.addListener(render);
render();
