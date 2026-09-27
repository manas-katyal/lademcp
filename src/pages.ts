// The web page: tonight's charging plan for settings the visitor picks, built
// on GET /api/plan. One card, like SundhedMCP's server pages. Danish by
// default, with a DK | EN toggle remembered in a cookie. Settings live in the
// visitor's browser; nothing here talks to a charger yet.
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type Lang = "da" | "en";
export const LANG_COOKIE = "lade_lang";

/** ?lang= wins, then the cookie, then Danish. */
export function langOf(req: { query?: unknown; headers: { cookie?: string } }): Lang {
  const q = (req.query as Record<string, unknown> | undefined)?.lang;
  if (q === "da" || q === "en") return q;
  const c = String(req.headers.cookie ?? "").split(/;\s*/).find((x) => x.startsWith(`${LANG_COOKIE}=`))?.slice(LANG_COOKIE.length + 1);
  return c === "en" ? "en" : "da";
}

const T = {
  da: {
    title: "Opladning i nat",
    langLabel: "Sprog",
    loading: "Henter priser",
    planned: "Planlagt",
    failed: "Kunne ikke hente priser",
    failedBody: "Energi Data Service svarer ikke lige nu. Prøv igen om et par minutter.",
    limited: "Energi Data Service har for travlt. Prøv igen om fem minutter.",
    charges: "Lader",
    from: "fra",
    periods: (n: number) => `i ${n} perioder`,
    nothing: "Intet at lade",
    readyBy: (kwh: string, when: string) => `${kwh} kWh klar ${when}`,
    saves: (dkk: string) => `${dkk} mindre end at lade med det samme`,
    noSaving: "Det samme som at lade med det samme",
    cheapest: "Billigst",
    greenest: "Grønnest",
    greenHint: (dkk: string, co2: string) => `Grønnest koster ${dkk} mere og sparer ${co2} CO2.`,
    greenCost: (dkk: string, co2: string) => `${dkk} mere end billigst, ${co2} mindre CO2.`,
    greenFree: (co2: string) => `Samme pris som billigst, ${co2} mindre CO2.`,
    sameHours: "Billigst og grønnest er de samme timer i nat.",
    barsNote: "Pris pr. kvarter. De fremhævede streger er, når bilen lader.",
    ready: "Klar kl.",
    amount: "Mængde",
    power: "Ladeeffekt",
    area: "Område",
    west: "Vest (DK1)",
    east: "Øst (DK2)",
    prices_end: "Morgendagens priser kommer omkring kl. 13, så planen går kun til midnat indtil da.",
    short: "Der er ikke tid nok til det hele før det valgte tidspunkt, så bilen lader i alle kvarterer.",
    co2_partial: "CO2-prognosen for i morgen kommer omkring kl. 15. Indtil da tæller de timer som gennemsnit.",
    tariffYes: "Spotpris plus nettarif. Elafgift, Energinets tariffer og moms kommer oveni.",
    tariffNo: "Kun spotpris. Nettarif, elafgift og moms kommer oveni, så regningen er højere.",
    footer: "LadeMCP · priser og CO2 fra Energinet, Energi Data Service",
  },
  en: {
    title: "Charging tonight",
    langLabel: "Language",
    loading: "Fetching prices",
    planned: "Planned",
    failed: "Could not fetch prices",
    failedBody: "Energi Data Service is not answering right now. Try again in a few minutes.",
    limited: "Energi Data Service is busy. Try again in five minutes.",
    charges: "Charges",
    from: "from",
    periods: (n: number) => `in ${n} stretches`,
    nothing: "Nothing to charge",
    readyBy: (kwh: string, when: string) => `${kwh} kWh ready ${when}`,
    saves: (dkk: string) => `${dkk} less than charging right away`,
    noSaving: "The same as charging right away",
    cheapest: "Cheapest",
    greenest: "Greenest",
    greenHint: (dkk: string, co2: string) => `Greenest costs ${dkk} more and saves ${co2} of CO2.`,
    greenCost: (dkk: string, co2: string) => `${dkk} more than cheapest, ${co2} less CO2.`,
    greenFree: (co2: string) => `Same price as cheapest, ${co2} less CO2.`,
    sameHours: "Cheapest and greenest are the same hours tonight.",
    barsNote: "Price per quarter-hour. The highlighted bars are when the car charges.",
    ready: "Ready by",
    amount: "Amount",
    power: "Charging power",
    area: "Area",
    west: "West (DK1)",
    east: "East (DK2)",
    prices_end: "Tomorrow's prices arrive around 13:00, so until then the plan only runs to midnight.",
    short: "There is not enough time for all of it before the chosen time, so the car charges in every quarter-hour.",
    co2_partial: "Tomorrow's CO2 forecast arrives around 15:00. Until then those hours count as average.",
    tariffYes: "Spot price plus grid tariff. Electricity tax, Energinet tariffs and VAT come on top.",
    tariffNo: "Spot price only. Grid tariff, electricity tax and VAT come on top, so the bill is higher.",
    footer: "LadeMCP · prices and CO2 from Energinet, Energi Data Service",
  },
};

/** Client-side copy of T: functions become templates the page fills in. */
function clientStrings(lang: Lang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(T[lang])) out[k] = typeof v === "function" ? (v as (...a: string[]) => string)("{0}", "{1}") : v;
  return out;
}

const POWERS = [
  { amps: 16, phases: 1, kw: "3,7" },
  { amps: 32, phases: 1, kw: "7,4" },
  { amps: 16, phases: 3, kw: "11" },
  { amps: 32, phases: 3, kw: "22" },
];

export function homePage(lang: Lang): string {
  const t = T[lang];
  const kwhOptions = [10, 20, 30, 40, 50, 60, 80].map((n) => `<option value="${n}"${n === 30 ? " selected" : ""}>${n} kWh</option>`).join("");
  const powerOptions = POWERS.map((p) => `<option value="${p.amps}x${p.phases}"${p.amps === 16 && p.phases === 3 ? " selected" : ""}>${lang === "en" ? p.kw.replace(",", ".") : p.kw} kW</option>`).join("");
  const toggle = (["da", "en"] as const)
    .map((l) => `<a href="/lang/${l}" hreflang="${l}" lang="${l}"${lang === l ? ' class="on" aria-current="true"' : ""}>${l === "da" ? "DK" : "EN"}</a>`)
    .join("");
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(t.title)} · LadeMCP</title><link rel="icon" href="/icon.svg?v=1" type="image/svg+xml">
<style>
  :root{--bg:#faf9f7;--card:#ffffff;--ink:#0a0a0a;--on-ink:#f5f5f3;--muted:#5c5c5e;--faint:#8e8e93;--line:#e8e8ea;--ok:#0f7b4f;--err:#c1352a;
    --ease:cubic-bezier(0.22,1,0.36,1);--digit-dur:500ms;--digit-distance:8px;--digit-stagger:70ms;--digit-blur:2px;--digit-ease:cubic-bezier(0.34,1.45,0.64,1)}
  @media (prefers-color-scheme:dark){:root{--bg:#0c0c0d;--card:#1b1b1d;--ink:#f2f2f0;--on-ink:#0c0c0d;--muted:#a1a1a6;--faint:#7c7c82;--line:#2a2a2d;--ok:#3fbf85;--err:#ef6b5f}}
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.5 "IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
  .wrap{max-width:460px;margin:0 auto;padding:8vh 16px 48px}
  .top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 20px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:500;font-size:17px}
  .mark{width:24px;height:24px;display:block}
  .langs{display:inline-flex;gap:2px;padding:2px;border-radius:999px;background:var(--line)}
  .langs a{padding:3px 9px;border-radius:999px;font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);text-decoration:none}
  .langs a.on{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.1)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px}
  .pill{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--muted);margin:0 0 10px}
  .pill::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--muted);transition:background 300ms var(--ease)}
  .pill.ok{color:var(--ok)}.pill.ok::before{background:var(--ok)}
  .pill.error{color:var(--err)}.pill.error::before{background:var(--err)}
  .pill.loading::before{animation:pulse 1.2s ease-in-out infinite}
  @keyframes pulse{50%{opacity:.3}}
  h1{font-size:24px;line-height:1.2;font-weight:500;margin:0 0 4px;font-variant-numeric:tabular-nums}
  p{margin:0 0 12px}.muted{color:var(--muted)}.small{font-size:13px}
  .cost{font-size:40px;line-height:1.1;font-weight:500;margin:18px 0 2px;font-variant-numeric:tabular-nums}
  .t-digit-group{display:inline-flex;align-items:baseline}
  .t-digit{display:inline-block;white-space:pre}
  .t-digit-group.is-animating .t-digit{animation:digit var(--digit-dur) var(--digit-ease) both}
  .t-digit-group.is-animating .t-digit[data-stagger="1"]{animation-delay:var(--digit-stagger)}
  .t-digit-group.is-animating .t-digit[data-stagger="2"]{animation-delay:calc(var(--digit-stagger) * 2)}
  @keyframes digit{0%{transform:translateY(var(--digit-distance));opacity:0;filter:blur(var(--digit-blur))}100%{transform:none;opacity:1;filter:blur(0)}}
  .bars{display:flex;align-items:flex-end;gap:1px;height:64px;margin:22px 0 6px}
  .bars i{flex:1;min-width:1px;border-radius:2px 2px 0 0;background:var(--line);transition:height 450ms var(--ease),background 300ms var(--ease)}
  .bars i.on{background:var(--ink)}
  .axis{display:flex;justify-content:space-between;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums;margin:0 0 4px}
  .blend{margin:22px 0 0}
  .ends{display:flex;justify-content:space-between;font-size:13px;font-weight:500;margin:0 0 6px}
  input[type=range]{width:100%;margin:0;accent-color:var(--ok)}
  .hint{min-height:1.5em;margin:6px 0 0}
  ul.rows{list-style:none;padding:0;margin:22px 0 0}
  ul.rows li{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:8px 0;border-top:1px solid var(--line)}
  ul.rows li:last-child{border-bottom:1px solid var(--line)}
  ul.rows select,ul.rows input{font:inherit;color:var(--muted);background:transparent;border:0;padding:4px 0;text-align:right;text-align-last:right;cursor:pointer}
  ul.rows select:focus-visible,ul.rows input:focus-visible,input[type=range]:focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:6px}
  .warn{margin:16px 0 0}
  .warn p{font-size:13px;color:var(--muted);margin:0 0 6px;padding-left:14px;position:relative}
  .warn p::before{content:"";position:absolute;left:0;top:.6em;width:6px;height:6px;border-radius:50%;background:var(--faint)}
  .fade{transition:opacity 250ms var(--ease)}.busy .fade{opacity:.55}
  footer{margin-top:20px;font-size:12px;color:var(--muted)}
  footer p{margin:0 0 4px}
  @media (prefers-reduced-motion:reduce){.t-digit-group .t-digit,.pill.loading::before{animation:none!important}.bars i,.fade{transition:none}}
</style>
<body><div class="wrap">
  <div class="top"><div class="brand"><img class="mark" src="/icon.svg?v=1" alt=""><span>LadeMCP</span></div><nav class="langs" aria-label="${t.langLabel}">${toggle}</nav></div>
  <div class="card" id="card" aria-live="polite">
    <div class="pill loading" id="pill">${t.loading}</div>
    <div class="fade">
      <h1 id="head">${t.title}</h1>
      <p class="muted" id="sub">&nbsp;</p>
      <div class="cost"><span class="t-digit-group" id="cost">&nbsp;</span></div>
      <p class="muted small" id="save">&nbsp;</p>
      <div class="bars" id="bars" aria-hidden="true"></div>
      <div class="axis"><span id="ax0"></span><span id="ax1"></span></div>
      <p class="muted small">${t.barsNote}</p>
    </div>
    <div class="blend">
      <div class="ends"><span>${t.cheapest}</span><span>${t.greenest}</span></div>
      <input type="range" id="green" min="0" max="1" step="0.05" value="0" aria-label="${t.cheapest} – ${t.greenest}">
      <p class="muted small hint" id="hint"></p>
    </div>
    <ul class="rows">
      <li><label for="ready">${t.ready}</label><input type="time" id="ready" value="07:00" step="900"></li>
      <li><label for="kwh">${t.amount}</label><select id="kwh">${kwhOptions}</select></li>
      <li><label for="power">${t.power}</label><select id="power">${powerOptions}</select></li>
      <li><label for="area">${t.area}</label><select id="area"><option value="DK1">${t.west}</option><option value="DK2">${t.east}</option></select></li>
    </ul>
    <div class="warn" id="warn"></div>
  </div>
  <footer><p id="basis"></p><p>${t.footer}</p></footer>
</div>
<script>
const T = ${JSON.stringify(clientStrings(lang))};
const LOCALE = ${JSON.stringify(lang === "da" ? "da-DK" : "en-GB")};
const fill = (s, ...a) => a.reduce((acc, v, i) => acc.replace("{" + i + "}", v), s);
const $ = (id) => document.getElementById(id);
const tz = { timeZone: "Europe/Copenhagen" };
const hm = new Intl.DateTimeFormat(LOCALE, { ...tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const day = new Intl.DateTimeFormat(LOCALE, { ...tz, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dkk = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "DKK", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const kg = (v) => (v < 1 ? Math.round(v * 1000) + " g" : num.format(v) + " kg");
const QUARTER = 15 * 60000;

const KEY = "lade.settings";
const inputs = { ready: $("ready"), kwh: $("kwh"), power: $("power"), area: $("area"), green: $("green") };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  for (const [k, el] of Object.entries(inputs)) if (saved[k] !== undefined) el.value = saved[k];
  // A stored value the select no longer offers leaves it blank; fall back to the default.
  for (const el of [inputs.kwh, inputs.power, inputs.area]) if (!el.value) el.selectedIndex = Math.max(0, [...el.options].findIndex((o) => o.defaultSelected));
} catch {}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])))); } catch {}
}

function setDigits(group, str) {
  if (group.dataset.value === str) return;
  group.dataset.value = str;
  group.classList.remove("is-animating");
  group.replaceChildren(...[...str].map((ch, i, all) => {
    const s = document.createElement("span");
    s.className = "t-digit";
    s.textContent = ch;
    if (i === all.length - 2) s.dataset.stagger = "1";
    if (i === all.length - 1) s.dataset.stagger = "2";
    return s;
  }));
  void group.offsetHeight;
  group.classList.add("is-animating");
}

function pill(kind, text) {
  const p = $("pill");
  p.className = "pill " + kind;
  p.textContent = text;
}

/** Consecutive chosen quarter-hours as [from, to] pairs. */
function windows(slots) {
  const out = [];
  for (const s of slots.filter((x) => x.on)) {
    const start = new Date(s.start).getTime();
    const last = out.at(-1);
    if (last && last[1] === start) last[1] = start + QUARTER;
    else out.push([start, start + QUARTER]);
  }
  return out;
}

function renderBars(slots) {
  const bars = $("bars");
  while (bars.children.length > slots.length) bars.lastChild.remove();
  while (bars.children.length < slots.length) bars.append(document.createElement("i"));
  const costs = slots.map((s) => s.cost);
  const lo = Math.min(0, ...costs), hi = Math.max(...costs);
  slots.forEach((s, i) => {
    const el = bars.children[i];
    el.style.height = (hi > lo ? 8 + 92 * (s.cost - lo) / (hi - lo) : 50) + "%";
    el.classList.toggle("on", s.on);
    el.title = hm.format(new Date(s.start)) + " · " + dkk.format(s.cost) + "/kWh" + (s.co2 !== undefined ? " · " + s.co2 + " g CO2" : "");
  });
}

function render(d, kwh) {
  const w = windows(d.slots);
  if (!w.length) $("head").textContent = T.nothing;
  else if (w.length === 1) $("head").textContent = T.charges + " " + hm.format(w[0][0]) + "–" + hm.format(w[0][1]);
  else $("head").textContent = T.charges + " " + T.from + " " + hm.format(w[0][0]) + " " + fill(T.periods, String(w.length));
  $("sub").textContent = fill(T.readyBy, num.format(d.plan.energyKwh), day.format(new Date(d.ready_by)));
  setDigits($("cost"), dkk.format(d.plan.costDkk));
  const saved = d.charge_now.costDkk - d.plan.costDkk;
  $("save").textContent = saved >= 0.01 ? fill(T.saves, dkk.format(saved)) : T.noSaving;
  renderBars(d.slots);
  $("ax0").textContent = d.slots.length ? hm.format(new Date(d.slots[0].start)) : "";
  $("ax1").textContent = hm.format(new Date(d.ready_by));

  let hint = "";
  const g = d.greenest, c = d.cheapest;
  if (g && g.co2Kg !== undefined && c.co2Kg !== undefined) {
    const extra = d.plan.costDkk - c.costDkk, less = c.co2Kg - d.plan.co2Kg;
    if (Math.abs(g.costDkk - c.costDkk) < 0.01 && Math.abs(g.co2Kg - c.co2Kg) < 0.01) hint = T.sameHours;
    else if (Number(inputs.green.value) === 0) hint = fill(T.greenHint, dkk.format(g.costDkk - c.costDkk), kg(c.co2Kg - g.co2Kg));
    else if (extra < 0.01) hint = fill(T.greenFree, kg(less));
    else hint = fill(T.greenCost, dkk.format(extra), kg(less));
  }
  $("hint").textContent = hint;
  $("warn").replaceChildren(...d.warnings.filter((k) => T[k]).map((k) => Object.assign(document.createElement("p"), { textContent: T[k] })));
  $("basis").textContent = d.tariff ? T.tariffYes : T.tariffNo;
  pill("ok", T.planned);
}

let seq = 0, timer;
async function update() {
  save();
  const [amps, phases] = inputs.power.value.split("x");
  const q = new URLSearchParams({ ready_by: inputs.ready.value || "07:00", energy_kwh: inputs.kwh.value, green_weight: inputs.green.value, max_amps: amps, phases, price_area: inputs.area.value });
  const mine = ++seq;
  $("card").classList.add("busy");
  try {
    const res = await fetch("/api/plan?" + q);
    const d = await res.json();
    if (mine !== seq) return;
    if (!res.ok) throw new Error(d.error);
    render(d, Number(inputs.kwh.value));
  } catch (err) {
    if (mine !== seq) return;
    pill("error", T.failed);
    $("warn").replaceChildren(Object.assign(document.createElement("p"), { textContent: err.message === "rate_limited" ? T.limited : T.failedBody }));
  } finally {
    if (mine === seq) $("card").classList.remove("busy");
  }
}
const soon = () => { clearTimeout(timer); timer = setTimeout(update, 150); };
for (const el of Object.values(inputs)) el.addEventListener(el.type === "range" ? "input" : "change", soon);
update();
setInterval(update, 10 * 60000);
</script>
</body></html>`;
}
