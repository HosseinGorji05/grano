// Measures the first screen: header height, hero height, and how much of the next
// section is visible at the initial scroll position. Usage: node .audit/hero.mjs
import { WebSocket } from "./ws.mjs";

const VIEWPORTS = [
  [320, 568, "iPhone SE 1"],
  [375, 667, "iPhone SE 2/3"],
  [390, 844, "iPhone 14"],
  [414, 896, "iPhone 11"],
  [430, 932, "iPhone 15 Pro Max"],
  [360, 800, "Android common"],
  [768, 1024, "iPad portrait"],
  [1024, 768, "iPad landscape"],
  [1280, 800, "laptop"],
  [1440, 900, "desktop"],
  [1920, 1080, "large desktop"],
  [844, 390, "phone landscape"],
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await send("Page.enable");
console.log("viewport        device               header  hero   heroBottom  nextPeek  fits");
for (const [w, h, label] of VIEWPORTS) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: w, height: h, deviceScaleFactor: 1, mobile: w < 900, screenWidth: w, screenHeight: h,
  });
  await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html" });
  await new Promise((r) => setTimeout(r, 1600));
  await evaluate(`
    document.documentElement.classList.remove('is-loading');
    localStorage.setItem('grano-cookie-ok','1');
    document.querySelector('.cookie')?.remove();
    document.body.classList.remove('has-cookie');
    window.scrollTo(0, 0);
    1`);
  await new Promise((r) => setTimeout(r, 500));

  const m = await evaluate(`(() => {
    const header = document.querySelector('.site-header').getBoundingClientRect();
    const hero = document.querySelector('.hero').getBoundingClientRect();
    const next = document.querySelector('.hero').nextElementSibling;
    const nr = next ? next.getBoundingClientRect() : null;
    const vh = window.innerHeight;
    return {
      header: Math.round(header.height),
      hero: Math.round(hero.height),
      heroBottom: Math.round(hero.bottom),
      nextPeek: nr ? Math.round(Math.max(0, vh - nr.top)) : 0,
      vh,
      heroOverflow: Math.round(hero.bottom - vh),
    };
  })()`);

  const fits = m.heroBottom <= m.vh + 1 ? "yes" : `no (+${m.heroOverflow})`;
  console.log(
    `${String(w + "x" + h).padEnd(15)} ${label.padEnd(20)} ${String(m.header).padEnd(7)} ${String(m.hero).padEnd(6)} ${String(m.heroBottom).padEnd(11)} ${String(m.nextPeek).padEnd(9)} ${fits}`
  );
}
ws.close();
process.exit(0);
