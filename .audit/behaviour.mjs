// Functional checks for the product accordion: aria state, panel height, hash deep link,
// keyboard operation, and the reduced-motion fallback.
import { WebSocket } from "./ws.mjs";

const REDUCED = process.argv.includes("--reduced");
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
    setTimeout(() => pending.has(n) && (pending.delete(n), reject(new Error("timeout " + method))), 20000);
  });
const evaluate = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: 800, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 800,
});
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: REDUCED ? "reduce" : "no-preference" }],
});
await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html" });
await wait(2400);
await evaluate("document.documentElement.classList.remove('is-loading'); 1");
await wait(400);

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });

check("motion class matches preference",
  (await evaluate("document.documentElement.classList.contains('motion')")) === !REDUCED,
  `reduced=${REDUCED}`);

check("three toggles present", (await evaluate("document.querySelectorAll('.pcard-toggle').length")) === 3);

check("all start collapsed",
  await evaluate(`[...document.querySelectorAll('.pcard-toggle')].every(b => b.getAttribute('aria-expanded') === 'false')`));

check("panel collapsed to zero height",
  (await evaluate("document.querySelector('#chia-pop-panel .pcard-panel-inner').getBoundingClientRect().height")) < 1);

// Pointer click, the way a phone user opens it.
await evaluate(`document.querySelector('#chia-pop .pcard-toggle').click(); 1`);
await wait(800);
check("click sets aria-expanded=true",
  (await evaluate(`document.querySelector('#chia-pop .pcard-toggle').getAttribute('aria-expanded')`)) === "true");
check("panel has height when open",
  (await evaluate("document.querySelector('#chia-pop-panel .pcard-panel-inner').getBoundingClientRect().height")) > 40);
check("panel content visible",
  (await evaluate(`getComputedStyle(document.querySelector('#chia-pop-panel .pcard-panel-inner')).visibility`)) === "visible");
check("plus rotated to a cross",
  await evaluate(`(() => {
    const tr = getComputedStyle(document.querySelector('#chia-pop .plus')).transform;
    if (tr === 'none') return false;
    const m = tr.match(/matrix\\(([^)]+)\\)/);
    if (!m) return false;
    const [a, b] = m[1].split(',').map(Number);
    const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI);
    return Math.abs(Math.abs(deg) - 135) < 12;
  })()`));

await evaluate(`document.querySelector('#chia-pop .pcard-toggle').click(); 1`);
await wait(800);
check("second click collapses",
  (await evaluate(`document.querySelector('#chia-pop .pcard-toggle').getAttribute('aria-expanded')`)) === "false" &&
  (await evaluate("document.querySelector('#chia-pop-panel .pcard-panel-inner').getBoundingClientRect().height")) < 1);

// Keyboard: focus the toggle and press Enter.
await evaluate(`document.querySelector('#mango-glow .pcard-toggle').focus(); 1`);
check("toggle is focusable",
  (await evaluate("document.activeElement.className")).includes("pcard-toggle"));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await wait(800);
check("Enter opens the card",
  (await evaluate(`document.querySelector('#mango-glow .pcard-toggle').getAttribute('aria-expanded')`)) === "true");
check("focus ring is drawn",
  (await evaluate(`(() => {
    const el = document.querySelector('#mango-glow .pcard-toggle');
    el.focus();
    const cs = getComputedStyle(el);
    return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  })()`)));

check("panel is a labelled region",
  await evaluate(`(() => {
    const p = document.querySelector('#mango-glow-panel');
    const id = p.getAttribute('aria-labelledby');
    return p.getAttribute('role') === 'region' && !!id && !!document.getElementById(id);
  })()`));

// Deep link from the flavour pills should scroll to and open the card.
await evaluate(`location.hash = '#amber'; 1`);
await wait(900);
check("hash deep link opens the card",
  (await evaluate(`document.querySelector('#amber').classList.contains('is-open')`)));

let bad = 0;
for (const r of results) {
  if (!r.pass) bad++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
}
console.log(`\n${results.length - bad}/${results.length} passed  [${REDUCED ? "reduced-motion" : "motion"}]`);
ws.close();
process.exit(0);
