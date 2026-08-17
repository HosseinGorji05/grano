// Mobile audit harness. Drives headless Chrome over CDP and reports, per width:
// horizontal overflow, offenders wider than the viewport, undersized tap targets,
// and text below 12px. Usage: node .audit/audit.mjs [--shots] [--open-cards]
import { writeFileSync, mkdirSync } from "node:fs";
import { WebSocket } from "./ws.mjs";

const URL_BASE = "http://127.0.0.1:5173";
const PAGE = process.env.AUDIT_PAGE || "/index.html";
const WIDTHS = [320, 360, 375, 390, 414, 430, 480, 600, 768, 1024, 1440];
const SHOTS = process.argv.includes("--shots");
const OPEN_CARDS = process.argv.includes("--open-cards");
const SHOT_WIDTHS = new Set([320, 375, 430, 768]);

mkdirSync(".audit/shots", { recursive: true });

const probe = `(() => {
  const vw = window.innerWidth;
  const de = document.documentElement;
  const out = {
    vw,
    scrollW: Math.max(de.scrollWidth, document.body.scrollWidth),
    docH: de.scrollHeight,
    wide: [],
    small: [],
    tiny: [],
  };
  const label = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".")
      : "";
    return el.tagName.toLowerCase() + id + cls;
  };
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;

    // Anything sticking past the right edge or wider than the viewport.
    if (r.right > vw + 1 || r.width > vw + 1) {
      const k = label(el);
      if (!seen.has(k)) {
        seen.add(k);
        out.wide.push({ el: k, w: Math.round(r.width), right: Math.round(r.right) });
      }
    }

    // Tap targets: WCAG 2.2 AA wants >= 24px; 44px is the comfort target.
    const tappable = el.matches('a[href], button, input:not([type="hidden"]), textarea, select, [role="button"]');
    if (tappable && cs.pointerEvents !== "none") {
      const min = Math.min(r.width, r.height);
      if (min > 0 && min < 44) {
        out.small.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || "").trim().slice(0, 24) });
      }
    }

    // Text smaller than 12px is unreadable on a phone.
    const fs = parseFloat(cs.fontSize);
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText && fs < 12) {
      out.tiny.push({ el: label(el), fs: +fs.toFixed(1), text: (el.textContent || "").trim().slice(0, 24) });
    }
  }
  return out;
})()`;

const targets = await (await fetch(`http://127.0.0.1:9222/json/list`)).json();
let target = targets.find((t) => t.type === "page");
if (!target) {
  const created = await (await fetch(`http://127.0.0.1:9222/json/new?about:blank`, { method: "PUT" })).json();
  target = created;
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await ws.ready;

let id = 0;
const pending = new Map();
ws.onMessage((msg) => {
  const m = JSON.parse(msg);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => pending.has(n) && (pending.delete(n), reject(new Error("timeout " + method))), 30000);
  });

const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
  return r.result.value;
};

await send("Page.enable");
await send("Runtime.enable");

const report = [];
for (const w of WIDTHS) {
  const mobile = w < 768;
  await send("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: mobile ? 780 : 900,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: w,
    screenHeight: mobile ? 780 : 900,
  });
  if (mobile) {
    await send("Emulation.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  } else {
    await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }

  await send("Page.navigate", { url: URL_BASE + PAGE });
  await new Promise((r) => setTimeout(r, 1800));
  // Let the intro loader finish and reveals settle.
  await evaluate(`document.documentElement.classList.remove('is-loading'); 1`);
  await new Promise((r) => setTimeout(r, 700));

  if (OPEN_CARDS) {
    await evaluate(`document.querySelectorAll('.pcard-toggle').forEach(b => b.click()); 1`);
    await new Promise((r) => setTimeout(r, 900));
  }

  const res = await evaluate(probe);
  report.push({ width: w, ...res });

  if (SHOTS && SHOT_WIDTHS.has(w)) {
    for (const [name, y] of [["hero", 0], ["products", null]]) {
      if (y === null) {
        await evaluate(`document.getElementById('products').scrollIntoView({behavior:'instant', block:'start'}); 1`);
      } else {
        await evaluate(`window.scrollTo(0, ${y}); 1`);
      }
      await new Promise((r) => setTimeout(r, 800));
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`.audit/shots/${w}-${name}.png`, Buffer.from(shot.data, "base64"));
    }
  }
}

const lines = [];
for (const r of report) {
  const over = r.scrollW - r.vw;
  lines.push(`\n=== ${r.width}px  scrollW=${r.scrollW} ${over > 1 ? `OVERFLOW +${over}` : "ok"}  docH=${r.docH}`);
  if (r.wide.length) {
    lines.push("  wider than viewport:");
    for (const x of r.wide.slice(0, 12)) lines.push(`    ${x.el}  w=${x.w} right=${x.right}`);
  }
  if (r.small.length) {
    lines.push(`  tap targets < 44px (${r.small.length}):`);
    const grouped = new Map();
    for (const x of r.small) {
      const k = `${x.el} ${x.w}x${x.h}`;
      grouped.set(k, (grouped.get(k) || 0) + 1);
    }
    for (const [k, n] of [...grouped].slice(0, 14)) lines.push(`    ${k}${n > 1 ? ` (x${n})` : ""}`);
  }
  if (r.tiny.length) {
    lines.push(`  text < 12px (${r.tiny.length}):`);
    const g = new Map();
    for (const x of r.tiny) g.set(`${x.el} ${x.fs}px`, (g.get(`${x.el} ${x.fs}px`) || 0) + 1);
    for (const [k, n] of [...g].slice(0, 10)) lines.push(`    ${k}${n > 1 ? ` (x${n})` : ""}`);
  }
}
const text = lines.join("\n");
writeFileSync(".audit/report.txt", text);
console.log(text);
ws.close();
process.exit(0);
