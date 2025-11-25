const STORAGE_KEYS = {
  WHITELIST: "slotscope_whitelist",
  BLACKLIST: "slotscope_blacklist",
  SUPPRESS_UNTIL: "slotscope_suppress_until"
};

function getRootDomain(url) {
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

function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]));
  });
}

function getStorage(key) {
  return new Promise(resolve => {
    chrome.storage.sync.get(key, items => resolve(items[key]));
  });
}

function setStorage(obj) {
  return new Promise(resolve => {
    chrome.storage.sync.set(obj, () => resolve());
  });
}

async function updateUi() {
  const tab = await getActiveTab();
  const domain = tab && tab.url ? getRootDomain(tab.url) : null;
  const statusText = document.getElementById("status-text");
  const pill = document.getElementById("domain-pill");
  const indicator = document.getElementById("active-indicator");
  const whitelistBtn = document.getElementById("whitelist-btn");
  const blacklistBtn = document.getElementById("blacklist-btn");

  if (!domain) {
    pill.textContent = "Unavailable";
    statusText.textContent = "Could not read active tab URL.";
    whitelistBtn.disabled = true;
    blacklistBtn.disabled = true;
    return;
  }

  pill.textContent = domain;

  const [whitelist, blacklist, suppress] = await Promise.all([
    getStorage(STORAGE_KEYS.WHITELIST),
    getStorage(STORAGE_KEYS.BLACKLIST),
    getStorage(STORAGE_KEYS.SUPPRESS_UNTIL)
  ]);

  const wl = whitelist || [];
  const bl = blacklist || [];
  const now = Date.now();
  const suppressed = suppress && now < suppress;

  if (wl.includes(domain)) {
    statusText.textContent = "Whitelisted – SlotScope will auto-launch on this domain.";
    indicator.textContent = "Active";
    indicator.style.color = "#7cf3c9";
  } else if (bl.includes(domain)) {
    statusText.textContent = "Blacklisted – SlotScope stays silent here.";
    indicator.textContent = "Ignored";
    indicator.style.color = "#f5a8a8";
  } else if (suppressed) {
    const mins = Math.ceil((suppress - now) / 60000);
    statusText.textContent = `Snoozed – reminders resume in ${mins} minute(s).`;
    indicator.textContent = "Snoozed";
    indicator.style.color = "#ffd479";
  } else {
    statusText.textContent = "Not configured – choose how to handle this domain.";
    indicator.textContent = "Neutral";
    indicator.style.color = "#9acbff";
  }

  whitelistBtn.onclick = async () => {
    const set = new Set(wl);
    set.add(domain);
    bl.forEach(d => set.delete(d));
    await setStorage({
      [STORAGE_KEYS.WHITELIST]: Array.from(set),
      [STORAGE_KEYS.BLACKLIST]: bl.filter(d => d !== domain)
    });
    statusText.textContent = "Saved. SlotScope will prompt then auto-enable here.";
    indicator.textContent = "Active";
    indicator.style.color = "#7cf3c9";
    try {
      await chrome.runtime.sendMessage({
        type: "SLOTSCOPE_SET_INTERCEPTION_ORIGIN",
        origin: new URL(tab.url).origin,
        enabled: true
      });
    } catch (e) {}
  };

  blacklistBtn.onclick = async () => {
    const set = new Set(bl);
    set.add(domain);
    wl.forEach(d => set.delete(d));
    await setStorage({
      [STORAGE_KEYS.BLACKLIST]: Array.from(set),
      [STORAGE_KEYS.WHITELIST]: wl.filter(d => d !== domain)
    });
    statusText.textContent = "Saved. SlotScope will ignore this site.";
    indicator.textContent = "Ignored";
    indicator.style.color = "#f5a8a8";
  };
}

function wireButtons() {
  document.getElementById("open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("clear-suppress").addEventListener("click", async () => {
    await setStorage({ [STORAGE_KEYS.SUPPRESS_UNTIL]: 0 });
    document.getElementById("status-text").textContent = "Reminder snooze cleared.";
    document.getElementById("active-indicator").textContent = "Neutral";
    document.getElementById("active-indicator").style.color = "#9acbff";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireButtons();
  updateUi();
});
