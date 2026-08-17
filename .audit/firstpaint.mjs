// Loads the page untouched and samples hero opacity over time, to prove the
// landing content reveals itself without needing a scroll.
import { WebSocket } from "./ws.mjs";

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
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
// A fresh profile each run, so the loader plays exactly as a first visitor sees it.
await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html" });
await evaluate(`localStorage.clear(); 1`).catch(() => {});
await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html?fresh=" + Date.now() });

console.log("t(ms)  loading  h1     lead   chip   pills  scrollY");
for (let i = 1; i <= 12; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const m = await evaluate(`(() => {
    const o = (s) => { const e = document.querySelector(s); return e ? Number(getComputedStyle(e).opacity).toFixed(2) : 'n/a'; };
    return {
      loading: document.documentElement.classList.contains('is-loading'),
      h1: o('.hero h1'), lead: o('.hero-lead'), chip: o('.hero-chip'), pills: o('.hero-flavours'),
      y: Math.round(scrollY),
    };
  })()`);
  console.log(
    `${String(i * 500).padEnd(6)} ${String(m.loading).padEnd(8)} ${m.h1.padEnd(6)} ${m.lead.padEnd(6)} ${m.chip.padEnd(6)} ${m.pills.padEnd(6)} ${m.y}`
  );
}
ws.close();
process.exit(0);
