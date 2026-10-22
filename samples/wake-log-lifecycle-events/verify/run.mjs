#!/usr/bin/env node
/**
 * run.mjs — drive the Wake Log extension through every lifecycle transition in
 * a real Chrome and record which events actually fired.
 *
 * WHY THIS EXISTS: release notes and commits say what a Chrome version is
 * supposed to do. This loads the extension and watches: the same scenarios,
 * one run per Chrome version, so a claim like "onEnabled fires on re-enable
 * from Chrome 155" is checked against a browser rather than a changelog.
 *
 * SCENARIOS (in order, one profile per channel)
 *   install          load the extension into a fresh profile
 *   toggle           switch off and back on with the chrome://extensions toggle
 *   reload           the Reload button on the card, same version on disk
 *   runtime.reload   the extension calls chrome.runtime.reload() on itself
 *   restart          quit and relaunch the browser on the same profile (without
 *                    --load-extension: the flag would re-add it as an update)
 *   update           bump the version on disk, then Reload
 *   update-disabled  switch off, bump the version, Reload, switch on
 *                    (an unpacked stand-in for a store update while disabled)
 *
 * USAGE
 *   node verify/run.mjs --chrome "<path to Chrome for Testing binary>" [--headful]
 *   node verify/run.mjs --milestone 157     # newest 157.x build in ~/.cache/puppeteer
 *   node verify/run.mjs --milestone 157 --screenshot popup.png
 *
 *   Writes verify/results/<chrome version>.json. Install a channel's build with
 *   `npx @puppeteer/browsers install chrome@beta --path ~/.cache/puppeteer`.
 *
 * REQUIREMENTS
 *   Node 22+ (global WebSocket). No npm dependencies. Chrome for Testing:
 *   branded Chrome ignores --load-extension, CfT still honors it.
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The extension is the sample folder itself, minus this verify/ folder and docs.
const SOURCE_DIR = path.join(__dirname, "..");
const NOT_EXTENSION = new Set(["verify", "README.md", "screenshot.webp"]);
const RESULTS_DIR = path.join(__dirname, "results");
const EXTENSION_NAME = "Wake Log";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const headful = argv.includes("--headful");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (opt("--chrome")) return opt("--chrome");
  // The puppeteer cache is keyed by platform and version, not channel
  // (`mac_arm-157.0.8103.6`): pick the newest build of the requested
  // milestone for this host.
  const milestone = opt("--milestone");
  if (!milestone) throw new Error("pass --chrome <binary> or --milestone <N>");
  const host = CFT_PLATFORMS[`${process.platform}-${process.arch}`];
  if (!host)
    throw new Error(
      `no Chrome for Testing build for ${process.platform}-${process.arch}; pass --chrome`
    );
  const cache = path.join(os.homedir(), ".cache/puppeteer/chrome");
  const build = fs
    .readdirSync(cache)
    .map((d) => ({ dir: d, platform: d.split("-")[0], version: d.split("-").pop() }))
    .filter((b) => b.platform === host.cacheDir && b.version.startsWith(`${milestone}.`))
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    .at(-1);
  if (!build) throw new Error(`no Chrome ${milestone} for ${host.cacheDir} in ${cache}`);
  return path.join(cache, build.dir, host.executable);
}

// Host → puppeteer cache directory prefix and the executable inside a build.
const CFT_APP = "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const CFT_PLATFORMS = {
  "darwin-arm64": { cacheDir: "mac_arm", executable: `chrome-mac-arm64/${CFT_APP}` },
  "darwin-x64": { cacheDir: "mac", executable: `chrome-mac-x64/${CFT_APP}` },
  "linux-x64": { cacheDir: "linux", executable: "chrome-linux64/chrome" },
  "win32-x64": { cacheDir: "win64", executable: "chrome-win64/chrome.exe" }
};

// --- minimal CDP client -------------------------------------------------------

class Browser {
  static async launch(chromePath, userDataDir, extensionDir) {
    fs.rmSync(path.join(userDataDir, "DevToolsActivePort"), { force: true });
    const proc = spawn(
      chromePath,
      [
        `--user-data-dir=${userDataDir}`,
        ...(extensionDir ? [`--load-extension=${extensionDir}`] : []),
        "--remote-debugging-port=0",
        "--no-first-run",
        "--no-default-browser-check",
        ...(headful ? [] : ["--headless"]),
        "about:blank"
      ],
      { stdio: "ignore" }
    );
    const portFile = path.join(userDataDir, "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
    const [port, wsPath] = fs.readFileSync(portFile, "utf8").trim().split("\n");
    const browser = new Browser(proc, new WebSocket(`ws://127.0.0.1:${port}${wsPath}`));
    await new Promise((resolve, reject) => {
      browser.ws.onopen = resolve;
      browser.ws.onerror = reject;
    });
    return browser;
  }

  constructor(proc, ws) {
    this.proc = proc;
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${waiter.method}: ${msg.error.message}`));
      else waiter.resolve(msg.result);
    };
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  async open(url) {
    const { targetId } = await this.send("Target.createTarget", { url });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = {
      eval: async (expression) => {
        const { result, exceptionDetails } = await this.send(
          "Runtime.evaluate",
          { expression, awaitPromise: true, returnByValue: true },
          sessionId
        );
        if (exceptionDetails) {
          throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
        }
        return result.value;
      },
      send: (method, params) => this.send(method, params, sessionId),
      close: () => this.send("Target.closeTarget", { targetId })
    };
    for (let i = 0; i < 50; i++) {
      if (await page.eval('document.readyState === "complete"').catch(() => false)) break;
      await sleep(100);
    }
    return page;
  }

  async close() {
    const exited = new Promise((r) => this.proc.once("exit", r));
    await this.send("Browser.close").catch(() => {});
    await exited;
  }
}

// --- what the scenarios do ----------------------------------------------------

// The chrome://extensions page holds chrome.management and
// chrome.developerPrivate, so it drives the same code paths a user's clicks do.
async function extensionsPage(browser) {
  const page = await browser.open("chrome://extensions");
  for (let i = 0; i < 50; i++) {
    const ready = await page.eval(
      `chrome.management.getAll().then((all) => all.some((e) => e.name === ${JSON.stringify(EXTENSION_NAME)}))`
    );
    if (ready) break;
    await sleep(200);
  }
  return page;
}

async function extensionId(page) {
  return page.eval(
    `chrome.management.getAll().then((all) => all.find((e) => e.name === ${JSON.stringify(EXTENSION_NAME)}).id)`
  );
}

async function isEnabled(page, id) {
  return page.eval(`chrome.management.get(${JSON.stringify(id)}).then((e) => e.enabled)`);
}

// Click the real toggle on the extension's card. If the page's shadow DOM ever
// moves, fail loudly instead of quietly falling back to management.setEnabled.
async function clickToggle(page, id) {
  const before = await isEnabled(page, id);
  await page.eval(`(() => {
		const list = document.querySelector('extensions-manager').shadowRoot
			.querySelector('extensions-item-list').shadowRoot;
		const toggle = list.querySelector('extensions-item#${id}').shadowRoot.querySelector('#enableToggle');
		if (!toggle) throw new Error('enable toggle not found');
		toggle.click();
	})()`);
  for (let i = 0; i < 50 && (await isEnabled(page, id)) === before; i++) await sleep(100);
  if ((await isEnabled(page, id)) === before) throw new Error("toggle click did not change state");
}

// A fresh profile has Developer mode off, and reloading an unpacked extension
// there disables it (disableReasons.unsupportedDeveloperExtension) — nothing a
// developer clicking Reload would ever see. Switch it on, as they would have.
async function enableDeveloperMode(page) {
  await page.eval("chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })");
}

async function reload(page, id) {
  await page.eval(`chrome.developerPrivate.reload(${JSON.stringify(id)}, { failQuietly: true })`);
}

// The log lives in the extension's storage; read it from one of its own pages.
// Right after a reload the page can open while the extension is still coming
// back, with no chrome.storage yet — retry instead of reading an empty log.
async function readLog(browser, id) {
  for (let attempt = 1; ; attempt++) {
    const page = await browser.open(`chrome-extension://${id}/popup.html`);
    try {
      return await page.eval('chrome.storage.local.get("log").then(({ log = [] }) => log)');
    } catch (e) {
      if (attempt === 10) {
        const where = await page.eval("`${location.href} — ${document.title}`").catch(() => "?");
        throw new Error(`cannot read the log from ${where}: ${e.message}`);
      }
      await sleep(500);
    } finally {
      await page.close().catch(() => {});
    }
  }
}

// Lifecycle events arrive asynchronously after the worker starts; wait until
// the log stops growing.
async function settledLog(browser, id) {
  let log = await readLog(browser, id);
  for (let quiet = 0; quiet < 3; ) {
    await sleep(700);
    const next = await readLog(browser, id);
    quiet = next.length === log.length ? quiet + 1 : 0;
    log = next;
  }
  return log;
}

// --- run ----------------------------------------------------------------------

const chromePath = findChrome();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "wake-log-"));
const userDataDir = path.join(work, "profile");
const extensionDir = path.join(work, "extension");
fs.cpSync(SOURCE_DIR, extensionDir, {
  recursive: true,
  filter: (src) => !NOT_EXTENSION.has(path.relative(SOURCE_DIR, src).split(path.sep)[0])
});

const scenarios = [];
let seen = 0;
function capture(name, log, notes = {}) {
  const entries = log.slice(seen);
  seen = log.length;
  scenarios.push({ name, ...notes, entries });
  const shown = entries
    .filter((e) => e.event !== "worker-start")
    .map(
      (e) =>
        `${e.event}${e.reason ? `(${e.reason})` : ""}${e.previousVersion ? `<-${e.previousVersion}` : ""}`
    );
  console.log(`  ${name.padEnd(16)} ${shown.join(", ") || "(nothing)"}`);
}

let browser = await Browser.launch(chromePath, userDataDir, extensionDir);
let page = await extensionsPage(browser);
const id = await extensionId(page);
await enableDeveloperMode(page);
const { product } = await browser.send("Browser.getVersion");
console.log(`${product} — extension ${id}`);

capture("install", await settledLog(browser, id));

await clickToggle(page, id);
await sleep(1000);
await clickToggle(page, id);
capture("toggle", await settledLog(browser, id));

await reload(page, id);
await sleep(1000);
capture("reload", await settledLog(browser, id));

const self = await browser.open(`chrome-extension://${id}/popup.html`);
await self.eval("setTimeout(() => chrome.runtime.reload(), 0), true");
await sleep(1500);
capture("runtime.reload", await settledLog(browser, id));

await page.close();
await browser.close();
browser = await Browser.launch(chromePath, userDataDir);
page = await extensionsPage(browser);
capture("restart", await settledLog(browser, id));

const manifestPath = path.join(extensionDir, "manifest.json");
function bumpVersion(version) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
const installedVersion = () =>
  page.eval(`chrome.management.get(${JSON.stringify(id)}).then((e) => e.version)`);

bumpVersion("1.1");
await reload(page, id);
await sleep(1000);
capture("update", await settledLog(browser, id));

await clickToggle(page, id);
bumpVersion("1.2");
await reload(page, id);
await sleep(1500);
const whileDisabled = { enabled: await isEnabled(page, id), version: await installedVersion() };
if (!whileDisabled.enabled) await clickToggle(page, id);
capture("update-disabled", await settledLog(browser, id), { whileDisabled });

// The popup after the whole run, at popup size: the picture in the README.
if (opt("--screenshot")) {
  const popup = await browser.open(`chrome-extension://${id}/popup.html`);
  await popup.send("Emulation.setDeviceMetricsOverride", {
    width: 384,
    height: 560,
    deviceScaleFactor: 2,
    mobile: false
  });
  await sleep(300);
  const { data } = await popup.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(opt("--screenshot"), Buffer.from(data, "base64"));
  await popup.close();
}

await page.close();
await browser.close();
fs.rmSync(work, { recursive: true, force: true });

const chromeVersion = product.split("/")[1];
fs.mkdirSync(RESULTS_DIR, { recursive: true });
const out = path.join(RESULTS_DIR, `${chromeVersion}.json`);
fs.writeFileSync(
  out,
  `${JSON.stringify({ chromeVersion, ranAt: new Date().toISOString(), headless: !headful, scenarios }, null, 2)}\n`
);
console.log(`→ ${path.relative(process.cwd(), out)}`);
