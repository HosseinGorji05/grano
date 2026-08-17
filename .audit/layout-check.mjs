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

async function shot(w, h, name, scrollSel = null) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: w, height: h, deviceScaleFactor: 2, mobile: w < 800, screenWidth: w, screenHeight: h,
  });
  await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html?t=" + Date.now() });
  await new Promise((r) => setTimeout(r, 3200));
  await evaluate(`document.documentElement.classList.remove('is-loading'); document.querySelector('.cookie')?.remove(); document.body.classList.remove('has-cookie'); document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in')); 1`);
  await new Promise((r) => setTimeout(r, 400));
  if (scrollSel) {
    await evaluate(`document.querySelector('${scrollSel}')?.scrollIntoView({behavior:'instant', block:'start'}); 1`);
    await new Promise((r) => setTimeout(r, 500));
  } else {
    await evaluate(`window.scrollTo(0,0); 1`);
  }
  const metrics = await evaluate(`(() => {
    const hero = document.querySelector('.hero').getBoundingClientRect();
    const exp = document.querySelector('.experience').getBoundingClientRect();
    const copy = document.querySelector('.hero-content').getBoundingClientRect();
    return {
      heroH: Math.round(hero.height),
      gap: Math.round(exp.top - hero.bottom),
      copyTop: Math.round(copy.top),
      copyBottom: Math.round(copy.bottom),
      vh: innerHeight,
    };
  })()`);
  console.log(name, metrics);
  const png = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`.audit/shots/${name}.png`, Buffer.from(png.data, "base64"));
}

await shot(1440, 900, "fix-desk-hero");
await evaluate(`window.scrollTo(0, document.querySelector('.hero').offsetHeight - 120); 1`);
await new Promise((r) => setTimeout(r, 400));
{
  const metrics = await evaluate(`(() => {
    const hero = document.querySelector('.hero').getBoundingClientRect();
    const panel = document.querySelector('.experience-panel').getBoundingClientRect();
    return { heroBottom: Math.round(hero.bottom), panelTop: Math.round(panel.top), creamGap: Math.round(panel.top - Math.max(0, hero.bottom)) };
  })()`);
  console.log("desk junction", metrics);
  const png = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(".audit/shots/fix-desk-gap.png", Buffer.from(png.data, "base64"));
}
await shot(1440, 900, "fix-desk-exp", ".experience-panel");
await shot(390, 844, "fix-ph-hero");
await shot(390, 844, "fix-ph-exp", ".experience-panel");
ws.close();
process.exit(0);
