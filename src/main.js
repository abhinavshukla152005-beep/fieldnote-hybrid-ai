import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, InferenceSource } from "firebase/ai";

const firebaseConfig = {
  apiKey: "AIzaSyBXQcGS4e1I1N4axd8t2_s4BpRYG8tPiFQ",
  authDomain: "default-gemini-project-98b1f.firebaseapp.com",
  projectId: "default-gemini-project-98b1f",
  storageBucket: "default-gemini-project-98b1f.firebasestorage.app",
  messagingSenderId: "163668924289",
  appId: "1:163668924289:web:298d2b76ed83fa8e637a80",
};

const CLOUD_MODEL = "gemini-3-flash-preview";
const APP_CHECK_SITE_KEY = "6LdgYhouAAAAAF-TOP8VHzFbtoF0u9zkNXIC1Ugf";

const PROMPT = (notes) => `You are a field-notes analyst preparing a handover brief.

Return exactly these three sections and nothing else:
SUMMARY:
- two bullets, each under 20 words
ACTIONS:
- [ ] action — owner, deadline
RISKS:
- one or two bullets

Rules: under 130 words total, plain text, no markdown headings beyond the labels above. Use only facts in the notes. If an action has no named owner write "unassigned"; if there is no deadline write "no date given". Never invent a name, a date or a number.

NOTES:
${notes}`;

if (import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}

// The App Check SDK loads enterprise.js with `render=explicit`, which leaves the
// site key unregistered so its execute(siteKey) call fails. Loading the script
// with our key first registers it, and the SDK then reuses window.grecaptcha.
async function registerRecaptchaKey() {
  if (self.grecaptcha?.enterprise) return;
  await new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${APP_CHECK_SITE_KEY}`;
    script.async = true;
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
  });
}

await registerRecaptchaKey();

const app = initializeApp(firebaseConfig);
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
const ai = getAI(app);

const $ = (id) => document.getElementById(id);
const notesEl = $("notes");
const modeEl = $("mode");
const runEl = $("run");
const enableEl = $("enable");
const statusEl = $("status");
const resultEl = $("result");
const badgeEl = $("badge");
const metaEl = $("meta");
const historyEl = $("history");
const netEl = $("net");
const deviceEl = $("device");

let deviceReady = false;
const runs = [];

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function buildModel(mode) {
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: {
        maxOutputTokens: 600,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
  });
}

function paintNet() {
  const online = navigator.onLine;
  netEl.textContent = online ? "online" : "offline";
  netEl.classList.toggle("offline", !online);
}
addEventListener("online", paintNet);
addEventListener("offline", paintNet);
paintNet();

const DEVICE_LABELS = {
  available: ["on-device: ready", "ready"],
  downloading: ["on-device: downloading", "pending"],
  downloadable: ["on-device: needs download", "pending"],
  unavailable: ["on-device: not supported", ""],
};

let deviceState = "checking";

function paintDevice(state) {
  deviceState = state;
  const [label, cls] = DEVICE_LABELS[state] ?? ["on-device: checking", ""];
  deviceEl.textContent = label;
  deviceEl.className = `net ${cls}`.trim();
}

// A browser without the model installed can leave availability() pending
// indefinitely, so don't let the chip sit on "checking" forever.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function inspectDevice() {
  if (typeof LanguageModel === "undefined") return paintDevice("unavailable");
  try {
    paintDevice(await withTimeout(LanguageModel.availability(), 4000));
  } catch (err) {
    paintDevice(err.message === "timeout" ? "downloadable" : "unavailable");
  }
}
inspectDevice();

// A stalled model download would otherwise leave the UI on "Preparing…" forever,
// so give up once the download stops reporting progress.
async function runWithStallWatch(task, ms = 15000) {
  let last = Date.now();
  let abort;
  const guard = new Promise((_, reject) => {
    abort = reject;
  });
  const timer = setInterval(() => {
    if (Date.now() - last > ms) abort(new Error("stalled"));
  }, 1000);
  try {
    return await Promise.race([task(() => (last = Date.now())), guard]);
  } finally {
    clearInterval(timer);
  }
}

async function prepareDevice() {
  if (deviceReady) return true;
  enableEl.disabled = true;
  setStatus("Preparing on-device model… first run may download it.");
  try {
    const model = buildModel("only_on_device");
    await runWithStallWatch((onProgress) =>
      model.initializeDeviceModel((p) => {
        onProgress();
        setStatus(`Downloading on-device model… ${Math.round(p * 100)}%`);
      }),
    );
    deviceReady = true;
    paintDevice("available");
    setStatus("On-device model ready.");
    return true;
  } catch (err) {
    const needsGesture = /user gesture/i.test(err.message);
    setStatus(
      needsGesture
        ? "Press “Enable on-device model” yourself — Chrome only starts the download from a real click."
        : err.message === "stalled"
          ? "The on-device model stopped responding — this browser probably doesn't have it. Falling back to cloud."
          : `On-device model unavailable: ${err.message}`,
      true,
    );
    paintDevice("downloadable");
    return false;
  } finally {
    enableEl.disabled = false;
  }
}

enableEl.addEventListener("click", prepareDevice);

function renderRun({ text, source, ms, mode }) {
  const onDevice = source === InferenceSource.ON_DEVICE;
  badgeEl.textContent = onDevice ? "on-device · gemini nano" : "cloud · gemini 3 flash";
  badgeEl.className = `badge ${onDevice ? "device" : "cloud"}`;
  metaEl.textContent = `${ms} ms · mode: ${mode}${onDevice ? " · data never left this device" : " · sent to Firebase AI Logic"}`;
  resultEl.textContent = text;

  runs.unshift({ source: onDevice ? "device" : "cloud", ms, mode, at: new Date() });
  historyEl.innerHTML = runs
    .slice(0, 6)
    .map(
      (r) =>
        `<li><span class="pill ${r.source}">${r.source === "device" ? "on-device" : "cloud"}</span>` +
        `<span>${r.at.toLocaleTimeString()}</span><span>${r.ms} ms</span><span>${r.mode}</span></li>`,
    )
    .join("");
}

// Chromium builds without the model component still expose the API and answer by
// echoing the prompt back, so the reply has to be checked before it is trusted.
const ECHO_REPLY = /just echoing back the input|not available in Chromium/i;

function readReply(response) {
  const text = response.response.text();
  if (ECHO_REPLY.test(text)) {
    const err = new Error("This browser has no on-device model installed.");
    err.code = "device-stub";
    throw err;
  }
  return text;
}

function paintFailure(message, ms) {
  badgeEl.textContent = "failed";
  badgeEl.className = "badge fail";
  metaEl.textContent = `${ms} ms`;
  resultEl.textContent = message;
  setStatus(message, true);
}

async function analyse() {
  const notes = notesEl.value.trim();
  if (!notes) {
    setStatus("Add some notes first.", true);
    return;
  }

  runEl.disabled = true;
  resultEl.textContent = "Thinking…";
  const mode = modeEl.value;
  const started = performance.now();

  try {
    if (mode !== "only_in_cloud" && mode !== "prefer_in_cloud" && !deviceReady) {
      const localModelUsable = deviceState === "available" || deviceState === "downloading";
      if (localModelUsable) {
        await prepareDevice();
      } else if (mode === "only_on_device") {
        resultEl.textContent = "Nothing available offline.";
        setStatus(
          "This browser can't run the on-device model yet — press “Enable on-device model” first, then try again.",
          true,
        );
        return;
      }
    }
    // Asking the SDK to prefer the device it could not initialise just stalls the
    // request, so route to the cloud ourselves when no local model is usable.
    const routedMode = mode === "prefer_on_device" && !deviceReady ? "prefer_in_cloud" : mode;
    const response = await buildModel(routedMode).generateContent(PROMPT(notes));
    const ms = Math.round(performance.now() - started);
    renderRun({ text: readReply(response), source: response.response.inferenceSource, ms, mode });
    setStatus("Done.");
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const canFallBackToCloud = err.code === "device-stub" && !mode.startsWith("only_on_device");
    const canFallBackToDevice = deviceReady && !mode.startsWith("only_in_cloud") && err.code !== "device-stub";

    if (canFallBackToCloud) {
      setStatus("No on-device model here — answering in the cloud instead.");
      try {
        const retry = await buildModel("only_in_cloud").generateContent(PROMPT(notes));
        renderRun({
          text: readReply(retry),
          source: retry.response.inferenceSource,
          ms: Math.round(performance.now() - started),
          mode: "only_in_cloud (device unavailable)",
        });
        setStatus("Answered in the cloud because this browser has no on-device model.");
        return;
      } catch (retryErr) {
        paintFailure(retryErr.message, ms);
        return;
      }
    }

    if (canFallBackToDevice) {
      setStatus("Cloud call failed — retrying on-device.");
      try {
        const retry = await buildModel("only_on_device").generateContent(PROMPT(notes));
        renderRun({
          text: readReply(retry),
          source: retry.response.inferenceSource,
          ms: Math.round(performance.now() - started),
          mode: "only_on_device (auto-fallback)",
        });
        setStatus("Answered on-device after the cloud call failed.");
        return;
      } catch (retryErr) {
        paintFailure(`Both engines failed: ${retryErr.message}`, ms);
        return;
      }
    }

    paintFailure(err.message, ms);
  } finally {
    runEl.disabled = false;
  }
}

runEl.addEventListener("click", analyse);

$("sample").addEventListener("click", () => {
  notesEl.value = `Site visit: community hall roof leaking over the east corner, two of the four lights are dead. The projector cable is missing and the caretaker thinks it was borrowed for the sports day. Registration desk needs 40 more lanyards before Saturday. The internet line is down since Monday, the ISP ticket number is 88412. Someone should print the attendance sheets at the shop near the gate, they charge 2 rupees a page.`;
  setStatus("Sample loaded.");
});
