# Fieldnote

Field notes in, a handover brief out. Fieldnote turns messy site-visit notes into a
summary, a list of actions with owners, and the risks nobody wrote down — running on
the device in front of you when it can, and in the cloud when it can't.

Built for **#BuildHybridAI 2026** with **Firebase AI Logic hybrid inference**.

## Why hybrid

A field worker is often the person with the least reliable connection. Sending notes
about a broken pump to a datacentre just to get a summary back is the wrong trade.
On-device inference is fast, private, free and works with the network off. But Gemini
Nano is not on every machine. So the same call site asks for the best available
engine: on-device first, cloud when the device has nothing to offer.

Fieldnote makes that decision visible instead of hiding it. Every answer wears a
badge — `on-device · gemini nano` or `cloud · gemini 3 flash` — and the history panel
keeps the last six runs with engine, latency and mode, so you can see the SDK switch
engines on the same prompt.

## How it uses Firebase AI Logic

All inference goes through the Firebase AI Logic SDK. There is no direct call to any
model API anywhere in this repo.

```js
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, InferenceSource } from "firebase/ai";

initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

const ai = getAI(app);

const model = getGenerativeModel(ai, {
  mode: "prefer_on_device",                       // HybridParams.mode
  inCloudParams: {
    model: "gemini-3-flash-preview",
    generationConfig: { maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } },
  },
});

await model.initializeDeviceModel((progress) => {
  // first run downloads Gemini Nano; progress is 0..1
});

const response = await model.generateContent(prompt);
response.response.text();             // the answer
response.response.inferenceSource;    // InferenceSource.ON_DEVICE | IN_CLOUD
```

The four modes in the picker map straight onto `InferenceMode`:

| UI | `mode` |
| --- | --- |
| Prefer on-device, fall back to cloud | `prefer_on_device` |
| Only on-device (offline guarantee) | `only_on_device` |
| Prefer cloud, fall back to on-device | `prefer_in_cloud` |
| Only in cloud | `only_in_cloud` |

Two details worth knowing:

- **Initialising the device model needs a real user gesture.** Chrome refuses to
  start the Gemini Nano download from a scripted click, so the `Enable on-device
  model` button exists and `prepareDevice()` runs from its handler.
- **Chromium builds without the model still answer.** They ship a stub that echoes
  the prompt back. `readReply()` detects that reply and treats it as "no device
  model", falling back to the cloud rather than showing the user an echo.

Cloud failures fall the other way: if the network dies mid-run, Fieldnote re-runs the
prompt with `only_on_device` and says so in the status line.

## App Check

Firebase AI Logic requires App Check. This deployment uses reCAPTCHA Enterprise and is
registered against a site key scoped to the production host.

For local development, App Check debug tokens are the supported path:

```bash
# .env.local
VITE_APPCHECK_DEBUG_TOKEN=<token from App Check > Apps > my-ai-app > Manage debug tokens>
```

The debug token is only read when `import.meta.env.DEV` is true, so it is not part of
the production bundle.

## Run it

```bash
npm install
npm run dev       # http://localhost:5199
npm run build     # static bundle in dist/
npm run preview   # serve the built bundle
```

The first on-device run downloads the model (a few GB) and asks for a click to start.
Until then, `prefer_on_device` answers in the cloud.

Requirements: Chrome 138+ on a machine that supports Gemini Nano for on-device
inference; any modern browser for the cloud path.

## Layout

```
index.html        markup: notes, mode picker, result, engine history
src/main.js       Firebase init, App Check, hybrid calls, fallbacks
src/style.css     dark two-column layout
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
