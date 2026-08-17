// Checks the decorative hero jars stay inside the viewport and stay circular.
import { WebSocket } from "./ws.mjs";

const VIEWPORTS = [[320, 568], [375, 667], [390, 844], [430, 932], [768, 1024], [844, 390], [1024, 768], [1440, 900], [1920, 1080]];

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
let bad = 0;
console.log("viewport    frame  cacao(wxh)  mango(wxh)  leftEdge  rightEdge  verdict");
for (const [w, h] of VIEWPORTS) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900, screenWidth: w, screenHeight: h });
  await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html" });
  await new Promise((r) => setTimeout(r, 1500));
  await evaluate(`document.documentElement.classList.remove('is-loading'); document.querySelector('.cookie')?.remove(); window.scrollTo(0,0); 1`);
  await new Promise((r) => setTimeout(r, 400));
  const m = await evaluate(`(() => {
    const f = document.querySelector('.hero-frame').getBoundingClientRect();
    const c = document.querySelector('.hero-chip--cacao').getBoundingClientRect();
    const g = document.querySelector('.hero-chip--mango').getBoundingClientRect();
    const r = (x) => Math.round(x);
    return {
      frame: r(f.width),
      cacao: r(c.width) + 'x' + r(c.height),
      mango: r(g.width) + 'x' + r(g.height),
      left: r(Math.min(c.left, g.left)),
      right: r(Math.max(c.right, g.right)),
      round: Math.abs(c.width - c.height) < 1.5 && Math.abs(g.width - g.height) < 1.5,
      vw: window.innerWidth,
    };
  })()`);
  const inside = m.left >= -1 && m.right <= m.vw + 1;
  const ok = inside && m.round;
  if (!ok) bad++;
  console.log(
    `${String(w + "x" + h).padEnd(11)} ${String(m.frame).padEnd(6)} ${m.cacao.padEnd(11)} ${m.mango.padEnd(11)} ${String(m.left).padEnd(9)} ${String(m.right).padEnd(10)} ${ok ? "ok" : (inside ? "not round" : "clipped by viewport")}`
  );
}
console.log(bad ? `\n${bad} viewport(s) with problems` : "\nall viewports ok");
ws.close();
process.exit(0);
