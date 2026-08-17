// Full-page screenshot sliced into readable chunks. Usage: node .audit/fullpage.mjs <width> <prefix>
import { writeFileSync, mkdirSync } from "node:fs";
import { WebSocket } from "./ws.mjs";

const W = Number(process.argv[2] || 375);
const PREFIX = process.argv[3] || `full${W}`;
const SLICE = Number(process.argv[4] || 1400);
const PAGE = process.env.AUDIT_PAGE || "/index.html";
mkdirSync(".audit/shots", { recursive: true });

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
    setTimeout(() => pending.has(n) && (pending.delete(n), reject(new Error("timeout " + method))), 30000);
  });
const evaluate = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: W, height: 900, deviceScaleFactor: 1, mobile: W < 768, screenWidth: W, screenHeight: 900,
});
await send("Page.navigate", { url: "http://127.0.0.1:5173" + PAGE });
await new Promise((r) => setTimeout(r, 2200));
await evaluate(`
  document.documentElement.classList.remove('is-loading');
  localStorage.setItem('grano-cookie-ok','1');
  document.querySelector('.cookie')?.remove();
  document.body.classList.remove('has-cookie');
  1`);
// Beat Motion's inline opacity so nothing is captured mid-fade.
await evaluate(`
  const s = document.createElement('style');
  s.textContent = 'body * { opacity: 1 !important; filter: none !important; }';
  document.head.appendChild(s);
  1`);
await new Promise((r) => setTimeout(r, 900));

const h = await evaluate("document.documentElement.scrollHeight");
let n = 0;
for (let y = 0; y < h; y += SLICE) {
  const clipH = Math.min(SLICE, h - y);
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y, width: W, height: clipH, scale: 1 },
  });
  writeFileSync(`.audit/shots/${PREFIX}-${String(++n).padStart(2, "0")}.png`, Buffer.from(shot.data, "base64"));
}
console.log(`height=${h}, ${n} slices -> .audit/shots/${PREFIX}-*.png`);
ws.close();
process.exit(0);
