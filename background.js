// background.js (MV3 service worker)

// Storage keys
const STORAGE_KEYS = {
  WHITELIST: "slotscope_whitelist",
  BLACKLIST: "slotscope_blacklist",
  SUPPRESS_UNTIL: "slotscope_suppress_until"
};

// Providers / patterns for quick detection & routing
const SLOT_PROVIDER_DOMAINS = [
  "pragmaticplay",
  "netent",
  "playngo",
  "evolution",
  "relaxgaming",
  "nolimitcity"
];

const GAME_URL_PATTERNS = [
  "/games/",
  "/slot/",
  "/casino/game/",
  "/game/launch",
  "/html5-game/"
];

// In-memory config for webRequest interception
let interceptionEnabledPerOrigin = new Set();

// Utility: storage wrappers
async function getStorage(key) {
  return new Promise(resolve => {
    chrome.storage.sync.get(key, items => resolve(items[key]));
  });
}

async function setStorage(obj) {
  return new Promise(resolve => {
    chrome.storage.sync.set(obj, () => resolve());
  });
}

// Domain helpers
function getRootDomainFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    return parts.slice(-2).join(".");
  } catch (e) {
    return null;
  }
}

// Checks if now < suppress until
async function isSuppressed() {
  const until = await getStorage(STORAGE_KEYS.SUPPRESS_UNTIL);
  if (!until) return false;
  const now = Date.now();
  return now < until;
}

// Notification + user choice flow
async function handleSlotIframeDetected(tabId, iframeInfo) {
  if (await isSuppressed()) return;

  const { src } = iframeInfo;
  const iframeDomain = getRootDomainFromUrl(src);
  if (!iframeDomain) return;

  const [whitelist, blacklist] = await Promise.all([
    getStorage(STORAGE_KEYS.WHITELIST),
    getStorage(STORAGE_KEYS.BLACKLIST)
  ]);

  const wl = whitelist || [];
  const bl = blacklist || [];

  if (bl.includes(iframeDomain)) return;
  if (wl.includes(iframeDomain)) {
    // Directly tell content script to enable inspector
    chrome.tabs.sendMessage(tabId, {
      type: "SLOTSCOPE_ENABLE_INSPECTOR",
      iframeInfo
    }).catch(() => {});
    return;
  }

  const notifId = `slotscope_iframe_${tabId}_${Date.now()}`;

  chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: "icons/128.png",
    title: "SlotScope – Possible Slot Game Detected",
    message: `SlotScope detected a possible slot game iframe on this page (${iframeDomain}).\nDo you own this domain and want to inspect backend settings (RTP, volatility, config, hotness score)?`,
    priority: 2,
    requireInteraction: true,
    buttons: [
      { title: "Yes, I own it – Enable Inspector" },
      { title: "No, ignore this site" }
    ]
  });

  // Track extra state
  chrome.notifications.onButtonClicked.addListener(async (clickedId, buttonIndex) => {
    if (clickedId !== notifId) return;
    if (buttonIndex === 0) {
      // Yes – whitelist + enable
      const current = (await getStorage(STORAGE_KEYS.WHITELIST)) || [];
      if (!current.includes(iframeDomain)) {
        current.push(iframeDomain);
        await setStorage({ [STORAGE_KEYS.WHITELIST]: current });
      }
      interceptionEnabledPerOrigin.add(getRootDomainFromUrl(src));
      chrome.tabs.sendMessage(tabId, {
        type: "SLOTSCOPE_ENABLE_INSPECTOR",
        iframeInfo
      }).catch(() => {});
      chrome.notifications.clear(notifId);
    } else if (buttonIndex === 1) {
      // No – blacklist
      const current = (await getStorage(STORAGE_KEYS.BLACKLIST)) || [];
      if (!current.includes(iframeDomain)) {
        current.push(iframeDomain);
        await setStorage({ [STORAGE_KEYS.BLACKLIST]: current });
      }
      chrome.notifications.clear(notifId);
    }
  });

  // Add "Remind me later" via notification closed event + popup button
  chrome.notifications.onClosed.addListener(async (closedId, byUser) => {
    if (closedId !== notifId || !byUser) return;
    // Treat close as "remind me later" – suppress for 5 minutes
    const fiveMinutes = 5 * 60 * 1000;
    await setStorage({
      [STORAGE_KEYS.SUPPRESS_UNTIL]: Date.now() + fiveMinutes
    });
  });
}

// Listen for detection signals from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "SLOTSCOPE_IFRAME_DETECTED" && sender.tab) {
    handleSlotIframeDetected(sender.tab.id, msg.iframeInfo);
  }

  // From popup or content to toggle interception for an origin
  if (msg && msg.type === "SLOTSCOPE_SET_INTERCEPTION_ORIGIN") {
    if (msg.origin && msg.enabled) {
      interceptionEnabledPerOrigin.add(msg.origin);
    } else if (msg.origin) {
      interceptionEnabledPerOrigin.delete(msg.origin);
    }
  }

  // From bridge or content wanting to log captured config for dashboard
  if (msg && msg.type === "SLOTSCOPE_BACKEND_CONFIG_CAPTURED" && sender.tab) {
    chrome.tabs.sendMessage(sender.tab.id, {
      type: "SLOTSCOPE_BACKEND_CONFIG_CAPTURED_BROADCAST",
      payload: msg.payload,
      sourceFrameId: sender.frameId
    }).catch(() => {});
  }

  sendResponse && sendResponse();
});

// webRequest interception to capture JSON and relax CORS for the extension’s own origin
chrome.webRequest.onHeadersReceived.addListener(
  details => {
    try {
      const url = new URL(details.url);
      const originRoot = getRootDomainFromUrl(url.origin);
      if (!originRoot) return {};

      // Only touch origins the user explicitly enabled via whitelist/consent
      if (!interceptionEnabledPerOrigin.has(originRoot)) return {};

      const headers = details.responseHeaders || [];
      let hasCors = false;

      for (const h of headers) {
        const name = h.name.toLowerCase();
        if (name === "access-control-allow-origin") {
          hasCors = true;
          h.value = "*";
        }
        if (name === "access-control-allow-credentials") {
          h.value = "true";
        }
      }

      if (!hasCors) {
        headers.push({
          name: "Access-Control-Allow-Origin",
          value: "*"
        });
      }

      return { responseHeaders: headers };
    } catch (e) {
      return {};
    }
  },
  {
    urls: ["<all_urls>"],
    types: ["xmlhttprequest", "fetch"]
  },
  ["responseHeaders", "blocking", "extraHeaders"]
);

// Note: capturing full response bodies requires declarativeNetRequest+offscreen
// or fetch cloning from within the injected context. The main interception of
// payloads is done inside bridge.js via monkey-patched fetch/XHR.
