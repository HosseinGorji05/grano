// Measures rendered text contrast against the composited background, and flags
// clickable elements missing cursor:pointer.
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
await send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: 820, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 820,
});
await send("Page.navigate", { url: "http://127.0.0.1:5173/index.html" });
await new Promise((r) => setTimeout(r, 2400));
await evaluate(`
  document.documentElement.classList.remove('is-loading');
  document.querySelectorAll('.pcard-toggle').forEach(b => b.click());
  1`);
await new Promise((r) => setTimeout(r, 900));

const out = await evaluate(`(() => {
  const lum = (rgb) => {
    const c = rgb.map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const parse = (s) => {
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a));
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.95) return c.rgb;
      if (c && c.a > 0) {
        const under = bgOf(n.parentElement || document.body);
        return over(c, under);
      }
      n = n.parentElement;
    }
    return [255, 255, 255];
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const name = (el) => {
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + cls;
  };

  const text = [];
  const seen = new Set();
  const cursor = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;

    if (el.matches('a[href], button, [role="button"], label.check, select') && cs.cursor !== "pointer") {
      cursor.push(name(el) + " cursor:" + cs.cursor);
    }

    const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const composited = over(fg, bg);
    const cr = ratio(composited, bg);
    const fs = parseFloat(cs.fontSize);
    const bold = +cs.fontWeight >= 700;
    const large = fs >= 24 || (fs >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const key = name(el) + Math.round(fs) + cs.color;
    if (seen.has(key)) continue;
    seen.add(key);
    text.push({
      el: name(el), fs: +fs.toFixed(1), cr: +cr.toFixed(2), need,
      pass: cr >= need - 0.005,
      sample: (el.textContent || "").trim().slice(0, 26),
    });
  }
  return { text, cursor: [...new Set(cursor)] };
})()`);

const fails = out.text.filter((r) => !r.pass);
console.log(`text samples checked: ${out.text.length}`);
if (fails.length) {
  console.log(`\nCONTRAST FAILURES (${fails.length}):`);
  for (const f of fails) console.log(`  ${f.cr} : 1  (needs ${f.need})  ${f.el} ${f.fs}px  "${f.sample}"`);
} else {
  console.log("all text meets its WCAG AA threshold");
}
const low = out.text.filter((r) => r.pass && r.cr < r.need + 0.6).slice(0, 8);
if (low.length) {
  console.log("\nclosest passes:");
  for (const f of low) console.log(`  ${f.cr} : 1  (needs ${f.need})  ${f.el} ${f.fs}px  "${f.sample}"`);
}
console.log(`\nclickables missing cursor:pointer: ${out.cursor.length ? out.cursor.join(", ") : "none"}`);
ws.close();
process.exit(0);
