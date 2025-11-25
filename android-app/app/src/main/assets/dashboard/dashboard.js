// dashboard.js

const parentOrigin = (() => {
  try {
    return new URL(document.referrer || "").origin;
  } catch (e) {
    return "*";
  }
})();

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateGauge(score) {
  const path = document.getElementById("gauge-fill");
  const knob = document.getElementById("gauge-knob");
  if (!path || !knob) return;

  const maxArcLen = 141; // approx length of half-circle
  const clamped = Math.max(0, Math.min(100, score));
  const dash = (clamped / 100) * maxArcLen;
  path.setAttribute("stroke-dasharray", `${dash} ${maxArcLen - dash}`);

  const angle = -180 + (clamped / 100) * 180; // -180 to 0
  const rad = (angle * Math.PI) / 180;
  const R = 45;
  const cx = 50 + R * Math.cos(rad);
  const cy = 50 + R * Math.sin(rad);
  knob.setAttribute("cx", cx.toString());
  knob.setAttribute("cy", cy.toString());

  if (score > 90) {
    path.setAttribute("stroke", "#f60");
  } else if (score >= 70) {
    path.setAttribute("stroke", "#ff0");
  } else {
    path.setAttribute("stroke", "#0f0");
  }
}

function renderSpins(spins) {
  const container = document.getElementById("spins-list");
  if (!container) return;
  container.innerHTML = "";
  (spins || []).slice().reverse().forEach((s, idx) => {
    const div = document.createElement("div");
    div.textContent = `#${spins.length - idx}: bet=${s.bet.toFixed(2)} win=${s.win.toFixed(2)}`;
    container.appendChild(div);
  });
}

window.addEventListener("message", ev => {
  // Accept only from the parent page origin that embedded the dashboard
  if (parentOrigin !== "*" && ev.origin !== parentOrigin) return;
  const data = ev.data;
  if (!data || !data.slotscope || data.type !== "DASHBOARD_UPDATE") return;

  const st = data.state || {};
  setText("backend-rtp", st.backendRtp != null ? `${st.backendRtp.toFixed(2)} %` : "–");
  setText("volatility", st.volatility || "–");
  setText("observed-rtp", st.observedRtp != null ? `${st.observedRtp.toFixed(2)} %` : "–");
  setText("hotness-score", st.hotnessScore != null ? st.hotnessScore.toFixed(1) : "–");
  setText("hotness-label", st.hotnessLabel || "–");

  updateGauge(st.hotnessScore || 0);
  renderSpins(st.last20Spins || []);

  const rawPre = document.getElementById("raw-config-pre");
  if (rawPre) {
    if (st.rawConfig) {
      rawPre.textContent = JSON.stringify(st.rawConfig, null, 2);
    } else {
      rawPre.textContent = "Waiting for backend config …";
    }
  }
});
