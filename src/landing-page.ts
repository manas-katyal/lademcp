// What a visitor who is not the owner sees at /: what LadeMCP is, the video,
// how to run your own, and what it works with. The owner logs in from here and
// then gets tonight's plan instead. A server nobody has claimed yet skips this
// and goes straight to /setup.
import { esc, type Lang } from "./pages.ts";

const DEPLOY = "https://railway.com/deploy/3u6Sxq";
const REPO = "https://github.com/manas-katyal/lademcp";
const WORKS = ["Monta", "Zaptec", "Easee", "Wallbox", "myenergi zappi", "EVBox Elvi", "Alfen", "ABB Terra AC", "Keba", "Charge Amps"];

const T = {
  da: {
    title: "Lad bilen, når strømmen er billigst",
    login: "Log ind",
    h1: "Din bil lader, når strømmen er billigst.",
    lede: "LadeMCP lægger nattens plan ud fra Energinets priser og CO₂-prognose og styrer din ladestander. Du fortæller bare din AI, hvornår du skal bruge bilen.",
    deploy: "Deploy din egen",
    code: "Koden på GitHub",
    videoLabel: "Video: LadeMCP lægger nattens plan og styrer laderen",
    setup: "Opsætning",
    time: "ca. 5 minutter",
    steps: [
      ["Deploy din egen", "Ét klik på Railway. Serveren laver selv sine adgangskoder."],
      ["Gør serveren til din", "Åbn din servers adresse med /setup, og vælg en adgangskode. Den første, der åbner siden, bliver ejer, så gør det lige efter deploy."],
      ["Forbind laderen", "Skriv én adresse ind i laderens egen app, eller forbind gennem Monta med en API-nøgle. Siden viser trinene for din lader."],
      ["Tilføj den til Claude", "Samme sted som EnergiMCP. Så kan du spørge, hvornår bilen lader, og bede den stoppe eller lade nu."],
    ],
    deployBtn: "Deploy på Railway",
    oss: "Open source, MIT-licens",
    works: "Virker med",
    anyOcpp: "Enhver OCPP 1.6J-lader",
    cannot: "Kan ikke forbindes: Clever, Tesla Wall Connector Gen 3 og EVBox Livo. De taler kun med producentens egen platform.",
    how: "Sådan virker det",
    run: "Kør din egen",
    howItems: [
      ["Billigst", "Den vælger de billigste kvarterer før dit klar-tidspunkt, ud fra Energinets spotpriser."],
      ["Eller grønnest", "Træk mod grønnest, og se præcis hvad det koster ekstra og hvor meget CO₂ det sparer."],
      ["Den styrer laderen", "Den starter og stopper opladningen selv. Du kan altid trykke stop eller lade med det samme."],
    ],
    footer: "LadeMCP · bygget på EnergiMCP · priser og CO₂ fra Energinet, Energi Data Service",
  },
  en: {
    title: "Charge the car when power is cheapest",
    login: "Log in",
    h1: "Your car charges when power is cheapest.",
    lede: "LadeMCP plans the night on Energinet's prices and CO₂ forecast, and runs your charger. You just tell your AI when you need the car.",
    deploy: "Deploy your own",
    code: "Code on GitHub",
    videoLabel: "Video: LadeMCP plans the night and runs the charger",
    setup: "Setup",
    time: "about 5 minutes",
    steps: [
      ["Deploy your own", "One click on Railway. The server makes its own passwords."],
      ["Make the server yours", "Open your server's address with /setup and choose a password. The first person to open it becomes the owner, so do it right after deploying."],
      ["Connect the charger", "Enter one address in the charger's own app, or connect through Monta with an API key. The page shows the steps for your charger."],
      ["Add it to Claude", "The same way as EnergiMCP. Then ask when the car charges, or tell it to stop or charge now."],
    ],
    deployBtn: "Deploy on Railway",
    oss: "Open source, MIT licence",
    works: "Works with",
    anyOcpp: "Any OCPP 1.6J charger",
    cannot: "Cannot connect: Clever, Tesla Wall Connector Gen 3 and EVBox Livo. They only talk to their maker's own platform.",
    how: "How it works",
    run: "Run your own",
    howItems: [
      ["Cheapest", "It picks the cheapest quarter-hours before your ready-by time, from Energinet's spot prices."],
      ["Or greenest", "Drag toward greenest and see exactly what it costs extra and how much CO₂ it saves."],
      ["It runs the charger", "It starts and stops charging by itself. You can always press stop, or charge right away."],
    ],
    footer: "LadeMCP · built on EnergiMCP · prices and CO₂ from Energinet, Energi Data Service",
  },
};

export function landingPage(lang: Lang): string {
  const t = T[lang];
  const toggle = (["da", "en"] as const)
    .map((l) => `<a href="/lang/${l}?back=%2F" hreflang="${l}" lang="${l}"${lang === l ? ' class="on" aria-current="true"' : ""}>${l === "da" ? "DK" : "EN"}</a>`)
    .join("");
  const steps = t.steps.map(([b, p], i) =>
    `<li><div><b>${esc(b)}</b><p>${esc(p)}</p>${
      i === 0 ? `<div class="act"><a class="btn primary" href="${DEPLOY}">${esc(t.deployBtn)}</a></div>`
      : i === 1 ? `<div class="act"><code>https://…up.railway.app/setup</code></div>`
      : i === 2 ? `<div class="act"><span class="tag">OCPP</span><span class="tag">Monta</span></div>` : ""
    }</div></li>`).join("");
  const chips = `<li class="first">${esc(t.anyOcpp)}</li>` + WORKS.map((w) => `<li>${esc(w)}</li>`).join("");
  const how = t.howItems.map(([b, p]) => `<div class="how"><b>${esc(b)}</b><p>${esc(p)}</p></div>`).join("");
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>LadeMCP · ${esc(t.title)}</title><link rel="icon" href="/icon.svg?v=1" type="image/svg+xml">
<meta name="description" content="${esc(t.lede)}">
<style>
  :root{--bg:#faf9f7;--card:#fff;--ink:#0a0a0a;--on-ink:#f5f5f3;--muted:#5c5c5e;--faint:#8e8e93;--line:#e8e8ea;--line-strong:#d4d4d8;--alt:#f4f4f5;--ok:#0f7b4f;--ease:cubic-bezier(0.22,1,0.36,1)}
  @media (prefers-color-scheme:dark){:root{--bg:#0c0c0d;--card:#1b1b1d;--ink:#f2f2f0;--on-ink:#0c0c0d;--muted:#a1a1a6;--faint:#7c7c82;--line:#2a2a2d;--line-strong:#3a3a3e;--alt:#161618;--ok:#3fbf85}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:16px/1.5 "IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .wrap{max-width:1080px;margin:0 auto;padding:0 20px}
  header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:22px 0}
  .brand{display:flex;align-items:center;gap:10px;font-weight:500;font-size:18px;text-decoration:none}
  .brand img{width:28px;height:28px}
  .right{display:flex;align-items:center;gap:14px}
  .langs{display:inline-flex;gap:2px;padding:2px;border-radius:999px;background:var(--line)}
  .langs a{padding:3px 9px;border-radius:999px;font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);text-decoration:none}
  .langs a.on{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.1)}
  .login{font-size:15px;font-weight:500;text-decoration:none;color:var(--muted)}
  .login:hover{color:var(--ink)}
  .hero{text-align:center;padding:clamp(28px,7vw,72px) 0 clamp(24px,4vw,40px)}
  h1{font-size:clamp(36px,6.4vw,68px);line-height:1.04;font-weight:600;max-width:15ch;margin:0 auto}
  .lede{color:var(--muted);font-size:clamp(17px,2.2vw,21px);max-width:40rem;margin:20px auto 0}
  .ctas{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:28px}
  .btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 22px;border-radius:999px;font-size:16px;font-weight:500;text-decoration:none;transition:opacity 300ms var(--ease),transform 300ms var(--ease)}
  .btn:active{transform:scale(.97)}
  .btn.primary{background:var(--ink);color:var(--on-ink)}.btn.primary:hover{opacity:.86}
  .btn.line{box-shadow:inset 0 0 0 1px var(--line-strong)}.btn.line:hover{box-shadow:inset 0 0 0 1px var(--ink)}
  .video{max-width:760px;margin:clamp(24px,5vw,48px) auto 0;border-radius:24px;overflow:hidden;box-shadow:0 0 0 1px var(--line),0 30px 70px rgba(10,10,10,.12)}
  .video video{display:block;width:100%;height:auto;aspect-ratio:1/1;background:#0b4a37}
  .hows{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:clamp(48px,8vw,88px) 0 0}
  @media (max-width:760px){.hows{grid-template-columns:1fr}}
  .how{padding:22px 24px;border-radius:20px;background:var(--card);box-shadow:0 0 0 1px var(--line)}
  .how b{display:block;font-weight:500;font-size:18px;margin-bottom:6px}.how p{color:var(--muted);font-size:15px}
  h2{font-size:clamp(26px,3.6vw,36px);font-weight:500;text-align:center;margin:clamp(56px,9vw,96px) 0 24px}
  .charge{display:grid;grid-template-columns:1.25fr 1fr;gap:16px;align-items:start}
  @media (max-width:860px){.charge{grid-template-columns:1fr}}
  .card{background:var(--card);border-radius:22px;box-shadow:0 0 0 1px var(--line);padding:clamp(22px,3.5vw,34px)}
  .card h3{font-size:19px;font-weight:500}
  .top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
  .pill{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:500;color:var(--ok)}
  .pill::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ok)}
  .top small{color:var(--faint);font-size:14px}
  ol.steps{list-style:none;counter-reset:s}
  ol.steps>li{counter-increment:s;position:relative;display:grid;grid-template-columns:32px 1fr;gap:16px;padding-bottom:26px}
  ol.steps>li:last-child{padding-bottom:0}
  ol.steps>li::before{content:counter(s);width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:500;background:var(--card);box-shadow:inset 0 0 0 1.5px var(--line-strong);position:relative;z-index:1}
  ol.steps>li:first-child::before{background:var(--ink);color:var(--on-ink);box-shadow:none}
  ol.steps>li:not(:last-child)::after{content:"";position:absolute;left:15.25px;top:34px;bottom:2px;width:1.5px;background:var(--line)}
  ol.steps b{display:block;font-weight:500;font-size:17px;margin:5px 0 3px}
  ol.steps p{color:var(--muted);font-size:15px}
  .act{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--alt);border-radius:8px;padding:6px 10px}
  .tag{display:inline-flex;font-size:13px;font-weight:500;padding:5px 11px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--line-strong)}
  .foot{margin-top:26px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--faint);font-size:14px}
  .foot a{color:var(--ink);font-weight:500}
  ul.chips{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:18px}
  @media (max-width:330px){ul.chips{grid-template-columns:1fr}}
  ul.chips li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px 11px 16px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--line);font-size:15px;font-weight:500}
  ul.chips li::after{content:"";flex:none;width:18px;height:18px;border-radius:50%;background:var(--ok) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.3 2.3 4.7-5' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/11px no-repeat}
  ul.chips li.first{grid-column:1/-1;background:var(--alt)}
  .cannot{margin-top:16px;color:var(--faint);font-size:14px}
  footer{margin:clamp(56px,9vw,96px) 0 40px;color:var(--faint);font-size:13px;text-align:center}
  @media (prefers-reduced-motion:reduce){.btn{transition:none}}
</style>
<body><div class="wrap">
  <header>
    <a class="brand" href="/"><img src="/icon.svg?v=1" alt="">LadeMCP</a>
    <div class="right"><a class="login" href="/setup">${esc(t.login)}</a><nav class="langs" aria-label="Language">${toggle}</nav></div>
  </header>
  <section class="hero">
    <h1>${esc(t.h1)}</h1>
    <p class="lede">${esc(t.lede)}</p>
    <div class="ctas"><a class="btn primary" href="${DEPLOY}">${esc(t.deploy)}</a><a class="btn line" href="${REPO}">${esc(t.code)}</a></div>
    <div class="video"><video src="/lademcp.mp4" poster="/lademcp-poster.jpg" autoplay muted loop playsinline controls preload="metadata" aria-label="${esc(t.videoLabel)}"></video></div>
  </section>
  <section class="hows">${how}</section>
  <h2 id="setup">${esc(t.run)}</h2>
  <section class="charge">
    <div class="card">
      <div class="top"><span class="pill">${esc(t.setup)}</span><small>${esc(t.time)}</small></div>
      <ol class="steps">${steps}</ol>
      <div class="foot"><span>${esc(t.oss)}</span><a href="${REPO}">${esc(t.code)} ›</a></div>
    </div>
    <div class="card">
      <h3>${esc(t.works)}</h3>
      <ul class="chips">${chips}</ul>
      <p class="cannot">${esc(t.cannot)}</p>
    </div>
  </section>
  <footer>${esc(t.footer)}</footer>
</div></body></html>`;
}
