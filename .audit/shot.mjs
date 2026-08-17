// Screenshots one section at one width. Usage: node .audit/shot.mjs <width> <selector> <out> [--open]
import { writeFileSync, mkdirSync } from "node:fs";
import { WebSocket } from "./ws.mjs";

const W = Number(process.argv[2] || 375);
const SEL = process.argv[3] || "#products";
const OUT = process.argv[4] || "shot";
const OPEN = process.argv.includes("--open");
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
    setTimeout(() => pending.has(n) && (pending.delete(n), reject(new Error("timeout " + method))), 25000);
  });
const evaluate = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await send("Page.enable");
const H = Number(process.env.AUDIT_H || 800);
await send("Emulation.setDeviceMetricsOverride", {
  width: W, height: H, deviceScaleFactor: 2, mobile: W < 768, screenWidth: W, screenHeight: H,
});
if (W < 768) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173" + PAGE });
await new Promise((r) => setTimeout(r, 2200));
await evaluate("document.documentElement.classList.remove('is-loading'); localStorage.setItem('grano-cookie-ok','1'); document.querySelector('.cookie')?.remove(); document.body.classList.remove('has-cookie'); 1");
await new Promise((r) => setTimeout(r, 500));
if (process.argv.includes("--menu")) {
  await evaluate(`document.querySelector('.nav-toggle').click(); 1`);
  await new Promise((r) => setTimeout(r, 700));
}
if (OPEN) {
  await evaluate(`document.querySelectorAll('.pcard-toggle').forEach((b, i) => { if (i < 2) b.click(); }); 1`);
  await new Promise((r) => setTimeout(r, 1000));
}
await evaluate(`document.querySelector('${SEL}')?.scrollIntoView({behavior:'instant', block:'start'}); 1`);
await new Promise((r) => setTimeout(r, 900));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`.audit/shots/${OUT}.png`, Buffer.from(shot.data, "base64"));
console.log(`.audit/shots/${OUT}.png`);
ws.close();
process.exit(0);
