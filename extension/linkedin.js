(function () {
  const API_BASE = "http://localhost:4545";
  let lastValue = null;
  let autoAttemptedValue = null;

  const root = document.createElement("div");
  root.id = "naukri-automation-panel";
  root.innerHTML = `
    <div id="nap-header">
      <span>LinkedIn Open-to-Work Check</span>
      <button id="nap-toggle" title="Minimize">_</button>
    </div>
    <div id="nap-body">
      <div id="nap-idle">Connecting to local worker...</div>
      <div id="nap-card" style="display:none">
        <div id="nap-row"></div>
        <div id="nap-status"></div>
        <div id="nap-buttons">
          <button class="nap-btn nap-primary" data-status="Yes">Yes</button>
          <button class="nap-btn" data-status="No">No</button>
          <button class="nap-btn nap-stop" data-status="Stopped">Stop run</button>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(root);

  let minimized = false;
  document.getElementById("nap-toggle").addEventListener("click", () => {
    minimized = !minimized;
    document.getElementById("nap-body").style.display = minimized ? "none" : "block";
    document.getElementById("nap-toggle").textContent = minimized ? "+" : "_";
  });

  document.querySelectorAll(".nap-btn[data-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await submit({ status: btn.getAttribute("data-status") });
    });
  });

  function setStatus(text) {
    const el = document.getElementById("nap-status");
    if (el) el.textContent = text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function submit(body) {
    setStatus("");
    try {
      await fetch(`${API_BASE}/api/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error("LinkedIn Open-to-Work Helper: submit failed", err);
    }
    poll();
  }

  function profilePath(url) {
    try {
      return new URL(url).pathname.replace(/\/+$/, "");
    } catch {
      return url;
    }
  }

  function isOpenToWork() {
    return Array.from(document.querySelectorAll("strong")).some((el) => el.textContent.trim().toLowerCase() === "open to work");
  }

  function randomDelay(minMs, maxMs) {
    return sleep(Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs);
  }

  async function autoCheck(url) {
    const targetPath = profilePath(url);
    if (profilePath(window.location.href) !== targetPath) {
      setStatus("Navigating to profile...");
      // Pause before navigating, like a person about to click a link
      // rather than jumping straight there.
      await randomDelay(2000, 5000);
      window.location.href = url;
      return; // fresh page load re-runs this content script and retries
    }

    // Pause after the page has loaded before scanning it, like a person
    // actually reading the profile rather than scraping it instantly.
    setStatus("Checking for Open to Work...");
    await randomDelay(2000, 5000);

    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (isOpenToWork()) {
        setStatus('Found "Open to work" - submitting Yes.');
        await randomDelay(2000, 5000);
        await submit({ status: "Yes" });
        return;
      }
      await sleep(500);
    }

    setStatus('"Open to work" not found - submitting No.');
    await randomDelay(2000, 5000);
    await submit({ status: "No" });
  }

  async function poll() {
    let state;
    try {
      const res = await fetch(`${API_BASE}/api/state`);
      state = await res.json();
    } catch (err) {
      document.getElementById("nap-idle").textContent = 'Worker not reachable - is "npm run agent:web" running?';
      document.getElementById("nap-idle").style.display = "block";
      document.getElementById("nap-card").style.display = "none";
      return;
    }

    const idleEl = document.getElementById("nap-idle");
    const cardEl = document.getElementById("nap-card");

    if (state.pending && state.pending.channel === "linkedin") {
      idleEl.style.display = "none";
      cardEl.style.display = "block";
      if (state.pending.value !== lastValue) {
        document.getElementById("nap-row").textContent = `Row ${state.pending.rowNumber}: ${state.pending.name}`;
        lastValue = state.pending.value;
        setStatus("");
      }
      if (autoAttemptedValue !== state.pending.value) {
        autoAttemptedValue = state.pending.value;
        autoCheck(state.pending.value);
      }
    } else {
      cardEl.style.display = "none";
      lastValue = null;
      autoAttemptedValue = null;
      idleEl.style.display = "block";
      idleEl.textContent = state.pending
        ? "Waiting for the current Naukri step to finish..."
        : state.idle
          ? state.lastRunSummary
            ? `Last run: ${state.lastRunSummary}`
            : "Waiting for a run to be triggered (tick X1)..."
          : "Run in progress, waiting for the next LinkedIn check...";
    }
  }

  setInterval(poll, 1500);
  poll();
})();
