// ==UserScript==
// @name         IPO Assistant PRO (Recorder + Sync)
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Automates ASBA/IPO steps on mobile and syncs to GitHub
// @author       You & Gemini
// @match        *://*.icicibank.com/*
// @match        *://*.hdfcbank.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.github.com
// ==/UserScript==

(function () {
  "use strict";

  // --- CONFIGURATION ---
  // 1. Fill in your GitHub Username and Repo name
  const GITHUB_USER_REPO = "YOUR_USERNAME/YOUR_REPO_NAME"; // e.g., "keshavs03/ipo-assistant"

  // 2. Generate a Fine-Grained Personal Access Token on GitHub
  //    Permissions: Contents -> Read & Write (for your specific repo)
  const GITHUB_TOKEN = "YOUR_GITHUB_TOKEN_HERE"; // PASTE YOUR TOKEN

  const SELECTORS_FILE_PATH = "selectors.json";
  // --- END CONFIGURATION ---

  let isRecording = false;
  let recordedSteps = [];
  let selectorsData = {};
  let currentSha = null;

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
            <div id="ipo-buttons" style="margin-top:15px; display:flex; gap:10px;">
                 <button id="rec-btn" style="background:#c83a3a; color:white; border:none; padding:8px 12px; border-radius:8px; font-size:12px; cursor:pointer;">Record Flow</button>
                 <button id="sync-btn" style="background:#0f9d58; color:white; border:none; padding:8px 12px; border-radius:8px; font-size:12px; cursor:pointer; display:none;">Sync to GitHub</button>
            </div>
        `;
    document.body.appendChild(div);

    document.getElementById("rec-btn").onclick = toggleRecord;
    document.getElementById("sync-btn").onclick = syncToGitHub;

    document.addEventListener(
      "click",
      (e) => {
        if (!isRecording || e.target.closest("#" + div.id)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();

        const selector = getBestSelector(e.target);
        recordedSteps.push({
          step: recordedSteps.length + 1,
          action: "click",
          selector: selector,
        });
        e.target.style.outline = "3px solid #3b82f6";
        e.target.style.boxShadow = "0 0 20px #3b82f6";
        console.log(`Step ${recordedSteps.length}: Clicked -> ${selector}`);
      },
      true,
    );
  }

  function getBestSelector(el) {
    if (el.id) {
      return `#${el.id}`;
    }
    if (el.name) {
      return `[name='${el.name}']`;
    }
    if (el.getAttribute("data-testid")) {
      return `[data-testid='${el.getAttribute("data-testid")}']`;
    }

    // Fallback to a more robust XPath-like selector
    let path = [],
      parent;
    while ((parent = el.parentNode)) {
      let tag = el.tagName.toLowerCase();
      let siblings = Array.from(parent.children).filter(
        (e) => e.tagName === el.tagName,
      );
      let index = siblings.indexOf(el) + 1;
      let selector =
        tag + (siblings.length > 1 ? `:nth-of-type(${index})` : "");
      path.unshift(selector);
      el = parent;
      if (tag === "body") {
        break;
      }
    }
    return path.join(" > ");
  }

  function toggleRecord() {
    isRecording = !isRecording;
    const recBtn = document.getElementById("rec-btn");
    const syncBtn = document.getElementById("sync-btn");
    const recIndicator = document.getElementById("rec-indicator");

    if (isRecording) {
      recordedSteps = [];
      recBtn.innerText = "Stop Recording";
      recBtn.style.background = "#555";
      syncBtn.style.display = "none";
      recIndicator.style.display = "inline";
      alert(
        "RECORDING STARTED\nClick the elements on the page in the correct order.",
      );
    } else {
      recBtn.innerText = "Record Flow";
      recBtn.style.background = "#c83a3a";
      syncBtn.style.display = "inline-block";
      recIndicator.style.display = "none";
      if (recordedSteps.length > 0) {
        alert(
          `RECORDING STOPPED\n${recordedSteps.length} steps captured. Click "Sync to GitHub" to save.`,
        );
      }
    }
  }

  async function syncToGitHub() {
    if (recordedSteps.length === 0) {
      alert("No steps were recorded. Please record a flow first.");
      return;
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
            resolve(JSON.parse(response.responseText));
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
  if (window.location.hash.includes("#apply-ipo")) {
    // Wait for the page to be somewhat loaded
    setTimeout(createUI, 2000);
  }
})();
