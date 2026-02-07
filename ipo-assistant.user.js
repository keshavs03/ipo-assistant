// ==UserScript==
// @name         IPO Assistant PRO (Recorder + Sync)
// @namespace    http://tampermonkey.net/
// @version      0.15
// @description  Automates ASBA/IPO steps on mobile and syncs to GitHub
// @author       You & Gemini
// @match        *://*.icicibank.com/*
// @match        *://*.icici.bank.in/*
// @match        *://*.hdfcbank.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.github.com
// @updateURL    https://keshavs03.github.io/ipo-assistant/ipo-assistant.user.js
// @downloadURL  https://keshavs03.github.io/ipo-assistant/ipo-assistant.user.js
// ==/UserScript==

(function () {
  "use strict";

  // --- CONFIGURATION ---
  // 1. Fill in your GitHub Username and Repo name
  const GITHUB_USER_REPO = "keshavs03/ipo-assistant"; // e.g., "keshavs03/ipo-assistant"

  // 2. Token is stored securely in Tampermonkey's local storage
  let GITHUB_TOKEN = GM_getValue("GITHUB_TOKEN", "");

  const SELECTORS_FILE_PATH = "selectors.json";
  // --- END CONFIGURATION ---

  let isRecording = GM_getValue("isRecording", false);
  let recordedSteps = GM_getValue("recordedSteps", []);
  let isPlaying = GM_getValue("isPlaying", false);
  let playIndex = GM_getValue("playIndex", 0);
  let cachedFlow = GM_getValue("cachedFlow", []);
  let stepRetries = 0;
  let selectorsData = {};
  let currentSha = null;

  // Validate execution context immediately
  validateContext();

  function createUI() {
    const div = document.createElement("div");
    div.id = "ipo-assistant-overlay";
    div.style.cssText =
      "position:fixed; bottom:20px; right:20px; z-index:10000; background:#111; color:white; padding:15px; border-radius:12px; font-family:sans-serif; border:1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5);";
    div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <b style="color:#3b82f6; font-size:14px;">IPO Assistant</b>
                <span id="rec-indicator" style="font-size:18px; display:none;">🔴</span>
            </div>
            <div id="ipo-buttons" style="margin-top:15px; display:flex; gap:10px; flex-wrap:wrap;">
                 <button id="rec-btn" style="background:#c83a3a; color:white; border:none; padding:8px 12px; border-radius:8px; font-size:12px; cursor:pointer;">Record Flow</button>
                 <button id="prev-btn" style="background:#555; color:white; border:none; padding:8px 12px; border-radius:8px; font-size:12px; cursor:pointer; display:none;">⏮️</button>
                 <button id="play-btn" style="background:#3b82f6; color:white; border:none; padding:8px 12px; border-radius:8px; font-size:12px; cursor:pointer;">📂 Load Flow</button>
                 <button id="next-btn" style="background:#555; color:white; border:none; padding:8px 12px; border-radius:8px; font-size:12px; cursor:pointer; display:none;">⏭️</button>
                 <button id="reset-btn" style="background:#777; color:white; border:none; padding:8px 12px; border-radius:8px; font-size:12px; cursor:pointer; display:none;">🗑️ Reset</button>
                 <button id="sync-btn" style="background:#0f9d58; color:white; border:none; padding:8px 12px; border-radius:8px; font-size:12px; cursor:pointer; display:none;">Sync to GitHub</button>
            </div>
            <div id="step-status" style="margin-top:10px; font-size:12px; color:#aaa; display:none; background:#222; padding:5px; border-radius:4px; border:1px solid #444; word-break:break-all;"></div>
        `;
    document.body.appendChild(div);

    document.getElementById("rec-btn").onclick = toggleRecord;
    document.getElementById("play-btn").onclick = togglePlayback;
    document.getElementById("prev-btn").onclick = stepPrev;
    document.getElementById("next-btn").onclick = stepNext;
    document.getElementById("reset-btn").onclick = () => resetFlow(false);
    document.getElementById("sync-btn").onclick = syncToGitHub;

    updateUIState();

    document.addEventListener(
      "click",
      (e) => {
        // Check global state in case stopped in another tab
        if (
          !GM_getValue("isRecording", false) ||
          e.target.closest("#" + div.id)
        ) {
          return;
        }
        // Removed preventDefault/stopPropagation to allow navigation/login

        // Refresh steps from storage to handle cross-tab flows
        recordedSteps = GM_getValue("recordedSteps", []);

        const selector = getBestSelector(e.target);
        recordedSteps.push({
          step: recordedSteps.length + 1,
          action: "click",
          selector: selector,
        });

        // Persist steps immediately so they survive redirects/new tabs
        GM_setValue("recordedSteps", recordedSteps);

        e.target.style.outline = "3px solid #3b82f6";
        e.target.style.boxShadow = "0 0 20px #3b82f6";
        console.log(`Step ${recordedSteps.length}: Clicked -> ${selector}`);
      },
      true,
    );

    // Listen for typing (Change events)
    document.addEventListener(
      "change",
      (e) => {
        if (
          !GM_getValue("isRecording", false) ||
          e.target.closest("#" + div.id)
        ) {
          return;
        }

        recordedSteps = GM_getValue("recordedSteps", []);
        const selector = getBestSelector(e.target);

        recordedSteps.push({
          step: recordedSteps.length + 1,
          action: "type",
          selector: selector,
          value: e.target.value,
        });

        GM_setValue("recordedSteps", recordedSteps);
        console.log(`Step ${recordedSteps.length}: Typed -> ${selector}`);
      },
      true,
    );
  }

  function updateUIState() {
    const recBtn = document.getElementById("rec-btn");
    const playBtn = document.getElementById("play-btn");
    const prevBtn = document.getElementById("prev-btn");
    const nextBtn = document.getElementById("next-btn");
    const resetBtn = document.getElementById("reset-btn");
    const syncBtn = document.getElementById("sync-btn");
    const recIndicator = document.getElementById("rec-indicator");
    const statusDiv = document.getElementById("step-status");
    const lastError = GM_getValue("lastError", null);

    // Default Reset
    recBtn.style.display = "inline-block";
    playBtn.style.display = "inline-block";
    prevBtn.style.display = "none";
    nextBtn.style.display = "none";
    resetBtn.style.display = "none";
    syncBtn.style.display = "none";
    recIndicator.style.display = "none";
    statusDiv.style.display = "none";

    recBtn.innerText = "Record Flow";
    recBtn.style.background = "#c83a3a";
    playBtn.innerText = "📂 Load Flow";
    playBtn.style.background = "#3b82f6";
    statusDiv.style.color = "#aaa"; // Default gray

    if (isRecording) {
      recBtn.innerText = "Stop Recording";
      recBtn.style.background = "#555";
      playBtn.style.display = "none";
      recIndicator.style.display = "inline";
    } else if (isPlaying) {
      recBtn.style.display = "none";
      playBtn.innerText = "⏹️ Stop";
      playBtn.style.background = "#ef4444";
      statusDiv.style.display = "block";
      const step = cachedFlow[playIndex];
      statusDiv.innerText = `Running Step ${playIndex + 1}/${cachedFlow.length}\nTarget: ${step ? step.selector : "..."}`;
    } else if (lastError) {
      // ERROR STATE
      recBtn.style.display = "inline-block";
      recBtn.innerText = "🔴 Fix from here"; // Smart Context

      playBtn.innerText = "🔄 Retry";

      prevBtn.style.display = "inline-block";
      nextBtn.style.display = "inline-block";
      statusDiv.style.display = "block";
      statusDiv.style.color = "#ef4444"; // Red for error
      statusDiv.innerText = lastError;
    } else if (cachedFlow.length > 0) {
      // Manual / Paused Mode
      recBtn.style.display = "inline-block";
      recBtn.innerText = "🔴 Rec from here";

      prevBtn.style.display = "inline-block";
      nextBtn.style.display = "inline-block";
      playBtn.innerText = "▶️ Start Auto";
      statusDiv.style.display = "block";

      const step = cachedFlow[playIndex];
      const selectorInfo = step ? step.selector : "End";
      statusDiv.innerText = `Paused: Step ${playIndex + 1}/${cachedFlow.length}\nNext: ${selectorInfo}`;
    } else if (recordedSteps.length > 0) {
      syncBtn.style.display = "inline-block";
    }

    if (recordedSteps.length > 0 || cachedFlow.length > 0 || lastError) {
      resetBtn.style.display = "inline-block";
    }
  }

  function getBestSelector(el) {
    // 1. Data attributes (Test IDs) - Highest priority
    if (el.getAttribute("data-testid")) {
      return `[data-testid='${el.getAttribute("data-testid")}']`;
    }

    // 2. Name attribute (Common for inputs)
    if (el.name) {
      const selector = `[name='${el.name}']`;
      // Simple check if unique in document
      if (document.querySelectorAll(selector).length === 1) return selector;
    }

    // 4. Accessibility & Alt Attributes
    if (el.getAttribute("aria-label")) {
      const selector = `[aria-label='${el.getAttribute("aria-label")}']`;
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    if (el.getAttribute("alt")) {
      const selector = `[alt='${el.getAttribute("alt")}']`;
      if (document.querySelectorAll(selector).length === 1) return selector;
    }

    // 5. Stable Classes (New)
    if (el.classList && el.classList.length > 0) {
      const stableClasses = Array.from(el.classList).filter(isStableClass);
      if (stableClasses.length > 0) {
        // Try the most specific combination (Tag + Classes)
        const selector =
          el.tagName.toLowerCase() + "." + stableClasses.join(".");
        if (document.querySelectorAll(selector).length === 1) return selector;

        // Try individual stable classes if unique
        for (const cls of stableClasses) {
          if (document.querySelectorAll("." + cls).length === 1)
            return "." + cls;
        }
      }
    }

    // 3. ID - Only if it looks stable (no long sequences of numbers)
    if (el.id && !/\d{3,}/.test(el.id)) {
      return `#${el.id}`;
    }

    // 4. Input specific attributes (Placeholder is very stable for login forms)
    if (el.tagName.toLowerCase() === "input") {
      if (el.placeholder) {
        return `input[placeholder='${el.placeholder}']`;
      }
    }

    // Fallback to a more robust XPath-like selector
    let path = [],
      parent;
    let current = el;

    while ((parent = current.parentNode)) {
      const currentEl = current;
      let tag = currentEl.tagName.toLowerCase();

      // Optimization: If we hit a stable ID on a parent, use it as root
      if (currentEl !== el && currentEl.id && !/\d{3,}/.test(currentEl.id)) {
        path.unshift(`#${currentEl.id}`);
        break;
      }

      let siblings = Array.from(parent.children).filter(
        (e) => e.tagName === currentEl.tagName,
      );
      let index = siblings.indexOf(currentEl) + 1;
      let selector =
        tag + (siblings.length > 1 ? `:nth-of-type(${index})` : "");
      path.unshift(selector);
      current = parent;
      if (tag === "body" || tag === "html") break;
    }
    return path.join(" > ");
  }

  function isStableClass(className) {
    if (!className || typeof className !== "string") return false;
    if (className.length < 3) return false;
    // Filter out common dynamic patterns
    if (/^css-/.test(className)) return false; // Styled-components
    if (/^ng-/.test(className)) return false; // Angular
    if (/\d{3,}/.test(className)) return false; // Random numbers
    if (/^[a-z0-9]{10,}$/.test(className)) return false; // Random hash
    // Filter out common utility classes
    const blacklist = [
      "active",
      "focus",
      "hover",
      "visible",
      "hidden",
      "show",
      "hide",
      "flex",
      "grid",
      "block",
      "inline",
      "relative",
      "absolute",
      "fixed",
      "w-full",
      "h-full",
      "m-0",
      "p-0",
      "container",
      "row",
      "col",
      "btn",
      "button",
      "input",
      "form-control", // Too generic without context
    ];
    if (blacklist.includes(className)) return false;
    // Tailwind-like patterns (e.g., p-4, mt-2, text-center)
    if (/^[a-z]{1,2}-\d+$/.test(className)) return false;
    return true;
  }

  function toggleRecord() {
    // Smart "Record from here" logic (Fix or Branch off)
    if (!isRecording && cachedFlow.length > 0) {
      if (
        confirm(
          "Start recording from this step? This will discard the rest of the loaded flow.",
        )
      ) {
        // Inherit successful steps up to current point
        recordedSteps = cachedFlow.slice(0, playIndex);
        GM_setValue("recordedSteps", recordedSteps);
        GM_setValue("flowOrigin", window.location.hostname); // Update origin

        // Clear error/cache and start recording
        GM_setValue("lastError", null);
        GM_setValue("cachedFlow", []); // Clear cache to avoid state confusion
        cachedFlow = [];

        isRecording = true;
        GM_setValue("isRecording", true);
        updateUIState();
        return;
      } else {
        return; // Cancelled
      }
    }

    isRecording = !isRecording;
    GM_setValue("isRecording", isRecording);

    if (isRecording) {
      recordedSteps = [];
      GM_setValue("recordedSteps", recordedSteps);
      GM_setValue("flowOrigin", window.location.hostname); // Set origin
      alert(
        "RECORDING STARTED\nClick the elements on the page in the correct order.",
      );
    } else {
      if (recordedSteps.length > 0) {
        alert(
          `RECORDING STOPPED\n${recordedSteps.length} steps captured. Click "Sync to GitHub" to save.`,
        );
      }
    }
    updateUIState();
  }

  async function togglePlayback() {
    if (isPlaying) {
      // Stop Playback
      isPlaying = false;
      GM_setValue("isPlaying", false);
      updateUIState();
      return;
    }

    // Resume if paused
    if (cachedFlow.length > 0 && playIndex < cachedFlow.length) {
      isPlaying = true;
      GM_setValue("isPlaying", true);
      stepRetries = 0;
      GM_setValue("lastError", null); // Clear error on resume
      updateUIState();
      executeStep();
      return;
    }

    // Start Playback
    if (!GITHUB_TOKEN) {
      const input = prompt("Enter GitHub Token to fetch recorded steps:");
      if (!input) return;
      GITHUB_TOKEN = input.trim();
      GM_setValue("GITHUB_TOKEN", GITHUB_TOKEN);
    }

    try {
      const playBtn = document.getElementById("play-btn");
      playBtn.innerText = "Loading...";

      // 1. Fetch latest flow
      const fileData = await fetchFromGitHub();
      const allSelectors = JSON.parse(atob(fileData.content));
      const host = window.location.hostname.replace("www.", "");

      if (!allSelectors[host]) {
        alert(`No recorded flow found for ${host}`);
        playBtn.innerText = "📂 Load Flow";
        return;
      }

      // 2. Initialize State
      cachedFlow = allSelectors[host];
      GM_setValue("cachedFlow", cachedFlow);
      GM_setValue("flowOrigin", window.location.hostname); // Set origin

      isPlaying = false; // Start in Paused/Manual mode
      playIndex = 0;
      GM_setValue("isPlaying", false);
      GM_setValue("playIndex", 0);
      stepRetries = 0;
      GM_setValue("lastError", null);

      updateUIState();
    } catch (e) {
      alert("Error fetching flow: " + e.message);
      document.getElementById("play-btn").innerText = "▶️ Auto Apply";
    }
  }

  function executeStep() {
    if (!isPlaying) return;

    if (playIndex >= cachedFlow.length) {
      alert("✅ Automation Complete!");
      togglePlayback(); // Stop
      return;
    }

    const step = cachedFlow[playIndex];

    try {
      const el = document.querySelector(step.selector);

      if (el) {
        stepRetries = 0;
        console.log(`Executing Step ${step.step}: Clicking ${step.selector}`);

        // Visual Feedback
        const statusDiv = document.getElementById("step-status");
        if (statusDiv) {
          const actionText =
            step.action === "type" ? `Typing "${step.value}"` : "Clicking";
          statusDiv.innerText = `[${playIndex + 1}/${cachedFlow.length}] ${actionText}\n${step.selector}`;
        }

        el.style.outline = "3px solid #10b981"; // Green highlight
        el.scrollIntoView({ behavior: "smooth", block: "center" });

        setTimeout(() => {
          try {
            if (step.action === "type") {
              el.focus();
              el.value = step.value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.blur();
            } else if (el.tagName.toLowerCase() === "select") {
              // Dropdown handling
              el.value = step.value; // You might need to record value for selects too
              el.dispatchEvent(new Event("change", { bubbles: true }));
            } else {
              simulateClick(el);
            }

            playIndex++;
            GM_setValue("playIndex", playIndex);
            updateUIState();

            // Wait for navigation or next step
            setTimeout(executeStep, 2000);
          } catch (innerErr) {
            handleExecutionError(innerErr, step);
          }
        }, 500); // Small delay for visual feedback
      } else {
        // Element not found yet (loading?), retry in 1s
        stepRetries++;
        const statusDiv = document.getElementById("step-status");
        if (statusDiv) {
          statusDiv.style.display = "block";
          statusDiv.innerText = `[${playIndex + 1}/${cachedFlow.length}] Waiting (${stepRetries}/10)...\nTarget: ${step.selector}`;
        }
        if (stepRetries > 10) {
          throw new Error(`Element not found: ${step.selector}`);
        }
        console.log(`Waiting for element: ${step.selector}`);
        setTimeout(executeStep, 1000);
      }
    } catch (err) {
      handleExecutionError(err, step);
    }
  }

  function simulateClick(element) {
    const events = ["mousedown", "mouseup", "click"];
    events.forEach((eventType) => {
      const event = new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      element.dispatchEvent(event);
    });
  }

  function handleExecutionError(error, step) {
    isPlaying = false;
    GM_setValue("isPlaying", false);

    // Set persistent error state (no popup)
    GM_setValue("lastError", `⚠️ Error at Step ${step.step}: ${error.message}`);
    updateUIState();
  }

  function stepPrev() {
    if (playIndex > 0) {
      playIndex--;
      GM_setValue("playIndex", playIndex);
      GM_setValue("lastError", null); // Clear error on manual nav
      updateUIState();
      // Highlight previous element for visual confirmation
      const step = cachedFlow[playIndex];
      const el = document.querySelector(step.selector);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function stepNext() {
    if (playIndex < cachedFlow.length) {
      const step = cachedFlow[playIndex];
      const el = document.querySelector(step.selector);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "3px solid #eab308"; // Yellow for manual
        setTimeout(() => el.click(), 200);
        playIndex++;
        GM_setValue("playIndex", playIndex);
        GM_setValue("lastError", null); // Clear error on manual nav
        updateUIState();
      } else {
        if (confirm("Element not found. Skip this step?")) {
          playIndex++;
          GM_setValue("playIndex", playIndex);
          GM_setValue("lastError", null);
          updateUIState();
        }
      }
    } else {
      alert("End of flow.");
    }
  }

  function resetFlow(force = false) {
    const isSilent = typeof force === "boolean" && force === true;
    if (
      isSilent ||
      confirm("Reset everything? This clears current progress.")
    ) {
      isRecording = false;
      isPlaying = false;
      recordedSteps = [];
      cachedFlow = [];
      playIndex = 0;
      stepRetries = 0;
      GM_setValue("isRecording", false);
      GM_setValue("isPlaying", false);
      GM_setValue("recordedSteps", []);
      GM_setValue("cachedFlow", []);
      GM_setValue("playIndex", 0);
      GM_setValue("lastError", null);
      GM_setValue("flowOrigin", null);
      updateUIState();
    }
  }

  function validateContext() {
    const flowOrigin = GM_getValue("flowOrigin", null);
    const hasState =
      recordedSteps.length > 0 ||
      cachedFlow.length > 0 ||
      isRecording ||
      isPlaying;

    if (hasState && flowOrigin) {
      const currentHost = window.location.hostname;
      if (!isRelated(flowOrigin, currentHost)) {
        console.log(
          `[IPO Assistant] Context switch detected: ${flowOrigin} -> ${currentHost}. Resetting.`,
        );
        resetFlow(true); // Silent reset
      }
    }
  }

  function isRelated(h1, h2) {
    if (h1 === h2) return true;
    const s1 = h1.replace("www.", "").toLowerCase().split(/[.-]/);
    const s2 = h2.replace("www.", "").toLowerCase().split(/[.-]/);
    const common = [
      "bank",
      "online",
      "retail",
      "netbanking",
      "invest",
      "portal",
    ];

    // Check for shared significant tokens (len > 3) that are not common words
    // e.g. "icici" in "icicibank" matches. "icicibank" vs "hdfcbank" does not.
    return s1.some(
      (p1) =>
        p1.length > 3 &&
        !common.includes(p1) &&
        s2.some((p2) => p2.includes(p1) || p1.includes(p2)),
    );
  }

  async function syncToGitHub() {
    if (recordedSteps.length === 0) {
      alert("No steps were recorded. Please record a flow first.");
      return;
    }

    if (!GITHUB_TOKEN) {
      const input = prompt(
        "Please enter your GitHub Personal Access Token:\n(This will be saved securely in Tampermonkey)",
      );
      if (!input) return;
      GITHUB_TOKEN = input.trim();
      GM_setValue("GITHUB_TOKEN", GITHUB_TOKEN);
    }

    alert("Preparing to sync with GitHub...");

    // 1. Fetch the latest version of selectors.json
    try {
      const currentFile = await fetchFromGitHub();
      selectorsData = JSON.parse(atob(currentFile.content));
      currentSha = currentFile.sha;
    } catch (e) {
      console.log("No existing selectors.json found, creating a new one.");
      selectorsData = {};
    }

    // 2. Add or update the flow for the current bank
    const host = window.location.hostname.replace("www.", "");
    selectorsData[host] = recordedSteps;

    // 3. Push the updated file back to GitHub
    const newContent = btoa(JSON.stringify(selectorsData, null, 2)); // Base64 encode
    await updateGitHubFile(newContent);
  }

  function fetchFromGitHub() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://api.github.com/repos/${GITHUB_USER_REPO}/contents/${SELECTORS_FILE_PATH}`,
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
        onload: function (response) {
          if (response.status === 200) {
            resolve(JSON.parse(response.responseText));
          } else if (response.status === 401) {
            GM_setValue("GITHUB_TOKEN", "");
            GITHUB_TOKEN = "";
            alert(
              "❌ Error: Invalid GitHub Token. It has been cleared. Please click Sync again to enter a new one.",
            );
            reject(new Error("Unauthorized"));
          } else {
            reject(new Error(response.statusText));
          }
        },
        onerror: reject,
      });
    });
  }

  function updateGitHubFile(content) {
    return new Promise((resolve, reject) => {
      const body = {
        message: `[AUTO-SYNC] Updated IPO flow for ${window.location.hostname}`,
        content: content,
      };
      if (currentSha) {
        body.sha = currentSha;
      }

      GM_xmlhttpRequest({
        method: "PUT",
        url: `https://api.github.com/repos/${GITHUB_USER_REPO}/contents/${SELECTORS_FILE_PATH}`,
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        data: JSON.stringify(body),
        onload: function (response) {
          if (response.status === 200 || response.status === 201) {
            alert("✅ Success! Flow has been synced to your GitHub.");
            recordedSteps = [];
            GM_setValue("recordedSteps", []);
            resolve(JSON.parse(response.responseText));
          } else if (response.status === 401) {
            GM_setValue("GITHUB_TOKEN", "");
            GITHUB_TOKEN = "";
            alert(
              "❌ Error: Invalid GitHub Token. It has been cleared. Please click Sync again to enter a new one.",
            );
            reject(new Error("Unauthorized"));
          } else {
            alert(
              `❌ ERROR: Failed to sync.\nStatus: ${response.status}\nResponse: ${response.responseText}`,
            );
            reject(new Error(response.statusText));
          }
        },
        onerror: reject,
      });
    });
  }

  // --- Main Execution ---
  if (
    window.location.hash.includes("#apply-ipo") ||
    isRecording ||
    recordedSteps.length > 0 ||
    isPlaying ||
    cachedFlow.length > 0 ||
    GM_getValue("lastError", null)
  ) {
    // Wait for the page to be somewhat loaded
    setTimeout(createUI, 2000);
  }

  if (isPlaying) {
    setTimeout(executeStep, 2000);
  }
})();
