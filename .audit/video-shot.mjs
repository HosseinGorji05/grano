import { writeFileSync, mkdirSync } from "node:fs";
import { WebSocket } from "./ws.mjs";

mkdirSync(".audit/shots", { recursive: true });
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl);
await ws.ready;
let id = 0;
const pending = new Map();
const logs = [];
ws.onMessage((m) => {
  const p = JSON.parse(m);
  if (p.method === "Runtime.exceptionThrown") {
    logs.push(p.params.exceptionDetails?.exception?.description || p.params.exceptionDetails?.text);
  }
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

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 900, deviceScaleFactor: 2, mobile: false, screenWidth: 1440, screenHeight: 900,
});
await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html?v=" + Date.now() });
await new Promise((r) => setTimeout(r, 4000));
const state = await evaluate(`({
  loading: document.documentElement.classList.contains('is-loading'),
  hero: document.querySelector('.hero')?.className,
  video: !!document.querySelector('.hero-video'),
  ready: document.querySelector('.hero-video')?.readyState,
  paused: document.querySelector('.hero-video')?.paused,
  h1: getComputedStyle(document.querySelector('.hero h1')).color,
  err: null
})`);
console.log(state);
console.log("exceptions:", logs);
await evaluate(`document.documentElement.classList.remove('is-loading'); document.querySelector('.cookie')?.remove(); document.body.classList.remove('has-cookie'); 1`);
await new Promise((r) => setTimeout(r, 800));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(".audit/shots/video-desk.png", Buffer.from(shot.data, "base64"));
console.log("wrote video-desk.png");
ws.close();
process.exit(0);
