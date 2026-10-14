// M2 — Capturas de las pantallas de facturación a 1440, 390 y 320 px (página completa) con Chrome SIN CABEZA y un perfil temporal (nunca el de
// la persona). Además comprueba, por cada captura, que NO haya desborde horizontal ni errores de consola.
//
//   BILLING_ENABLED=true BILLING_PROVIDER=fake npx next dev --webpack -p 3111      (servidor de desarrollo local con el adaptador falso)
//   node supabase/tests/billing/capture_screens.mjs [--base http://localhost:3111] [--out docs/billing/screenshots] [--only active,grace]
//
// Los estados de ejemplo (`?escenario=`) sólo existen en ese servidor local; ninguna captura toca datos reales.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = arg("--base", "http://localhost:3111");
const OUT = path.resolve(REPO, arg("--out", "docs/billing/screenshots"));
const ONLY = arg("--only", "")?.split(",").filter(Boolean);
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WIDTHS = [1440, 390, 320];
const PORT = 9333 + Math.floor(Math.random() * 200);

const PAGES = [
  ["facturacion-activa", "/facturacion?escenario=active"],
  ["facturacion-activa-anual-cambio-programado", "/facturacion?escenario=active-annual"],
  ["facturacion-renovando", "/facturacion?escenario=renewing"],
  ["facturacion-pago-rechazado-gracia", "/facturacion?escenario=grace"],
  ["facturacion-modo-limitado", "/facturacion?escenario=limited"],
  ["facturacion-contracargo", "/facturacion?escenario=chargeback"],
  ["facturacion-cancelacion-al-final-del-periodo", "/facturacion?escenario=ending"],
  ["facturacion-cancelada", "/facturacion?escenario=canceled"],
  ["facturacion-finalizada", "/facturacion?escenario=expired"],
  ["facturacion-confirmando-pago", "/facturacion?escenario=processing"],
  ["facturacion-sin-suscripcion", "/facturacion?escenario=none"],
  ["facturacion-acceso-sin-cargo", "/facturacion?escenario=grandfathered"],
  ["facturacion-no-disponible", "/facturacion?escenario=unavailable"],
  ["planes-nueva-suscripcion", "/facturacion/planes?escenario=none"],
  ["planes-acceso-sin-cargo", "/facturacion/planes?escenario=grandfathered"],
  ["planes-cambio-de-plan", "/facturacion/planes?escenario=active"],
  ["planes-ya-suscripta", "/facturacion/planes?escenario=limited"],
  ["resultado-confirmando", "/facturacion/resultado?escenario=processing"],
  ["resultado-activa", "/facturacion/resultado?escenario=active"],
].filter(([name]) => ONLY.length === 0 || ONLY.some((fragment) => name.includes(fragment)));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tf-capture-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--disable-gpu", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targetUrl() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((item) => item.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* aún no arrancó */
    }
    await sleep(250);
  }
  throw new Error("Chrome no respondió");
}

const socket = new WebSocket(await targetUrl());
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const events = [];
socket.addEventListener("message", (message) => {
  const data = JSON.parse(String(message.data));
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(data.error.message));
    else resolve(data.result);
  } else if (data.method) events.push(data);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    nextId += 1;
    pending.set(nextId, { resolve, reject });
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
fs.mkdirSync(OUT, { recursive: true });

const report = [];
for (const [name, route] of PAGES) {
  for (const width of WIDTHS) {
    events.length = 0;
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    await send("Page.navigate", { url: `${BASE}${route}` });
    await sleep(2500); // carga + hidratación
    const probe = await send("Runtime.evaluate", { returnByValue: true, expression: "JSON.stringify({ h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), sw: document.documentElement.scrollWidth, iw: window.innerWidth, title: document.title, h1: document.querySelector('h1')?.textContent ?? '' })" });
    const info = JSON.parse(probe.result.value);
    await send("Emulation.setDeviceMetricsOverride", { width, height: Math.min(info.h, 6000), deviceScaleFactor: 1, mobile: width < 500 });
    await sleep(400);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const file = path.join(OUT, `${name}-${width}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
    const errors = events.filter((event) => (event.method === "Runtime.exceptionThrown") || (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") || (event.method === "Log.entryAdded" && event.params.entry.level === "error")).map((event) => event.params?.entry?.text ?? event.params?.exceptionDetails?.text ?? "consola").filter((text) => !/favicon|Failed to load resource: the server responded with a status of 404/.test(text));
    report.push({ name, width, height: info.h, overflow: info.sw > info.iw, errors: errors.length, h1: info.h1 });
    console.log(`${info.sw > info.iw ? "✖ DESBORDE" : "✔"} ${name} @${width}px  (${info.h} px de alto)${errors.length ? `  · ${errors.length} error(es) de consola` : ""}`);
  }
}

socket.close();
chrome.kill();
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {
  /* Windows puede demorar en soltar el perfil */
}
const bad = report.filter((item) => item.overflow || item.errors > 0);
fs.writeFileSync(path.join(OUT, "capturas.json"), JSON.stringify({ base: "servidor de desarrollo local con adaptador falso", widths: WIDTHS, pages: report }, null, 2));
console.log(`\n${report.length} capturas en ${path.relative(REPO, OUT)}; ${bad.length} con desborde horizontal o errores de consola`);
process.exit(bad.length === 0 ? 0 : 1);
