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
    setTimeout(() => pending.has(n) && (pending.delete(n), reject(new Error("timeout"))), 20000);
  });
const evaluate = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 820, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 820 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html" });
await new Promise((r) => setTimeout(r, 2400));
await evaluate("document.documentElement.classList.remove('is-loading'); 1");
await new Promise((r) => setTimeout(r, 400));
console.log(await evaluate(`[...document.querySelectorAll('span')]
  .filter(el => el.textContent.trim() === '01' && el.getBoundingClientRect().width)
  .map(el => {
    const cs = getComputedStyle(el);
    return el.className + " | " + cs.fontSize + " | " + cs.color + " | parent=" + el.parentElement.className;
  }).join("\\n") || "(none)"`));
ws.close();
process.exit(0);
