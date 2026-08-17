// Anchor targets must land below the sticky header, and the landing section must
// still hold one screen when animations are disabled.
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
let fails = 0;
const check = (ok, label, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

for (const [w, h] of [[1440, 900], [390, 844]]) {
  console.log(`\n--- ${w}x${h}`);
  for (const reduced of [false, true]) {
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }],
    });
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900, screenWidth: w, screenHeight: h });
    await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html?t=" + Date.now() });
    // Let the loader finish and the reveal animations settle on their own; forcing
    // is-loading off early races the real sequence and reads mid-fade opacities.
    await new Promise((r) => setTimeout(r, 3600));
    await evaluate(`document.querySelector('.cookie')?.remove(); document.body.classList.remove('has-cookie'); 1`);
    await new Promise((r) => setTimeout(r, 300));

    const tag = reduced ? "[reduced]" : "[motion]";

    const hero = await evaluate(`(() => {
      const h = document.querySelector('.hero').getBoundingClientRect();
      const next = document.querySelector('.hero').nextElementSibling.getBoundingClientRect();
      return { bottom: Math.round(h.bottom), peek: Math.round(Math.max(0, innerHeight - next.top)), vh: innerHeight };
    })()`);
    check(hero.peek === 0, `${tag} nothing below the fold`, `peek=${hero.peek}px`);

    const vis = await evaluate(`(() => {
      const el = document.querySelector('.hero h1');
      const chip = document.querySelector('.hero-chip');
      return { h1: getComputedStyle(el).opacity, chip: getComputedStyle(chip).opacity };
    })()`);
    check(Number(vis.h1) > 0.95, `${tag} headline is visible`, `opacity=${vis.h1}`);
    check(Number(vis.chip) > 0.95, `${tag} decorative jars are visible`, `opacity=${vis.chip}`);

    // Anchor clearance: the products heading must not hide under the sticky header.
    await evaluate(`location.hash=''; document.querySelector('.hero-actions .btn').click(); 1`);
    await new Promise((r) => setTimeout(r, 1400));
    const anchor = await evaluate(`(() => {
      const header = document.querySelector('.site-header').getBoundingClientRect();
      const target = document.querySelector('#products').getBoundingClientRect();
      return { gap: Math.round(target.top - header.bottom), scrolled: Math.round(scrollY) };
    })()`);
    check(anchor.gap >= 0 && anchor.gap < 40, `${tag} #products clears the header`, `gap=${anchor.gap}px`);
  }
}
await send("Emulation.setEmulatedMedia", { features: [] });
console.log(fails ? `\n${fails} failure(s)` : "\nall checks passed");
ws.close();
process.exit(0);
