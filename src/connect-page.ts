// /connect: onboarding for a household's own charger. Pick the brand, type the
// serial number, enter the address in the brand's app or portal, then the page
// waits until the charger dials in over OCPP. The steps per brand are the same
// facts as the connection_guide tool, written for a person.
import { esc, shell, type Lang } from "./pages.ts";
import { rail, SETUP_CSS } from "./setup-page.ts";

/** keyInUrl: the charger has no password field, so the password goes in the address. */
type Brand = { name: string; where?: string; serialHint?: string; steps?: string[]; note?: string; blocked?: string; keyInUrl?: boolean };

const BRANDS: Record<Lang, Record<string, Brand>> = {
  da: {
    zaptec: {
      name: "Zaptec Go / Pro",
      where: "Zaptec Portal",
      serialHint: "Det står i Zaptec-appen under laderens detaljer og på selve laderen, fx ZAP012345.",
      steps: [
        "Log ind på portal.zaptec.com som ejer af installationen (eller bed din installatør om det).",
        "Gå til Installation › Indstillinger › Godkendelse, og slå OCPP til.",
        "Vælg laderen › Indstillinger › OCPP, og indsæt adressen og id'et herunder. Gem.",
      ],
      note: "Zaptecs egen smart-opladning og styring i appen slås fra, mens OCPP er slået til. LadeMCP tager over.",
    },
    easee: {
      name: "Easee Home / Charge / Lite",
      where: "Easee",
      serialHint: "Det står i Easee-appen under laderen og på selve laderen, fx EH012345.",
      steps: [
        "Laderen skal være på Wi-Fi og have firmware 344 eller nyere. Det kan ses i Easee-appen.",
        "Direct OCPP er i beta og slås til gennem Easees API eller en app, der bruger det.",
        "Indsæt adressen og id'et herunder, og gem.",
      ],
      note: "Laderen bliver ved med at rapportere til Easee Cloud ved siden af.",
    },
    wallbox: {
      name: "Wallbox Pulsar Plus / Max",
      where: "myWallbox-appen",
      serialHint: "Det står i myWallbox-appen under laderens indstillinger og på typeskiltet.",
      steps: [
        "Åbn myWallbox-appen, og forbind til laderen.",
        "Gå til laderen › Indstillinger › OCPP.",
        "Slå WebSocket-forbindelsen til, indsæt adressen og id'et herunder, og gem.",
      ],
      note: "Nogle funktioner i Wallbox-appen er sat på pause, mens OCPP er slået til.",
    },
    zappi: {
      name: "myenergi zappi",
      where: "myenergi-appen",
      serialHint: "Det står i myenergi-appen og på typeskiltet. Det skal starte med 2, så har laderen indbygget Wi-Fi.",
      steps: [
        "Tjek i myenergi-appen, at firmwaren er 5.114 eller nyere. Opladningsplaner kræver 5.5.",
        "Find OCPP under laderens indstillinger i myenergi-appen.",
        "Indsæt adressen og id'et herunder, og gem.",
      ],
      note: "myenergi-appen virker stadig ved siden af.",
    },
    evbox: {
      name: "EVBox Elvi",
      where: "EVBox Connect-appen",
      serialHint: "Det står i EVBox Connect-appen og på typeskiltet på laderen.",
      keyInUrl: true,
      steps: [
        "Laderen skal være på Wi-Fi og have firmware 424 eller nyere.",
        "Åbn EVBox Connect-appen, forbind til laderen over Bluetooth, og skift til installationstilstand med koden, der fulgte med laderen.",
        "Gå til »Charging management platform« › »Other backend URL«.",
        "Indsæt adressen herunder, og gem. Adgangskoden er en del af adressen, og den skal slutte med /.",
      ],
      note: "Laderen kan kun tale med én platform ad gangen. Afregnes din opladning i dag gennem fx Monta eller din arbejdsgiver, stopper det.",
    },
    other: {
      name: "Anden ladestander",
      where: "ladestanderens app",
      serialHint: "Det står som regel på typeskiltet eller i producentens app.",
      steps: [
        "Find OCPP-indstillingerne i ladestanderens app eller portal. Den skal kunne OCPP 1.6J.",
        "Indsæt adressen og id'et herunder, og gem.",
      ],
    },
    clever: { name: "Clever", blocked: "Clever-ladere taler kun med Clevers egen server, så LadeMCP kan ikke nå dem. Det samme gælder de fleste leasede ladere." },
    tesla: { name: "Tesla Wall Connector", blocked: "Tesla Wall Connector Gen 3 har ikke OCPP, så den kan ikke tilsluttes. Styring gennem bilen i stedet er på vej." },
    livo: { name: "EVBox Livo", blocked: "EVBox har lukket for, at Livo kan forbindes til andre platforme end dem, EVBox selv har aftaler med. Den kan derfor ikke tilsluttes LadeMCP." },
  },
  en: {
    zaptec: {
      name: "Zaptec Go / Pro",
      where: "Zaptec Portal",
      serialHint: "It is in the Zaptec app under the charger's details and on the charger itself, e.g. ZAP012345.",
      steps: [
        "Log in to portal.zaptec.com as the installation owner (or ask your installer).",
        "Go to Installation › Settings › Authentication and turn on OCPP.",
        "Choose the charger › Settings › OCPP, enter the address and id below, and save.",
      ],
      note: "Zaptec's own smart charging and app control turn off while OCPP is on. LadeMCP takes over.",
    },
    easee: {
      name: "Easee Home / Charge / Lite",
      where: "Easee",
      serialHint: "It is in the Easee app under the charger and on the charger itself, e.g. EH012345.",
      steps: [
        "The charger has to be on Wi-Fi with firmware 344 or later. The Easee app shows it.",
        "Direct OCPP is in beta and is switched on through Easee's API or an app that uses it.",
        "Enter the address and id below, and save.",
      ],
      note: "The charger keeps reporting to Easee Cloud alongside.",
    },
    wallbox: {
      name: "Wallbox Pulsar Plus / Max",
      where: "the myWallbox app",
      serialHint: "It is in the myWallbox app under the charger's settings and on the rating plate.",
      steps: [
        "Open the myWallbox app and connect to the charger.",
        "Go to the charger › Settings › OCPP.",
        "Turn on the WebSocket connection, enter the address and id below, and save.",
      ],
      note: "Some Wallbox app features pause while OCPP is on.",
    },
    zappi: {
      name: "myenergi zappi",
      where: "the myenergi app",
      serialHint: "It is in the myenergi app and on the rating plate. It has to start with 2, meaning built-in Wi-Fi.",
      steps: [
        "Check in the myenergi app that the firmware is 5.114 or later. Charging schedules need 5.5.",
        "Find OCPP in the charger's settings in the myenergi app.",
        "Enter the address and id below, and save.",
      ],
      note: "The myenergi app keeps working alongside.",
    },
    evbox: {
      name: "EVBox Elvi",
      where: "the EVBox Connect app",
      serialHint: "It is in the EVBox Connect app and on the charger's rating plate.",
      keyInUrl: true,
      steps: [
        "The charger has to be on Wi-Fi with firmware 424 or later.",
        "Open the EVBox Connect app, connect to the charger over Bluetooth, and switch to installation mode with the code that came with the charger.",
        "Go to “Charging management platform” › “Other backend URL”.",
        "Paste the address below and save. The password is part of the address, and it has to end with /.",
      ],
      note: "The charger can only talk to one platform at a time. If your charging is billed through Monta or your employer today, that stops.",
    },
    other: {
      name: "Another charger",
      where: "the charger's app",
      serialHint: "It is usually on the rating plate or in the maker's app.",
      steps: ["Find the OCPP settings in the charger's app or portal. It has to support OCPP 1.6J.", "Enter the address and id below, and save."],
    },
    clever: { name: "Clever", blocked: "Clever chargers only talk to Clever's own server, so LadeMCP cannot reach them. The same goes for most leased chargers." },
    tesla: { name: "Tesla Wall Connector", blocked: "The Tesla Wall Connector Gen 3 has no OCPP, so it cannot connect. Control through the car instead is on the way." },
    livo: { name: "EVBox Livo", blocked: "EVBox has closed the Livo to platforms other than the ones EVBox has agreements with, so it cannot connect to LadeMCP." },
  },
};

const T = {
  da: {
    title: "Tilslut ladestander",
    intro: "LadeMCP styrer ladestanderen over OCPP, en åben standard. Du skriver en adresse ind i ladestanderens app én gang, og så ringer den selv op.",
    which: "Hvilken ladestander har du?",
    cannot: "Kan ikke tilsluttes",
    cannotHead: (n: string) => `${n} kan ikke tilsluttes endnu`,
    step: (n: number) => `Trin ${n} af 3`,
    serialHead: "Hvad er serienummeret?",
    serialLabel: "Serienummer",
    serialBad: "Brug 3 til 64 tegn: bogstaver, tal, punktum, bindestreg eller understreg.",
    serialNote: "Skriv det præcis, som det står. Det bliver ladestanderens id.",
    next: "Fortsæt",
    back: "Tilbage",
    setupHead: (w: string) => `Indtast adressen i ${w}`,
    address: "Adresse",
    id: "Ladestander-id",
    password: "Adgangskode",
    oneField: "Har appen kun ét felt? Brug hele adressen:",
    copy: "Kopiér",
    copied: "Kopieret",
    local: "Serveren kører kun på denne computer (localhost), så en rigtig ladestander kan ikke nå den. Kør den på en offentlig adresse, eller prøv med simulatoren:",
    saved: "Jeg har gemt det",
    waiting: "Venter",
    waitHead: "Venter på, at ladestanderen melder sig",
    waitBody: "Det tager som regel under et minut, efter du har gemt. Lad siden stå åben.",
    slow: "Sker der ikke noget?",
    slowTips: ["Tjek, at hele adressen er kopieret, også wss://.", "Id'et skal være præcis serienummeret.", "Ladestanderen skal være online (Wi-Fi eller kabel).", "Nogle ladere forbinder først efter en genstart."],
    backToSetup: "Tilbage til opsætningen",
    connected: "Forbundet",
    doneHead: (n: string) => `${n} er forbundet`,
    doneBody: (by: string, kwh: string) => `Hver gang bilen sættes i, lægger LadeMCP en plan: de billigste kvarterer, ${kwh} kWh klar kl. ${by}.`,
    doneNote: "Indstillingerne på forsiden gemmes ikke på ladestanderen endnu.",
    seePlan: "Se planen",
    continueSetup: "Fortsæt",
  },
  en: {
    title: "Connect a charger",
    intro: "LadeMCP controls the charger over OCPP, an open standard. You enter an address in the charger's app once, and from then on it dials in by itself.",
    which: "Which charger do you have?",
    cannot: "Cannot connect",
    cannotHead: (n: string) => `${n} cannot connect yet`,
    step: (n: number) => `Step ${n} of 3`,
    serialHead: "What is the serial number?",
    serialLabel: "Serial number",
    serialBad: "Use 3 to 64 characters: letters, digits, dot, hyphen or underscore.",
    serialNote: "Type it exactly as written. It becomes the charger's id.",
    next: "Continue",
    back: "Back",
    setupHead: (w: string) => `Enter the address in ${w}`,
    address: "Address",
    id: "Charger id",
    password: "Password",
    oneField: "Only one field in the app? Use the full address:",
    copy: "Copy",
    copied: "Copied",
    local: "This server only runs on this computer (localhost), so a real charger cannot reach it. Run it on a public address, or try the simulator:",
    saved: "I have saved it",
    waiting: "Waiting",
    waitHead: "Waiting for the charger to check in",
    waitBody: "It usually takes less than a minute after you save. Keep this page open.",
    slow: "Nothing happening?",
    slowTips: ["Check the whole address was copied, including wss://.", "The id has to be exactly the serial number.", "The charger has to be online (Wi-Fi or cable).", "Some chargers only connect after a restart."],
    backToSetup: "Back to the setup",
    connected: "Connected",
    doneHead: (n: string) => `${n} is connected`,
    doneBody: (by: string, kwh: string) => `Every time the car is plugged in, LadeMCP makes a plan: the cheapest quarter-hours, ${kwh} kWh ready by ${by}.`,
    doneNote: "The settings on the front page are not saved to the charger yet.",
    seePlan: "See the plan",
    continueSetup: "Continue",
  },
};

function clientStrings(lang: Lang): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(T[lang])) out[k] = typeof v === "function" ? (v as (...a: unknown[]) => string)("{0}", "{1}") : v;
  return out;
}

const CSS = `<style>
  .step{animation:step-in 350ms var(--ease) both}
  @keyframes step-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.step{animation:none}}
  ul.rows button.pick{all:unset;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;width:100%;padding:6px 0;cursor:pointer}
  ul.rows button.pick:focus-visible{outline:2px solid var(--ok);outline-offset:2px;border-radius:6px}
  label.field{display:block;font-weight:500;font-size:14px;margin:18px 0 6px}
  input.text{width:100%;font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
  input.text:focus{outline:2px solid var(--ink);outline-offset:1px;border-color:transparent}
  code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
  ol.how{margin:16px 0 0;padding-left:20px}ol.how li{margin:0 0 8px;padding-left:4px}
  ul.rows li.kv{flex-wrap:wrap;gap:4px 16px}
  ul.rows li.kv code{flex:1;min-width:0;text-align:right;color:var(--muted)}
  button.copy{padding:4px 10px;font-size:12px;border-radius:999px;background:var(--line);color:var(--ink)}
  .box{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:16px 0 0;font-size:13px}
  .box.error{border-color:var(--err)}
  .link{background:none;color:var(--muted);padding:8px 0 0;font-weight:400;font-size:14px;text-decoration:underline;text-underline-offset:3px}
  .err{color:var(--err);font-size:13px;margin:6px 0 0;min-height:1.2em}
</style>`;

export function connectPage(lang: Lang, opts: { ocppBase: string; reachable: boolean; password: string; setup: boolean }): string {
  const t = T[lang];
  const brands = BRANDS[lang];
  const picks = Object.entries(brands)
    .map(([key, b]) => `<li><button class="pick" data-brand="${key}"><span>${esc(b.name)}</span><span class="chev"></span></button></li>`)
    .join("");
  const simulate = `npm run simulate -- ${opts.ocppBase.replace(/\/$/, "")} <span class="sid"></span>`;
  const body = `${opts.setup ? SETUP_CSS + rail(lang, "charger") : ""}${CSS}
  <div class="card step" data-step="brand">
    <div class="pill">${t.title}</div>
    <h1>${t.which}</h1>
    <p class="muted">${t.intro}</p>
    <ul class="rows">${picks}</ul>
  </div>

  <div class="card step" data-step="blocked" hidden>
    <div class="pill error">${t.cannot}</div>
    <h1 id="blockedHead"></h1>
    <p class="muted" id="blockedBody"></p>
    <button class="ghost full" data-go="brand">${t.back}</button>
  </div>

  <form class="card step" data-step="serial" hidden novalidate>
    <div class="pill">${t.step(1)} · <span class="bname"></span></div>
    <h1>${t.serialHead}</h1>
    <p class="muted" id="serialHint"></p>
    <label class="field" for="serial">${t.serialLabel}</label>
    <input class="text" id="serial" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="64" required>
    <p class="err" id="serialErr"></p>
    <p class="muted small">${t.serialNote}</p>
    <button class="full" type="submit">${t.next}</button>
    <button class="link" type="button" data-go="brand">${t.back}</button>
  </form>

  <div class="card step" data-step="setup" hidden>
    <div class="pill">${t.step(2)} · <span class="bname"></span></div>
    <h1 id="setupHead"></h1>
    ${opts.reachable ? "" : `<div class="box error">${t.local}<br><code>${simulate}</code></div>`}
    <ol class="how" id="how"></ol>
    <ul class="rows">
      <li class="kv"><span>${t.address}</span><code id="addr">${esc(opts.ocppBase)}</code><button class="copy" id="copyAddr" data-copy="${esc(opts.ocppBase)}">${t.copy}</button></li>
      <li class="kv"><span>${t.id}</span><code class="sid"></code><button class="copy" id="copyId">${t.copy}</button></li>
      <li class="kv" id="pwRow"><span>${t.password}</span><code>${esc(opts.password)}</code><button class="copy" data-copy="${esc(opts.password)}">${t.copy}</button></li>
    </ul>
    <p class="muted small" style="margin-top:12px" id="oneField">${t.oneField}<br><code id="fullUrl"></code></p>
    <p class="muted small" id="note"></p>
    <button class="full" data-go="wait">${t.saved}</button>
    <button class="link" type="button" data-go="serial">${t.back}</button>
  </div>

  <div class="card step" data-step="wait" hidden aria-live="polite">
    <div class="pill loading">${t.step(3)} · ${t.waiting}</div>
    <h1>${t.waitHead}</h1>
    <p class="muted">${t.waitBody}</p>
    <div id="slow" hidden><p class="small" style="font-weight:500;margin:18px 0 6px">${t.slow}</p><div class="warn">${t.slowTips.map((x) => `<p>${esc(x)}</p>`).join("")}</div></div>
    <button class="link" type="button" data-go="setup">${t.backToSetup}</button>
  </div>

  <div class="card step" data-step="done" hidden>
    <div class="pill ok">${t.connected}</div>
    <h1 id="doneHead"></h1>
    <p id="doneBody"></p>
    ${opts.setup ? `<a class="btn full" href="/setup">${t.continueSetup}</a>` : `<p class="muted small">${t.doneNote}</p>\n    <a class="btn full" href="/">${t.seePlan}</a>`}
  </div>
<script>
const T = ${JSON.stringify(clientStrings(lang))};
const BRANDS = ${JSON.stringify(brands)};
const BASE = ${JSON.stringify(opts.ocppBase)};
// For chargers with no password field: the charger adds its own id after the last slash.
const KEYED = BASE + ${JSON.stringify(encodeURIComponent(opts.password))} + "/";
const LANG = ${JSON.stringify(lang)};
const fill = (s, ...a) => a.reduce((acc, v, i) => acc.replace("{" + i + "}", v), s);
const $ = (id) => document.getElementById(id);
const all = (sel) => [...document.querySelectorAll(sel)];
const state = { brand: "", id: "" };
let poll, slowTimer;

function show(step) {
  clearInterval(poll); clearTimeout(slowTimer);
  for (const el of all("[data-step]")) el.hidden = el.dataset.step !== step;
  window.scrollTo({ top: 0 });
  if (step === "serial") $("serial").focus();
  if (step === "wait") startWaiting();
}

function remember(extra) {
  try { localStorage.setItem("lade.charger", JSON.stringify({ id: state.id, brand: state.brand, ...extra })); } catch {}
}

for (const b of all("button.pick")) b.addEventListener("click", () => {
  state.brand = b.dataset.brand;
  const info = BRANDS[state.brand];
  for (const el of all(".bname")) el.textContent = info.name;
  if (info.blocked) {
    $("blockedHead").textContent = fill(T.cannotHead, info.name);
    $("blockedBody").textContent = info.blocked;
    return show("blocked");
  }
  $("serialHint").textContent = info.serialHint;
  $("setupHead").textContent = fill(T.setupHead, info.where);
  $("how").replaceChildren(...info.steps.map((s) => Object.assign(document.createElement("li"), { textContent: s })));
  $("note").textContent = info.note || "";
  const addr = info.keyInUrl ? KEYED : BASE;
  $("addr").textContent = addr;
  $("copyAddr").dataset.copy = addr;
  $("pwRow").hidden = $("oneField").hidden = Boolean(info.keyInUrl);
  show("serial");
});

for (const b of all("[data-go]")) b.addEventListener("click", () => show(b.dataset.go));

// Linked from energimcp.dk with the brand already chosen: start at the serial number.
const preset = new URLSearchParams(location.search).get("brand");
if (preset && Object.hasOwn(BRANDS, preset)) document.querySelector('button.pick[data-brand="' + preset + '"]').click();

document.querySelector("[data-step=serial]").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("serial").value.trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(id)) { $("serialErr").textContent = T.serialBad; return; }
  $("serialErr").textContent = "";
  state.id = id;
  for (const el of all(".sid")) el.textContent = id;
  $("fullUrl").textContent = BASE + encodeURIComponent(id);
  remember({});
  show("setup");
});

async function copy(btn, text) {
  try { await navigator.clipboard.writeText(text); btn.textContent = T.copied; setTimeout(() => (btn.textContent = T.copy), 1500); } catch {}
}
for (const b of all("button.copy[data-copy]")) b.addEventListener("click", () => copy(b, b.dataset.copy));
$("copyId").addEventListener("click", () => copy($("copyId"), state.id));

/** Chargers online before we started waiting; a new one shows up here even if its id is not quite the serial typed. */
async function online() {
  try { return (await (await fetch("/setup/chargers")).json()).filter((c) => c.connected).map((c) => c.id); } catch { return []; }
}

async function startWaiting() {
  $("slow").hidden = true;
  slowTimer = setTimeout(() => ($("slow").hidden = false), 120000);
  const before = new Set(await online());
  before.delete(state.id);
  const check = async () => {
    try {
      const fresh = (await online()).find((id) => id === state.id || !before.has(id));
      if (!fresh) return;
      state.id = fresh;
      const d = await (await fetch("/api/charger/" + encodeURIComponent(fresh))).json();
      if (!d.connected) return;
      const name = [d.vendor, d.model].filter(Boolean).join(" ") || BRANDS[state.brand].name;
      remember({ name });
      $("doneHead").textContent = fill(T.doneHead, name);
      $("doneBody").textContent = fill(T.doneBody, LANG === "da" ? d.ready_by.replace(":", ".") : d.ready_by, String(d.energy_kwh));
      show("done");
    } catch {}
  };
  check();
  poll = setInterval(check, 3000);
}
</script>`;
  return shell(lang, t.title, "/connect", body, `<p>LadeMCP · OCPP 1.6J</p>`);
}
