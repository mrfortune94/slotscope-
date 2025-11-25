// content.js
// Runs on all frames, document_start, all_frames: true

const PROVIDER_DOMAINS = [
  "pragmaticplay",
  "netent",
  "playngo",
  "evolution",
  "relaxgaming",
  "nolimitcity"
];

const GAME_PATTERNS = [
  "/games/",
  "/slot/",
  "/casino/game/",
  "/game/launch",
  "/html5-game/"
];

const DASHBOARD_ORIGIN = new URL(chrome.runtime.getURL("/")).origin;

let inspectorEnabled = false;
let trackedIframe = null;
let hotnessState = {
  totalBets: 0,
  totalWins: 0,
  last20Spins: [],
  last50Spins: [],
  lossStreak: 0,
  lastResult: null,
  backendRtp: null,
  volatility: null
};

// Detect slot-like iframes
function looksLikeSlotIframe(iframe) {
  try {
    const src = iframe.src || iframe.getAttribute("src") || "";
    if (!src) return false;

    const width = parseInt(iframe.width || iframe.style.width || "0", 10) || iframe.getBoundingClientRect().width;
    const height = parseInt(iframe.height || iframe.style.height || "0", 10) || iframe.getBoundingClientRect().height;
    const sandboxAttr = iframe.getAttribute("sandbox") || "";

    const urlLower = src.toLowerCase();

    const providerHit = PROVIDER_DOMAINS.some(p => urlLower.includes(p));
    const patternHit = GAME_PATTERNS.some(p => urlLower.includes(p));
    const largeEnough = width >= 500 && height >= 500;

    const sandboxLike = sandboxAttr.includes("allow-scripts") || sandboxAttr.includes("allow-same-origin") || sandboxAttr.length > 0;

    return (providerHit || patternHit || largeEnough || sandboxLike);
  } catch (e) {
    return false;
  }
}

function scanForIframesAndNotify() {
  if (window.top !== window) return; // Only in top frame

  const iframes = document.querySelectorAll("iframe");
  for (const iframe of iframes) {
    if (!looksLikeSlotIframe(iframe)) continue;
    const src = iframe.src || iframe.getAttribute("src");
    if (!src) continue;

    const info = {
      src,
      sandbox: iframe.getAttribute("sandbox") || "",
      width: iframe.width || iframe.style.width || null,
      height: iframe.height || iframe.style.height || null
    };

    chrome.runtime.sendMessage({
      type: "SLOTSCOPE_IFRAME_DETECTED",
      iframeInfo: info
    });

    // Track the first one; for multiple games per page you could extend this
    trackedIframe = iframe;
    break;
  }
}

// MutationObserver for dynamic iframes
if (window.top === window) {
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "IFRAME") {
          if (looksLikeSlotIframe(node)) {
            scanForIframesAndNotify();
            return;
          }
        }
      }
    }
  });
  mo.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  // Periodic scan
  setInterval(scanForIframesAndNotify, 2000);
}

// Listen for instructions from background (enable inspector)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "SLOTSCOPE_ENABLE_INSPECTOR" && window.top === window) {
    if (!inspectorEnabled) {
      inspectorEnabled = true;
      transformToSplitScreen(msg.iframeInfo);
      // Tell background to allow interception for this origin
      try {
        const iframeUrl = new URL(msg.iframeInfo.src);
        chrome.runtime.sendMessage({
          type: "SLOTSCOPE_SET_INTERCEPTION_ORIGIN",
          origin: iframeUrl.origin,
          enabled: true
        });
      } catch (e) {}
    }
  }

  if (msg && msg.type === "SLOTSCOPE_BACKEND_CONFIG_CAPTURED_BROADCAST") {
    // Payload from bridge.js (XHR/fetch hooks etc.)
    updateBackendConfig(msg.payload);
  }

  sendResponse && sendResponse();
});

// Split screen UI
function transformToSplitScreen(iframeInfo) {
  const originalHtml = document.documentElement;
  if (!originalHtml) return;

  const body = document.body || (function () {
    const b = document.createElement("body");
    document.documentElement.appendChild(b);
    return b;
  })();

  // Create container for split layout
  const container = document.createElement("div");
  container.id = "slotscope-split-container";
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "100vw";
  container.style.height = "100vh";
  container.style.display = "flex";
  container.style.flexDirection = "row";
  container.style.zIndex = "2147483647";
  container.style.background = "#111";
  container.style.color = "#eee";
  container.style.fontFamily = "system-ui, sans-serif";

  // Left: original page iframe
  const leftPane = document.createElement("div");
  leftPane.id = "slotscope-left-pane";
  leftPane.style.flex = "0 0 70%";
  leftPane.style.display = "flex";
  leftPane.style.flexDirection = "column";
  leftPane.style.borderRight = "2px solid #222";
  leftPane.style.position = "relative";

  const leftHeader = document.createElement("div");
  leftHeader.textContent = "SlotScope – Original Page";
  leftHeader.style.background = "#222";
  leftHeader.style.color = "#eee";
  leftHeader.style.padding = "4px 8px";
  leftHeader.style.fontSize = "12px";

  const leftFrame = document.createElement("iframe");
  leftFrame.id = "slotscope-original-frame";
  leftFrame.src = window.location.href;
  leftFrame.style.border = "0";
  leftFrame.style.width = "100%";
  leftFrame.style.height = "100%";
  leftFrame.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms allow-popups");
  leftFrame.style.flex = "1 1 auto";

  leftPane.appendChild(leftHeader);
  leftPane.appendChild(leftFrame);

  // Divider / resize handle
  const divider = document.createElement("div");
  divider.id = "slotscope-divider";
  divider.style.width = "4px";
  divider.style.cursor = "col-resize";
  divider.style.background = "#333";
  divider.style.flex = "0 0 auto";

  // Right: dashboard as embedded web accessible resource
  const rightPane = document.createElement("div");
  rightPane.id = "slotscope-right-pane";
  rightPane.style.flex = "1 1 auto";
  rightPane.style.display = "flex";
  rightPane.style.flexDirection = "column";
  rightPane.style.background = "#000";

  const dashFrame = document.createElement("iframe");
  dashFrame.id = "slotscope-dashboard-frame";
  dashFrame.src = chrome.runtime.getURL("dashboard.html");
  dashFrame.style.border = "0";
  dashFrame.style.width = "100%";
  dashFrame.style.height = "100%";
  dashFrame.setAttribute("sandbox", "allow-same-origin allow-scripts");

  rightPane.appendChild(dashFrame);

  container.appendChild(leftPane);
  container.appendChild(divider);
  container.appendChild(rightPane);

  // Clear existing page and mount split container
  document.documentElement.innerHTML = "";
  document.documentElement.appendChild(container);

  // Resizing logic
  let isDragging = false;
  divider.addEventListener("mousedown", e => {
    isDragging = true;
    e.preventDefault();
  });
  window.addEventListener("mousemove", e => {
    if (!isDragging) return;
    const totalWidth = window.innerWidth;
    const newLeftWidth = Math.min(Math.max(e.clientX, 200), totalWidth - 200);
    leftPane.style.flex = `0 0 ${newLeftWidth}px`;
  });
  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Inject bridge into all frames of original page once loaded
  leftFrame.addEventListener("load", () => {
    injectBridgeIntoAllFrames(leftFrame.contentWindow);
  });
}

// Inject bridge.js into all frames (recursive) in a given window context
function injectBridgeIntoAllFrames(win) {
  try {
    injectBridgeIntoWindow(win);
  } catch (e) {}

  try {
    const frames = win.frames;
    for (let i = 0; i < frames.length; i++) {
      try {
        injectBridgeIntoWindow(frames[i]);
      } catch (e) {}
    }
  } catch (e) {}
}

function injectBridgeIntoWindow(win) {
  try {
    const doc = win.document;
    if (!doc) return;
    const s = doc.createElement("script");
    s.src = chrome.runtime.getURL("bridge.js");
    s.async = false;
    s.dataset.slotscopeBridge = "1";
    doc.documentElement.appendChild(s);
  } catch (e) {
    // If direct DOM access fails (cross-origin/sandbox), fall back to
    // message-based injection from the frame context itself when possible.
  }
}

// Backend config handling: updates from bridge
function updateBackendConfig(payload) {
  if (!payload) return;

  // Merge key fields for dashboard
  if (typeof payload.rtp === "number") {
    hotnessState.backendRtp = payload.rtp;
  }
  if (payload.volatility) {
    hotnessState.volatility = payload.volatility;
  }
  if (payload.bonusFrequency != null) {
    hotnessState.bonusFrequency = payload.bonusFrequency;
  }
  if (payload.rawConfig) {
    hotnessState.rawConfig = payload.rawConfig;
  }

  pushStateToDashboard();
}

// Spin tracking hooks from bridge.js
window.addEventListener("message", ev => {
  // Always verify origin – only process from same origin dashboard split frame or page
  if (ev.origin !== window.location.origin) return;
  const data = ev.data;
  if (!data || !data.slotscope) return;

  if (data.type === "SPIN_RESULT") {
    const { bet, win } = data;
    hotnessState.totalBets += bet;
    hotnessState.totalWins += win;

    hotnessState.last20Spins.push({ bet, win });
    if (hotnessState.last20Spins.length > 20) {
      hotnessState.last20Spins.shift();
    }

    hotnessState.last50Spins.push({ bet, win });
    if (hotnessState.last50Spins.length > 50) {
      hotnessState.last50Spins.shift();
    }

    if (win <= 0) {
      hotnessState.lossStreak = (hotnessState.lossStreak || 0) + 1;
    } else {
      hotnessState.lossStreak = 0;
    }

    hotnessState.lastResult = { bet, win, ts: Date.now() };
    pushStateToDashboard();
  }
});

// Hotness score computation
function computeHotnessScore() {
  const baseRtp = hotnessState.backendRtp || 0;
  const volatility = (hotnessState.volatility || "").toLowerCase();

  let score = baseRtp;

  if (volatility === "high") score += 10;
  if (volatility === "medium") score += 5;

  let observedRtp = 0;
  if (hotnessState.totalBets > 0) {
    observedRtp = (hotnessState.totalWins / hotnessState.totalBets) * 100;
    score += (observedRtp - baseRtp);
  }

  if (hotnessState.lossStreak > 10) {
    score -= 20;
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  let label = "Cold ❄️";
  if (score > 90) label = "Hot 🔥";
  else if (score >= 70) label = "Warm";

  return {
    score,
    label,
    observedRtp
  };
}

function pushStateToDashboard() {
  const dashFrame = document.getElementById("slotscope-dashboard-frame");
  if (!dashFrame || !dashFrame.contentWindow) return;

  const hot = computeHotnessScore();

  dashFrame.contentWindow.postMessage(
    {
      slotscope: true,
      type: "DASHBOARD_UPDATE",
      state: {
        backendRtp: hotnessState.backendRtp,
        volatility: hotnessState.volatility,
        bonusFrequency: hotnessState.bonusFrequency,
        totalBets: hotnessState.totalBets,
        totalWins: hotnessState.totalWins,
        lossStreak: hotnessState.lossStreak,
        last20Spins: hotnessState.last20Spins,
        last50Spins: hotnessState.last50Spins,
        hotnessScore: hot.score,
        hotnessLabel: hot.label,
        observedRtp: hot.observedRtp,
        rawConfig: hotnessState.rawConfig
      }
    },
    DASHBOARD_ORIGIN
  );
}
