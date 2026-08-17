// Mobile pass: overflow, taps, text, and first-screen fit for key phone sizes.
import { writeFileSync, mkdirSync } from "node:fs";
import { WebSocket } from "./ws.mjs";

mkdirSync(".audit/shots", { recursive: true });
const PHONES = [
  [320, 568, "se1"],
  [375, 667, "se"],
  [390, 844, "14"],
  [430, 932, "pro"],
];

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl);
await ws.ready;
let id = 0;
const pending = new Map();
ws.onMessage((m) => {
  const p = JSON.parse(m);
  if (p.id && pending.has(p.id)) {
    const { resolve, reject } = pending.get(p.id);
    pending.delete(p.id);
    p.error ? reject(new Error(JSON.stringify(p.error))) : resolve(p.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => pending.has(n) && (pending.delete(n), reject(new Error("timeout " + method))), 25000);
  });
const evaluate = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

await send("Page.enable");

for (const [w, h, tag] of PHONES) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: w, height: h, deviceScaleFactor: 2, mobile: true, screenWidth: w, screenHeight: h,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html?m=" + tag + Date.now() });
  await new Promise((r) => setTimeout(r, 2800));
  await evaluate(`document.documentElement.classList.remove('is-loading');
    localStorage.setItem('grano-cookie-ok','1');
    document.querySelector('.cookie')?.remove();
    document.body.classList.remove('has-cookie');
    document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in'));
    window.scrollTo(0,0); 1`);
  await new Promise((r) => setTimeout(r, 400));

  const report = await evaluate(`(() => {
    const vw = innerWidth, vh = innerHeight;
    const overflow = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (r.right > vw + 1.5) overflow.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' +' + Math.round(r.right - vw));
    });
    const taps = [];
    document.querySelectorAll('a, button, .pcard-toggle, input, select, label.check').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (r.height < 44 || r.width < 44) taps.push((el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    const hero = document.querySelector('.hero').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.pcard')].map((c) => {
      const n = c.querySelector('.pcard-name')?.textContent?.trim();
      const r = c.getBoundingClientRect();
      return { n, w: Math.round(r.width), h: Math.round(r.height) };
    });
    const pills = [...document.querySelectorAll('.flavor-pills a')].map((a) => {
      const r = a.getBoundingClientRect();
      return { t: a.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width) };
    });
    const reel = document.querySelector('.feature-reel-frame')?.getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth,
      heroBottom: Math.round(hero.bottom),
      peek: Math.round(Math.max(0, vh - (document.querySelector('.hero').nextElementSibling?.getBoundingClientRect().top || vh))),
      overflow: [...new Set(overflow)].slice(0, 8),
      smallTaps: taps.slice(0, 12),
      cards,
      pills,
      reelH: reel ? Math.round(reel.height) : null,
      gridCols: getComputedStyle(document.querySelector('.product-grid')).gridTemplateColumns.split(' ').length,
    };
  })()`);

  console.log(`\\n=== ${w}x${h} (${tag}) scrollW=${report.scrollW} cols=${report.gridCols}`);
  console.log(`heroBottom=${report.heroBottom} peek=${report.peek} reelH=${report.reelH}`);
  console.log('cards', report.cards);
  console.log('pills', report.pills);
  if (report.overflow.length) console.log('overflow', report.overflow);
  if (report.smallTaps.length) console.log('smallTaps', report.smallTaps);

  // hero shot
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`.audit/shots/m-${tag}-hero.png`, Buffer.from(shot.data, "base64"));

  await evaluate(`document.querySelector('#products')?.scrollIntoView({behavior:'instant', block:'start'}); 1`);
  await new Promise((r) => setTimeout(r, 500));
  const shot2 = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`.audit/shots/m-${tag}-products.png`, Buffer.from(shot2.data, "base64"));

  await evaluate(`document.querySelector('.feature-reel')?.scrollIntoView({behavior:'instant', block:'center'}); 1`);
  await new Promise((r) => setTimeout(r, 500));
  const shot3 = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`.audit/shots/m-${tag}-reel.png`, Buffer.from(shot3.data, "base64"));
}

ws.close();
process.exit(0);
