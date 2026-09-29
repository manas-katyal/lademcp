// /setup: the first thing the owner of a new server sees, and the only way to
// the rest of it until it is done. Three steps after claiming the server:
// price area, charger (the /connect flow), and adding the server to Claude.
// Afterwards the same address shows what was set up, including the secrets,
// so the owner can find them again.
import { esc, shell, type Lang } from "./pages.ts";

export type SetupStep = "area" | "charger" | "assistant";
const STEPS: SetupStep[] = ["area", "charger", "assistant"];

const T = {
  da: {
    title: "Opsætning",
    rail: { area: "Område", charger: "Ladestander", assistant: "Claude" } as Record<SetupStep, string>,
    railLabel: "Opsætningens trin",
    owner: {
      claim: { head: "Gør serveren til din", body: "Du er den første her, så serveren bliver din. Vælg en adgangskode, så du også kan komme ind fra andre enheder.", label: "Vælg en adgangskode" },
      login: { head: "Log ind", body: "Serveren er sat op. Skriv adgangskoden for at komme videre.", label: "Adgangskode" },
      password: { head: "Vælg en adgangskode", body: "Så kan du komme ind fra andre enheder end denne.", label: "Ny adgangskode" },
    },
    passwordHint: "Mindst 8 tegn.",
    ownerGo: "Fortsæt",
    noVolume: "Serveren har ikke noget volume, så den glemmer sin opsætning ved hver deploy. I Railway: højreklik på servicen › Attach volume, monteret på /data. Genindlæs så denne side.",
    ownerErr: { no_volume: "Tilføj først et volume på /data, se ovenfor.", short: "Adgangskoden skal have mindst 8 tegn.", wrong: "Forkert adgangskode.", throttled: "For mange forsøg. Prøv igen om et kvarter.", taken: "Serveren er lige blevet gjort til nogens. Log ind i stedet." },
    areaHead: "Hvor bor du?",
    areaBody: "Elprisen er forskellig øst og vest for Storebælt, så LadeMCP skal vide, hvilken pris din ladestander skal planlægge efter.",
    west: "Vest for Storebælt",
    westSub: "Jylland og Fyn · DK1",
    east: "Øst for Storebælt",
    eastSub: "Sjælland, øerne og Bornholm · DK2",
    westShort: "Vest (DK1)",
    eastShort: "Øst (DK2)",
    doneLabel: "Færdig",
    aiHead: "Tilføj LadeMCP til Claude",
    aiBody: "Så kan du spørge Claude, hvornår bilen lader, og bede den lade grønnere eller med det samme. Det gøres ligesom med EnergiMCP.",
    aiSteps: ["Åbn Claude, og gå til Indstillinger › Connectors.", "Vælg Tilføj brugerdefineret connector, og kald den LadeMCP.", "Indsæt adressen herunder, og gem."],
    aiAddress: "Adresse",
    aiSecret: "Adressen indeholder din nøgle til serveren. Del den ikke.",
    aiCode: "Bruger du Claude Code?",
    aiWaiting: "Venter på Claude",
    aiWaitBody: "Spørg Claude om noget, fx »Hvornår lader bilen i nat?«. Siden opdager det selv.",
    aiSeen: "Claude er forbundet",
    finish: "Færdig",
    skip: "Spring over, jeg gør det senere",
    copy: "Kopiér",
    copied: "Kopieret",
    doneHead: "LadeMCP er sat op",
    doneBody: "Ladestanderen lader i de billigste timer, og du kan spørge Claude om planen.",
    area: "Område",
    chargers: "Ladestandere",
    online: "Forbundet",
    offline: "Ikke forbundet",
    assistant: "Claude",
    aiYes: "Forbundet",
    aiNo: "Ikke forbundet endnu",
    secrets: "Adresser og adgangskoder",
    ocppAddress: "Ladestander-adresse",
    ocppPassword: "Ladestander-adgangskode",
    claudeUrl: "Claude-adresse",
    seePlan: "Se nattens plan",
    another: "Tilslut en ladestander mere",
  },
  en: {
    title: "Setup",
    rail: { area: "Area", charger: "Charger", assistant: "Claude" } as Record<SetupStep, string>,
    railLabel: "Setup steps",
    owner: {
      claim: { head: "Make this server yours", body: "You are the first one here, so the server becomes yours. Choose a password so you can also get in from other devices.", label: "Choose a password" },
      login: { head: "Log in", body: "This server is set up. Enter the password to continue.", label: "Password" },
      password: { head: "Choose a password", body: "Then you can get in from other devices than this one.", label: "New password" },
    },
    passwordHint: "At least 8 characters.",
    ownerGo: "Continue",
    noVolume: "This server has no volume, so it forgets its setup on every deploy. In Railway: right-click the service › Attach volume, mounted at /data. Then reload this page.",
    ownerErr: { no_volume: "Add a volume at /data first, see above.", short: "The password needs at least 8 characters.", wrong: "Wrong password.", throttled: "Too many tries. Try again in fifteen minutes.", taken: "Someone just made this server theirs. Log in instead." },
    areaHead: "Where do you live?",
    areaBody: "Electricity prices differ east and west of the Great Belt, so LadeMCP needs to know which price your charger should plan on.",
    west: "West of the Great Belt",
    westSub: "Jutland and Funen · DK1",
    east: "East of the Great Belt",
    eastSub: "Zealand, the islands and Bornholm · DK2",
    westShort: "West (DK1)",
    eastShort: "East (DK2)",
    doneLabel: "Done",
    aiHead: "Add LadeMCP to Claude",
    aiBody: "Then you can ask Claude when the car charges, and ask it to charge greener or right away. It works just like EnergiMCP.",
    aiSteps: ["Open Claude and go to Settings › Connectors.", "Choose Add custom connector and name it LadeMCP.", "Paste the address below and save."],
    aiAddress: "Address",
    aiSecret: "The address contains your key to the server. Do not share it.",
    aiCode: "Using Claude Code?",
    aiWaiting: "Waiting for Claude",
    aiWaitBody: "Ask Claude something, like “When does the car charge tonight?”. This page notices by itself.",
    aiSeen: "Claude is connected",
    finish: "Done",
    skip: "Skip, I will do it later",
    copy: "Copy",
    copied: "Copied",
    doneHead: "LadeMCP is set up",
    doneBody: "The charger charges in the cheapest hours, and you can ask Claude about the plan.",
    area: "Area",
    chargers: "Chargers",
    online: "Connected",
    offline: "Not connected",
    assistant: "Claude",
    aiYes: "Connected",
    aiNo: "Not connected yet",
    secrets: "Addresses and passwords",
    ocppAddress: "Charger address",
    ocppPassword: "Charger password",
    claudeUrl: "Claude address",
    seePlan: "See tonight's plan",
    another: "Connect another charger",
  },
};

export const SETUP_CSS = `<style>
  ol.rail{list-style:none;display:flex;gap:6px;padding:0;margin:0 0 14px}
  ol.rail li{flex:1;display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:500;color:var(--faint)}
  ol.rail li::before{content:"";height:3px;border-radius:2px;background:var(--line);transition:background 300ms var(--ease)}
  ol.rail li.done{color:var(--muted)}ol.rail li.done::before{background:var(--ok)}
  ol.rail li.now{color:var(--ink)}ol.rail li.now::before{background:var(--ink)}
  .step{animation:step-in 350ms var(--ease) both}
  @keyframes step-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.step{animation:none}}
  ul.rows button.pick{all:unset;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;padding:6px 0;cursor:pointer}
  ul.rows button.pick:focus-visible{outline:2px solid var(--ok);outline-offset:2px;border-radius:6px}
  .pick .two{display:flex;flex-direction:column}.pick .two small{color:var(--muted);font-size:13px}
  label.field{display:block;font-weight:500;font-size:14px;margin:18px 0 6px}
  input.text{width:100%;font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
  input.text:focus{outline:2px solid var(--ink);outline-offset:1px;border-color:transparent}
  code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
  ol.how{margin:16px 0 0;padding-left:20px}ol.how li{margin:0 0 8px;padding-left:4px}
  ul.rows li.kv{flex-wrap:wrap;gap:4px 16px}
  ul.rows li.kv code{flex:1;min-width:0;text-align:right;color:var(--muted)}
  ul.rows li.kv.stack span{flex:1}ul.rows li.kv.stack code{order:3;flex-basis:100%;text-align:left;padding:2px 0 4px}
  button.copy{padding:4px 10px;font-size:12px;border-radius:999px;background:var(--line);color:var(--ink)}
  .box{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:16px 0 0;font-size:13px}
  .link{background:none;color:var(--muted);padding:8px 0 0;font-weight:400;font-size:14px;text-decoration:underline;text-underline-offset:3px}
  a.link{display:inline-block}
  .err{color:var(--err);font-size:13px;margin:6px 0 0;min-height:1.2em}
  details{margin:18px 0 0}summary{cursor:pointer;font-weight:500;font-size:14px}
</style>`;

/** Progress across the three steps; shared with /connect while it is the charger step. */
export function rail(lang: Lang, now: SetupStep | "done"): string {
  const t = T[lang];
  const at = now === "done" ? STEPS.length : STEPS.indexOf(now);
  return `<ol class="rail" aria-label="${t.railLabel}">${STEPS.map((s, i) => `<li class="${i < at ? "done" : i === at ? "now" : ""}"${i === at ? ' aria-current="step"' : ""}>${t.rail[s]}</li>`).join("")}</ol>`;
}

/** A value to copy. Long ones (addresses) go on their own line under the label. */
const copyRow = (label: string, value: string, copy: string) =>
  `<li class="kv${value.length > 28 ? " stack" : ""}"><span>${label}</span><code>${esc(value)}</code><button class="copy" type="button" data-copy="${esc(value)}">${copy}</button></li>`;

const SCRIPT = (t: (typeof T)[Lang]) => `<script>
const T = ${JSON.stringify({ copy: t.copy, copied: t.copied, aiSeen: t.aiSeen, err: t.ownerErr })};
const $ = (id) => document.getElementById(id);
const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
for (const b of document.querySelectorAll("button.copy[data-copy]")) b.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = T.copied; setTimeout(() => (b.textContent = T.copy), 1500); } catch {}
});
for (const b of document.querySelectorAll("[data-post]")) b.addEventListener("click", async () => {
  b.disabled = true;
  const res = await post(b.dataset.post, b.dataset.body ? JSON.parse(b.dataset.body) : {}).catch(() => null);
  location.href = res && res.ok ? (b.dataset.next || "/setup") : "/setup";
});
</script>`;

export type OwnerMode = "claim" | "login" | "password";

/** Becoming the owner (first visitor), logging in (another device), or adding a password (claimed before there were any). */
export function ownerPage(lang: Lang, mode: OwnerMode, opts: { noVolume?: boolean } = {}): string {
  const t = T[lang];
  const m = t.owner[mode];
  return shell(lang, t.title, "/setup", `${SETUP_CSS}
  <form class="card step" id="owner" novalidate>
    <div class="pill">${t.title}</div>
    <h1>${m.head}</h1>
    <p class="muted">${m.body}</p>
    ${opts.noVolume ? `<div class="box" style="border-color:var(--err)">${t.noVolume}</div>` : ""}
    <label class="field" for="pw">${m.label}</label>
    <input class="text" id="pw" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" minlength="8" required>
    ${mode === "login" ? "" : `<p class="muted small" style="margin:6px 0 0">${t.passwordHint}</p>`}
    <p class="err" id="err" aria-live="polite"></p>
    <button class="full" type="submit">${t.ownerGo}</button>
  </form>
${SCRIPT(t)}
<script>
$("pw").focus();
$("owner").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await post(${JSON.stringify(`/setup/${mode}`)}, { password: $("pw").value }).catch(() => null);
  if (res && res.ok) return location.reload();
  const d = res ? await res.json().catch(() => ({})) : {};
  $("err").textContent = T.err[d.error] || T.err.wrong;
  if (d.error === "taken") setTimeout(() => location.reload(), 1500);
});
</script>`, `<p>LadeMCP</p>`);
}

export function areaPage(lang: Lang): string {
  const t = T[lang];
  const pick = (area: string, head: string, sub: string) =>
    `<li><button class="pick" type="button" data-post="/setup/area" data-body='${JSON.stringify({ area })}'><span class="two"><span>${head}</span><small>${sub}</small></span><span class="chev"></span></button></li>`;
  return shell(lang, t.title, "/setup", `${SETUP_CSS}
  ${rail(lang, "area")}
  <div class="card step">
    <div class="pill">${t.rail.area}</div>
    <h1>${t.areaHead}</h1>
    <p class="muted">${t.areaBody}</p>
    <ul class="rows">${pick("DK1", t.west, t.westSub)}${pick("DK2", t.east, t.eastSub)}</ul>
  </div>
${SCRIPT(t)}`, `<p>LadeMCP</p>`);
}

export function assistantPage(lang: Lang, opts: { claudeUrl: string; seen: boolean }): string {
  const t = T[lang];
  return shell(lang, t.title, "/setup", `${SETUP_CSS}
  ${rail(lang, "assistant")}
  <div class="card step">
    <div class="pill ${opts.seen ? "ok" : "loading"}" id="pill" aria-live="polite">${opts.seen ? t.aiSeen : t.aiWaiting}</div>
    <h1>${t.aiHead}</h1>
    <p class="muted">${t.aiBody}</p>
    <ol class="how">${t.aiSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <ul class="rows">${copyRow(t.aiAddress, opts.claudeUrl, t.copy)}</ul>
    <p class="muted small" style="margin-top:12px">${t.aiSecret}</p>
    <details><summary>${t.aiCode}</summary><div class="box"><code>claude mcp add --transport http lade ${esc(opts.claudeUrl)}</code></div></details>
    <p class="muted small" id="waitBody" style="margin-top:18px"${opts.seen ? " hidden" : ""}>${t.aiWaitBody}</p>
    <button class="full" id="finish" data-post="/setup/finish" data-next="/"${opts.seen ? "" : " disabled"}>${t.finish}</button>
    <button class="link" type="button" data-post="/setup/finish" data-body='{"skip":true}' data-next="/">${t.skip}</button>
  </div>
${SCRIPT(t)}
<script>
if (${!opts.seen}) {
  const poll = setInterval(async () => {
    try {
      const d = await (await fetch("/setup/state")).json();
      if (!d.assistant) return;
      clearInterval(poll);
      $("pill").className = "pill ok"; $("pill").textContent = T.aiSeen;
      $("waitBody").hidden = true; $("finish").disabled = false;
    } catch {}
  }, 3000);
}
</script>`, `<p>LadeMCP</p>`);
}

export function donePage(
  lang: Lang,
  opts: { priceArea: string; chargers: { id: string; connected: boolean }[]; assistant: boolean; ocppBase: string; ocppPassword: string; claudeUrl: string },
): string {
  const t = T[lang];
  const chargers = opts.chargers.map((c) => `<li><span>${esc(c.id)}</span><span class="dot${c.connected ? " ok" : ""}">${c.connected ? t.online : t.offline}</span></li>`).join("");
  return shell(lang, t.title, "/setup", `${SETUP_CSS}
  ${rail(lang, "done")}
  <div class="card step">
    <div class="pill ok">${t.doneLabel}</div>
    <h1>${t.doneHead}</h1>
    <p class="muted">${t.doneBody}</p>
    <ul class="rows">
      <li><span>${t.area}</span><span class="muted">${opts.priceArea === "DK2" ? t.eastShort : t.westShort}</span></li>
      <li><span>${t.assistant}</span><span class="dot${opts.assistant ? " ok" : ""}">${opts.assistant ? t.aiYes : t.aiNo}</span></li>
    </ul>
    <p class="small" style="font-weight:500;margin:22px 0 0">${t.chargers}</p>
    <ul class="rows" style="margin-top:6px">${chargers}</ul>
    <details><summary>${t.secrets}</summary><ul class="rows">
      ${copyRow(t.ocppAddress, opts.ocppBase, t.copy)}
      ${copyRow(t.ocppPassword, opts.ocppPassword, t.copy)}
      ${copyRow(t.claudeUrl, opts.claudeUrl, t.copy)}
    </ul></details>
    <a class="btn full" href="/">${t.seePlan}</a>
    <a class="link" href="/connect">${t.another}</a>
  </div>
${SCRIPT(t)}`, `<p>LadeMCP</p>`);
}
