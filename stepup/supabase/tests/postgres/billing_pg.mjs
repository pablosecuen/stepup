// Utilidades compartidas por las pruebas de facturación (M1) sobre Postgres REAL.
//   - `makeRpcCaller(client, counter)`: llama a las MISMAS funciones SQL `billing_*` que usa producción (por la clave de servicio de
//     Supabase), pero por una conexión directa. Cuenta cada consulta enviada (métrica de «cuántas consultas»).
//   - `importLib(rel)`: importa un módulo TypeScript de lib/ (Node 24 ejecuta TypeScript sin compilar). `BILLING_LIB_DIR` permite
//     apuntar a una copia mutada para la prueba de mutaciones.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..", "..");
export const LIB_DIR = process.env.BILLING_LIB_DIR ? path.resolve(process.env.BILLING_LIB_DIR) : path.join(REPO, "lib");

export const importLib = (rel) => import(pathToFileURL(path.join(LIB_DIR, rel)).href);

export async function makeRpcCaller(client, counter = { queries: 0, byName: {} }) {
  const { RPC_SHAPES, RPC_JSON_ARGS } = await importLib("billing/rpc-store.ts");
  const caller = async (name, args) => {
    counter.queries += 1;
    counter.byName[name] = (counter.byName[name] ?? 0) + 1;
    const keys = Object.keys(args);
    const params = keys.map((key) => (RPC_JSON_ARGS.has(key) ? JSON.stringify(args[key]) : args[key]));
    const placeholders = keys.map((key, index) => `${key} => $${index + 1}${RPC_JSON_ARGS.has(key) ? "::jsonb" : ""}`).join(", ");
    const call = `public.${name}(${placeholders})`;
    const shape = RPC_SHAPES[name];
    const sql = shape === "scalar" ? `select ${call} as v` : shape === "row" ? `select (${call}).*` : `select * from ${call}`;
    const result = await client.query(sql, params);
    return shape === "scalar" ? result.rows[0].v : shape === "row" ? result.rows[0] : result.rows;
  };
  caller.counter = counter;
  return caller;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function uuidFor(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
