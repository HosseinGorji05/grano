// Lists undersized tap targets with an ancestor path so the right selector gets fixed.
import { WebSocket } from "./ws.mjs";

const W = Number(process.argv[2] || 375);
const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = targets.find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
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
    setTimeout(() => pending.has(n) && (pending.delete(n), reject(new Error("timeout"))), 20000);
  });
const evaluate = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: W, height: 780, deviceScaleFactor: 1, mobile: W < 768, screenWidth: W, screenHeight: 780,
});
await send("Page.navigate", { url: "http://127.0.0.1:5173" + (process.env.AUDIT_PAGE || "/index.html") });
await new Promise((r) => setTimeout(r, 2000));
await evaluate("document.documentElement.classList.remove('is-loading'); 1");
await new Promise((r) => setTimeout(r, 500));

const out = await evaluate(`(() => {
  const path = (el) => {
    const parts = [];
    let n = el;
    while (n && n.tagName && parts.length < 4) {
      const cls = typeof n.className === "string" && n.className
        ? "." + n.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
      parts.unshift(n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + cls);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const rows = [];
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select')) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (Math.min(r.width, r.height) >= 44) continue;
    rows.push({ p: path(el), w: +r.width.toFixed(0), h: +r.height.toFixed(0), t: (el.textContent||el.type||"").trim().slice(0,20) });
  }
  return rows;
})()`);

const seen = new Set();
for (const r of out) {
  const k = r.p + r.h;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`${String(r.w).padStart(4)}x${String(r.h).padEnd(3)}  ${r.p}   "${r.t}"`);
}
ws.close();
process.exit(0);
