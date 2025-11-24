// bridge.js
// Injected into (game) frames as a web-accessible resource.
// MUST NOT run without user consent; content.js + background gate this.

// Security: Require explicit kick-off from extension via postMessage OR
// obey data-attribute when injected.

(function () {
  if (window.__slotscopeBridgeLoaded) return;
  window.__slotscopeBridgeLoaded = true;

  const ORIGIN = window.location.origin;

  // Simple consent flag – only active after explicit "ENABLE" command
  let enabled = false;

  // Utility: safe postMessage to parent/extension pipeline
  function postToParent(data) {
    try {
      window.parent && window.parent.postMessage(
        Object.assign({}, data, { slotscope: true }),
        ORIGIN
      );
    } catch (e) {}
  }

  // RTP/config extraction from intercepted payloads
  function extractRtpInfo(json) {
    const out = {};
    if (typeof json !== "object" || !json) return out;

    if (typeof json.rtp === "number") out.rtp = json.rtp;
    if (typeof json.returnToPlayer === "number") out.rtp = json.returnToPlayer;
    if (json.rtpVariant) out.rtpVariant = json.rtpVariant;
    if (json.volatility) out.volatility = json.volatility;
    if (typeof json.volIndex === "number") out.volIndex = json.volIndex;
    if (typeof json.bonusFrequency === "number") out.bonusFrequency = json.bonusFrequency;
    if (typeof json.hitRate === "number") out.hitRate = json.hitRate;
    if (json.seed) out.seed = json.seed;
    if (json.maxWin) out.maxWin = json.maxWin;

    return out;
  }

  function sendBackendPayload(url, body, json) {
    if (!enabled) return;

    const summary = extractRtpInfo(json || {});
    const payload = {
      url,
      body,
      summary,
      raw: json
    };

    // Send to background via runtime messaging when possible
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: "SLOTSCOPE_BACKEND_CONFIG_CAPTURED",
          payload: payload
        },
        () => void chrome.runtime.lastError
      );
    }

    // Also push via parent postMessage chain fallback
    postToParent({
      type: "BACKEND_CONFIG_FALLBACK",
      payload: payload
    });
  }

  // Hook fetch
  function hookFetch() {
    if (!window.fetch) return;
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      let url = args[0];
      let opts = args[1] || {};

      try {
        url = typeof url === "string" ? url : url.url;
      } catch (e) {}

      const body = opts && opts.body ? opts.body : null;

      const resp = await origFetch.apply(this, args);
      try {
        const cloned = resp.clone();
        const ct = cloned.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const json = await cloned.json();
          if (typeof url === "string") {
            if (/\/config|\/rtp|\/game-settings|\/backend-config|\/session\/settings|\/seed-gen|\/volatility/i.test(url)) {
              sendBackendPayload(url, body, json);
            } else {
              // Attempt generic RTP extraction by regex on keys
              const summary = extractRtpInfo(json);
              if (Object.keys(summary).length > 0) {
                sendBackendPayload(url, body, json);
              }
            }
          }
        }
      } catch (e) {}

      return resp;
    };
  }

  // Hook XHR
  function hookXHR() {
    if (!window.XMLHttpRequest) return;
    const OrigXHR = window.XMLHttpRequest;

    function WrappedXHR() {
      const xhr = new OrigXHR();
      let url = "";
      let method = "";
      let body = null;

      const origOpen = xhr.open;
      xhr.open = function (m, u, ...rest) {
        method = m;
        url = u;
        return origOpen.call(xhr, m, u, ...rest);
      };

      const origSend = xhr.send;
      xhr.send = function (b) {
        body = b;
        xhr.addEventListener("load", () => {
          try {
            const ct = xhr.getResponseHeader("content-type") || "";
            if (ct.includes("application/json") && xhr.responseText) {
              const json = JSON.parse(xhr.responseText);
              if (/\/config|\/rtp|\/game-settings|\/backend-config|\/session\/settings|\/seed-gen|\/volatility/i.test(url)) {
                sendBackendPayload(url, body, json);
              } else {
                const summary = extractRtpInfo(json);
                if (Object.keys(summary).length > 0) {
                  sendBackendPayload(url, body, json);
                }
              }
            }
          } catch (e) {}
        });
        return origSend.call(xhr, b);
      };

      return xhr;
    }

    window.XMLHttpRequest = WrappedXHR;
  }

  // Hook common game init functions to capture config objects
  function hookGameInit() {
    const candidates = [
      ["game", "init"],
      ["SlotGame", "start"]
    ];

    candidates.forEach(([objName, fnName]) => {
      try {
        const obj = window[objName];
        if (!obj || typeof obj[fnName] !== "function") return;
        const orig = obj[fnName];
        obj[fnName] = function (...args) {
          if (enabled) {
            try {
              const config = args[0];
              const summary = extractRtpInfo(config || {});
              if (Object.keys(summary).length > 0) {
                sendBackendPayload(`${objName}.${fnName}`, null, config);
              }
            } catch (e) {}
          }
          return orig.apply(this, args);
        };
      } catch (e) {}
    });
  }

  // Spin tracking: observe DOM or expose hook for in-game events
  function setupSpinTracking() {
    // Generic: watch for buttons with text "spin" or known classes
    try {
      const observer = new MutationObserver(muts => {
        for (const m of muts) {
          const els = (m.target || document).querySelectorAll
            ? (m.target || document).querySelectorAll("button, [role='button']")
            : [];
          els.forEach(el => {
            const txt = (el.textContent || "").toLowerCase();
            if (txt.includes("spin") || el.className.toLowerCase().includes("spin")) {
              if (!el.__slotscopeSpinHooked) {
                el.__slotscopeSpinHooked = true;
                el.addEventListener("click", () => {
                  // For real tracking, you might need to read bet amount from DOM/global variables
                  const bet = extractBetAmount();
                  // Win will be known after reels stop – this is simplified:
                  setTimeout(() => {
                    const win = extractWinAmount();
                    postToParent({
                      type: "SPIN_RESULT",
                      bet,
                      win
                    });
                  }, 1500);
                });
              }
            }
          });
        }
      });

      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true
      });
    } catch (e) {}

    // Expose a global hook the game can call directly if developer integrates it
    window.__slotscopeSpin = function (bet, win) {
      postToParent({
        type: "SPIN_RESULT",
        bet: bet || 0,
        win: win || 0
      });
    };

    function extractBetAmount() {
      try {
        const els = document.querySelectorAll("[class*='bet'], [id*='bet']");
        for (const el of els) {
          const txt = el.textContent || "";
          const m = txt.match(/(\d+(\.\d+)?)/);
          if (m) return parseFloat(m[1]);
        }
      } catch (e) {}
      return 1;
    }

    function extractWinAmount() {
      try {
        const els = document.querySelectorAll("[class*='win'], [id*='win']");
        for (const el of els) {
          const txt = el.textContent || "";
          const m = txt.match(/(\d+(\.\d+)?)/);
          if (m) return parseFloat(m[1]);
        }
      } catch (e) {}
      return 0;
    }
  }

  // postMessage listener for enable/disable from extension
  window.addEventListener("message", ev => {
    // Only accept from same-origin parent to avoid spoofing
    if (ev.origin !== ORIGIN) return;
    const data = ev.data;
    if (!data || !data.slotscope) return;

    if (data.type === "ENABLE_BRIDGE") {
      enabled = true;
    }
    if (data.type === "DISABLE_BRIDGE") {
      enabled = false;
    }
  });

  // Initialize hooks (they only actively send once `enabled` is true)
  hookFetch();
  hookXHR();
  hookGameInit();
  setupSpinTracking();
})();
