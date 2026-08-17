import { writeFileSync, mkdirSync } from "node:fs";
import { WebSocket } from "./ws.mjs";
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

await send("Page.enable");
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: w, height: h, deviceScaleFactor: 2, mobile: w < 800, screenWidth: w, screenHeight: h,
  });
  await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html?reel=" + Date.now() });
  await new Promise((r) => setTimeout(r, 2800));
  await evaluate(`document.documentElement.classList.remove('is-loading');
    document.querySelector('.cookie')?.remove();
    document.querySelectorAll('.reveal').forEach(e=>{e.classList.add('in'); e.style.opacity='1'; e.style.transform='none';});
    document.querySelector('.feature-reel')?.scrollIntoView({behavior:'instant', block:'center'}); 1`);
  await new Promise((r) => setTimeout(r, 600));
  const m = await evaluate(`(() => {
    const sec = document.querySelector('.feature-reel');
    const frame = document.querySelector('.feature-reel-frame');
    const vid = document.querySelector('.feature-reel-video');
    const sr = sec.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const vr = vid.getBoundingClientRect();
    const cs = getComputedStyle(frame);
    return {
      vw: innerWidth,
      sec: { w: Math.round(sr.width), left: Math.round(sr.left), right: Math.round(sr.right) },
      frame: { w: Math.round(fr.width), h: Math.round(fr.height), left: Math.round(fr.left), radius: cs.borderRadius },
      video: { w: Math.round(vr.width), h: Math.round(vr.height), left: Math.round(vr.left) },
    };
  })()`);
  console.log(w + "x" + h, JSON.stringify(m));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`.audit/shots/reel-bleed-${w}.png`, Buffer.from(shot.data, "base64"));
}
ws.close();
process.exit(0);
