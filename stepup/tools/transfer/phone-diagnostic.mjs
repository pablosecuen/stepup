// Diagnóstico de la copia en el teléfono (no sube ni cambia nada): ejecuta paso a paso lo que hace la copia sobre el primer archivo y muestra cuál falla. Sin credenciales.
//   node tools/transfer/phone-diagnostic.mjs --app <carpeta de la app>
import { createPhoneChannel, detectMetroPort } from "./phone-copy.mjs";

const args = process.argv.slice(2);
const appDir = args[args.indexOf("--app") + 1];
if (!appDir) {
  console.error("Uso: phone-diagnostic.mjs --app <carpeta de la app>");
  process.exit(2);
}
const port = (await detectMetroPort(appDir)) ?? 8081;
const channel = createPhoneChannel({ appDir, metroPort: port, log: (l) => console.log(l), firstSignalMs: 120_000, stallMs: 120_000 });
const outcome = await channel.run("diagnostic", { timeoutMs: 180_000 });
if (outcome.state === "listo") for (const s of outcome.steps) console.log(`${s.ok ? "✓" : "✗"} ${s.step}: ${s.detail}`);
else console.log("Sin resultado:", outcome.state === "error" ? outcome.error : "el teléfono no respondió");
