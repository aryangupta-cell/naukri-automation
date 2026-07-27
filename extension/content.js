(function () {
  const API_BASE = "http://localhost:4545";
  const SEARCH_URL = "https://resdex.naukri.com/v3?activeTab=advSrch";
  const KEYWORDS_SELECTOR = 'input[name="ezKeywordsAny"]';
  const SEARCH_BUTTON_SELECTOR = "#adv-search-btn";

  let lastMobile = null;
  let autoAttemptedMobile = null;

  const root = document.createElement("div");
  root.id = "naukri-automation-panel";
  root.innerHTML = `
    <div id="nap-header">
      <span>Naukri Automation</span>
      <button id="nap-toggle" title="Minimize">_</button>
    </div>
    <div id="nap-body">
      <div id="nap-idle">Connecting to local worker...</div>
      <div id="nap-card" style="display:none">
        <div id="nap-row"></div>
        <div id="nap-mobile-row">
          <span id="nap-mobile"></span>
          <button id="nap-copy" class="nap-btn">Copy</button>
        </div>
        <div id="nap-status"></div>
        <div id="nap-buttons">
          <button class="nap-btn nap-primary" data-status="Completed">Completed</button>
          <button class="nap-btn" data-status="Not Found">Not Found</button>
          <button class="nap-btn" data-status="Multiple Matches">Multiple Matches</button>
          <button class="nap-btn" data-status="Manual Intervention">Manual Intervention</button>
          <button class="nap-btn" data-status="Failed">Failed</button>
          <button class="nap-btn nap-stop" data-status="Stopped">Stop run</button>
        </div>
        <div id="nap-completed-fields" style="display:none">
          <input type="text" id="nap-modified" placeholder="Exact 'Modified ...' text" />
          <input type="text" id="nap-active" placeholder="Exact 'Active ...' text" />
          <button id="nap-submit-completed" class="nap-btn nap-primary">Submit</button>
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

  document.getElementById("nap-copy").addEventListener("click", async () => {
    if (lastMobile) {
      await navigator.clipboard.writeText(lastMobile);
    }
  });

  document.querySelectorAll(".nap-btn[data-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.getAttribute("data-status");
      if (status === "Completed") {
        document.getElementById("nap-completed-fields").style.display = "block";
        return;
      }
      await submit({ status });
    });
  });

  document.getElementById("nap-submit-completed").addEventListener("click", async () => {
    const modified = document.getElementById("nap-modified").value.trim();
    const active = document.getElementById("nap-active").value.trim();
    if (!modified || !active) {
      alert("Both fields are required.");
      return;
    }
    await submit({ status: "Completed", modified, active });
    document.getElementById("nap-modified").value = "";
    document.getElementById("nap-active").value = "";
    document.getElementById("nap-completed-fields").style.display = "none";
  });

  function setStatus(text) {
    const el = document.getElementById("nap-status");
    if (el) el.textContent = text;
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
      console.error("Naukri Automation Helper: submit failed", err);
    }
    poll();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomDelay(minMs, maxMs) {
    return sleep(Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs);
  }

  // React-controlled inputs ignore a plain `el.value = x` assignment; this
  // uses the native property setter so React's onChange actually fires.
  function setReactInputValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    desc.set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Naukri's footer item class names carry a build-specific hash suffix
  // (e.g. tuple-footer-item_cQ0i5) that can change between deployments, so
  // match on the stable "tuple-footer" prefix and rely on the text itself.
  function extractModifiedActive() {
    const candidates = document.querySelectorAll('[class*="tuple-footer"]');
    let modified = null;
    let active = null;
    candidates.forEach((el) => {
      const text = el.textContent.trim();
      if (!modified && /^Modified\b/i.test(text)) modified = text;
      if (!active && /^Active\b/i.test(text)) active = text;
    });
    return { modified, active };
  }

  const CHIP_REMOVE_SELECTOR = ".tag-ico.naukri-icon.naukri-icon-times";

  // Removes any leftover keyword chips from a previous search so consecutive
  // auto-searches don't stack multiple numbers into one query.
  async function clearAllKeywordChips() {
    for (let i = 0; i < 10; i++) {
      const removeIcon = document.querySelector(CHIP_REMOVE_SELECTOR);
      if (!removeIcon) break;
      removeIcon.click();
      await sleep(250);
    }
  }

  async function waitForElement(selector, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  async function autoSearch(mobile) {
    const onSearchPage = window.location.href.includes("activeTab=advSrch");
    let keywordsInput = document.querySelector(KEYWORDS_SELECTOR);

    if (!keywordsInput && !onSearchPage) {
      setStatus("Navigating to Search Resumes...");
      window.location.href = SEARCH_URL;
      return; // the fresh page load re-runs this content script and retries
    }

    // Pacing to avoid tripping Naukri's rate-limiting/CAPTCHA - widened from
    // the spec's original 2-5s after still hitting CAPTCHAs during a full-sheet run.
    setStatus("Waiting a few seconds before searching...");
    await randomDelay(5000, 10000);

    if (!keywordsInput) {
      // Already on the search page, just still rendering - wait for it
      // rather than re-navigating (re-navigating here caused a reload loop).
      setStatus("Waiting for the search page to load...");
      keywordsInput = await waitForElement(KEYWORDS_SELECTOR, 10000);
      if (!keywordsInput) {
        setStatus("Search page didn't load in time - please continue manually.");
        return;
      }
    }

    setStatus("Searching...");
    await clearAllKeywordChips();
    await sleep(200);
    setReactInputValue(keywordsInput, mobile);
    await sleep(300);

    // This field is a chip/tag autocomplete (role="combobox") - typing alone
    // leaves the text unconfirmed; Enter is what turns it into an actual
    // search chip. Without this, Naukri rejects the search as "too generic".
    const enterEventInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
    keywordsInput.dispatchEvent(new KeyboardEvent("keydown", enterEventInit));
    keywordsInput.dispatchEvent(new KeyboardEvent("keyup", enterEventInit));
    await sleep(500);

    const searchButton = document.querySelector(SEARCH_BUTTON_SELECTOR);
    if (!searchButton) {
      setStatus("Could not find the Search button - please continue manually.");
      return;
    }
    searchButton.click();

    const startUrl = window.location.href;
    const deadline = Date.now() + 15000;
    let outcome = "timeout";
    while (Date.now() < deadline) {
      await sleep(400);
      if (window.location.href !== startUrl && window.location.href.includes("tabKey=profile")) {
        outcome = "profile";
        break;
      }
      if (/no results found for this search/i.test(document.body.textContent)) {
        outcome = "no-results";
        break;
      }
      if (/too generic/i.test(document.body.textContent)) {
        outcome = "too-generic";
        break;
      }
    }

    if (outcome === "no-results") {
      setStatus('Naukri reported "No results found" - submitting Not Found.');
      await submit({ status: "Not Found" });
      return;
    }

    if (outcome === "too-generic") {
      setStatus("Naukri rejected the search - please classify the result manually below.");
      return;
    }

    if (outcome !== "profile") {
      setStatus("Could not confirm what happened after searching - please classify the result manually below.");
      return;
    }

    await sleep(800); // let the profile panel render
    const { modified, active } = extractModifiedActive();
    if (modified && active) {
      setStatus(`Auto-extracted: "${modified}" / "${active}". Submitting...`);
      await submit({ status: "Completed", modified, active });
    } else {
      setStatus("Profile opened but couldn't auto-read Modified/Active - please fill them in manually below.");
    }
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

    if (state.pending) {
      idleEl.style.display = "none";
      cardEl.style.display = "block";
      if (state.pending.mobile !== lastMobile) {
        document.getElementById("nap-row").textContent = `Row ${state.pending.rowNumber}: ${state.pending.name}`;
        document.getElementById("nap-mobile").textContent = state.pending.mobile;
        lastMobile = state.pending.mobile;
        setStatus("");
      }
      if (autoAttemptedMobile !== state.pending.mobile) {
        autoAttemptedMobile = state.pending.mobile;
        autoSearch(state.pending.mobile);
      }
    } else {
      cardEl.style.display = "none";
      lastMobile = null;
      autoAttemptedMobile = null;
      idleEl.style.display = "block";
      idleEl.textContent = state.idle
        ? state.lastRunSummary
          ? `Last run: ${state.lastRunSummary}`
          : "Waiting for a run to be triggered (tick B3)..."
        : "Run in progress, waiting for the next row...";
    }
  }

  setInterval(poll, 1500);
  poll();
})();
