(function () {
  const API_BASE = "http://localhost:4545";
  const SEARCH_URL = "https://resdex.naukri.com/v3?activeTab=advSrch";
  const KEYWORDS_SELECTOR = 'input[name="ezKeywordsAny"]';
  const SEARCH_BUTTON_SELECTOR = "#adv-search-btn";

  let lastKey = null;
  let autoAttemptedKey = null;

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

  let lastValue = null;
  document.getElementById("nap-copy").addEventListener("click", async () => {
    if (lastValue) {
      await navigator.clipboard.writeText(lastValue);
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

  // Confirmed via live DOM inspection: the remove control is a
  // <button class="tag-ico-button ..." aria-label="Remove <value>"> wrapping
  // an <i class="naukri-icon naukri-icon-times">. Match on the icon (stable
  // across chip states) and click its closest button ancestor, since the
  // click handler lives on the button, not the icon.
  const CHIP_REMOVE_ICON_SELECTOR = "i.naukri-icon-times";

  function findChipRemoveButton() {
    const icon = document.querySelector(CHIP_REMOVE_ICON_SELECTOR);
    if (!icon) return null;
    return icon.closest("button") || icon.closest('[role="button"]') || icon;
  }

  // Removes any leftover keyword chips from a previous search so consecutive
  // auto-searches don't stack multiple numbers into one query. Keeps
  // re-checking (not just looping a fixed count) so a slow-to-update DOM
  // still ends up empty before the caller proceeds.
  async function clearAllKeywordChips() {
    for (let i = 0; i < 20; i++) {
      const removeBtn = findChipRemoveButton();
      if (!removeBtn) break;
      removeBtn.click();
      await sleep(300);
    }
    // Final safety check - if chips are still present after 20 attempts,
    // wait a bit longer and try once more rather than silently proceeding
    // with a contaminated keyword box.
    if (findChipRemoveButton()) {
      await sleep(500);
      for (let i = 0; i < 10; i++) {
        const removeBtn = findChipRemoveButton();
        if (!removeBtn) break;
        removeBtn.click();
        await sleep(300);
      }
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

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Types the value into the Keywords field and confirms it into a chip.
  // Returns true once a chip is confirmed, false if Naukri never confirmed
  // it after a retry (caller decides whether to try the whole cycle again).
  async function typeAndConfirmChip(keywordsInput, value) {
    await clearAllKeywordChips();
    await sleep(200);
    setReactInputValue(keywordsInput, value);
    // Give Naukri's suggestor dropdown time to actually load and register
    // the typed value before Enter is sent - firing Enter too early can
    // land before the field is ready to confirm anything into a chip.
    await sleep(900);

    // This field is a chip/tag autocomplete (role="combobox") - typing alone
    // leaves the text unconfirmed; Enter is what turns it into an actual
    // search chip. Without this, Naukri rejects the search as "too generic".
    const enterEventInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
    keywordsInput.dispatchEvent(new KeyboardEvent("keydown", enterEventInit));
    keywordsInput.dispatchEvent(new KeyboardEvent("keyup", enterEventInit));
    await sleep(1200);

    if (!document.querySelector(CHIP_REMOVE_ICON_SELECTOR)) {
      setReactInputValue(keywordsInput, value);
      await sleep(900);
      keywordsInput.dispatchEvent(new KeyboardEvent("keydown", enterEventInit));
      keywordsInput.dispatchEvent(new KeyboardEvent("keyup", enterEventInit));
      await sleep(1200);
    }

    return Boolean(document.querySelector(CHIP_REMOVE_ICON_SELECTOR));
  }

  // Runs one full search attempt (type value, confirm chip, click Search,
  // wait for an outcome) and returns the outcome without submitting
  // anything - callers decide what to do with it (retry, submit, etc).
  async function runOneSearchAttempt(keywordsInput, value) {
    const chipConfirmed = await typeAndConfirmChip(keywordsInput, value);
    if (!chipConfirmed) return "no-chip";

    // Pause before actually clicking Search, like a person glancing at the
    // confirmed chip before hitting the button.
    await randomDelay(2000, 13000);

    const searchButton = document.querySelector(SEARCH_BUTTON_SELECTOR);
    if (!searchButton) return "no-search-button";
    searchButton.click();

    // Pause after clicking before starting to watch for the outcome.
    await randomDelay(2000, 13000);

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
    return outcome;
  }

  async function goToSearchPageIfNeeded() {
    const onSearchPage = window.location.href.includes("activeTab=advSrch");
    let keywordsInput = document.querySelector(KEYWORDS_SELECTOR);

    if (!keywordsInput && !onSearchPage) {
      setStatus("Navigating to Search Resumes...");
      window.location.href = SEARCH_URL;
      return null; // the fresh page load re-runs this content script and retries
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
        return null;
      }
    }
    return keywordsInput;
  }

  const DECOY_CHANNELS = new Set(["name", "department"]);
  const RETRY_CHANNELS = new Set(["phone", "email"]);

  // Phone/email real searches get a random 3-7 total attempts when the
  // search comes back ambiguous ("too generic" or a timeout) - Naukri
  // appears to flag bare keyword-only searches as too generic fairly
  // often, and retrying the identical search a few times before giving up
  // recovers a chunk of those without needing a human to intervene every
  // time.
  async function autoSearch(value, channel) {
    const keywordsInput = await goToSearchPageIfNeeded();
    if (!keywordsInput) return;

    const isDecoy = DECOY_CHANNELS.has(channel);
    const maxAttempts = RETRY_CHANNELS.has(channel) ? randomInt(3, 7) : 1;

    setStatus("Searching...");
    let outcome = "timeout";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      outcome = await runOneSearchAttempt(keywordsInput, value);

      if (isDecoy) {
        // Decoy searches exist purely to vary the query pattern - the
        // outcome is irrelevant, always move on after one attempt.
        // Pause as if actually glancing at the results before moving on.
        await randomDelay(2000, 13000);
        await clearAllKeywordChips();
        setStatus("Decoy search done, moving on...");
        await randomDelay(2000, 13000);
        await submit({ status: "Done" });
        return;
      }

      if (outcome === "profile" || outcome === "no-results") break;

      // Ambiguous outcome - retry the same value if attempts remain.
      if (attempt < maxAttempts) {
        setStatus(`Search was rejected/unclear (attempt ${attempt}/${maxAttempts}) - retrying...`);
        await clearAllKeywordChips();
        await randomDelay(2000, 13000);
      }
    }

    if (outcome === "no-results") {
      setStatus('Naukri reported "No results found" - submitting Not Found.');
      await randomDelay(2000, 13000);
      await submit({ status: "Not Found" });
      return;
    }

    if (outcome === "too-generic") {
      await clearAllKeywordChips();
      setStatus(`Naukri rejected the search after ${maxAttempts} attempt(s) - please classify the result manually below.`);
      return;
    }

    if (outcome === "no-chip") {
      setStatus('Could not get Naukri to confirm the search chip - please search "' + value + '" manually and classify the result below.');
      return;
    }

    if (outcome !== "profile") {
      await clearAllKeywordChips();
      setStatus("Could not confirm what happened after searching - please classify the result manually below.");
      return;
    }

    // Pause before reading the profile panel, like a person actually
    // scanning the page rather than scraping it instantly.
    await randomDelay(2000, 13000);
    const { modified, active } = extractModifiedActive();
    if (modified && active) {
      setStatus(`Auto-extracted: "${modified}" / "${active}". Submitting...`);
      await randomDelay(2000, 13000);
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

    if (state.pending && state.pending.channel === "linkedin") {
      // This candidate's LinkedIn step is being handled on a linkedin.com tab, not here.
      cardEl.style.display = "none";
      lastKey = null;
      lastValue = null;
      autoAttemptedKey = null;
      idleEl.style.display = "block";
      idleEl.textContent = `Waiting for the LinkedIn check on row ${state.pending.rowNumber} to finish...`;
    } else if (state.pending) {
      const key = `${state.pending.rowNumber}:${state.pending.channel}:${state.pending.value}`;
      idleEl.style.display = "none";
      cardEl.style.display = "block";
      if (key !== lastKey) {
        document.getElementById("nap-row").textContent =
          `Row ${state.pending.rowNumber}: ${state.pending.name} (${state.pending.channel})`;
        document.getElementById("nap-mobile").textContent = state.pending.value;
        lastValue = state.pending.value;
        lastKey = key;
        setStatus("");
      }
      if (autoAttemptedKey !== key) {
        autoAttemptedKey = key;
        autoSearch(state.pending.value, state.pending.channel);
      }
    } else {
      cardEl.style.display = "none";
      lastKey = null;
      lastValue = null;
      autoAttemptedKey = null;
      idleEl.style.display = "block";
      idleEl.textContent = state.idle
        ? state.lastRunSummary
          ? `Last run: ${state.lastRunSummary}`
          : "Waiting for a run to be triggered (tick X1)..."
        : "Run in progress, waiting for the next row...";
    }
  }

  setInterval(poll, 1500);
  poll();
})();
