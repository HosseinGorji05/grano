// Reports elements past the right edge together with the nearest clipping ancestor,
// so design crops can be told apart from real page bleed.
import { WebSocket } from "./ws.mjs";

const W = Number(process.argv[2] || 375);
const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const t = targets.find((x) => x.type === "page");
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
await send("Emulation.setDeviceMetricsOverride", {
  width: W, height: 780, deviceScaleFactor: 1, mobile: W < 768, screenWidth: W, screenHeight: 780,
});
await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html" });
await new Promise((r) => setTimeout(r, 2200));
await evaluate("document.documentElement.classList.remove('is-loading'); 1");
await new Promise((r) => setTimeout(r, 700));

const rows = await evaluate(`(() => {
  const vw = window.innerWidth;
  const name = (el) => {
    if (!el || !el.tagName) return "(none)";
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls;
  };
  const clipper = (el) => {
    let n = el.parentElement;
    while (n) {
      const cs = getComputedStyle(n);
      if (["hidden", "clip", "auto", "scroll"].includes(cs.overflowX)) {
        const r = n.getBoundingClientRect();
        return { el: name(n), right: Math.round(r.right), ox: cs.overflowX };
      }
      n = n.parentElement;
    }
    return null;
  };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1) continue;
    const c = clipper(el);
    out.push({ el: name(el), right: Math.round(r.right), w: Math.round(r.width), clip: c });
  }
  return out;
})()`);

console.log(`--- ${W}px, viewport right edge = ${W}`);
for (const r of rows) {
  const c = r.clip;
  const safe = c && c.right <= W + 1 ? "CLIPPED-OK" : "*** BLEEDS ***";
  console.log(`${safe}  ${r.el} right=${r.right} w=${r.w}  clipper=${c ? `${c.el}(${c.ox}) right=${c.right}` : "none"}`);
}
ws.close();
process.exit(0);
