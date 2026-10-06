import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readTable, readTableByIds, readRpc } from "../read.ts";

// R2 — Prueba del FORMATO REAL EN EL CABLE: se usa el cliente real `@supabase/supabase-js` (su constructor de consultas, su
// codificación de URL, su lectura del recuento en `Content-Range`) contra un `fetch` que interpreta la URL como lo haría PostgREST
// (filtros, `or`/`and` con valores entre comillas, `order` múltiple, `limit`, `in`, `Prefer: count=exact`, `max_rows`).
// Así se valida que los helpers de R2 le piden a PostgREST exactamente lo que PostgREST entiende — no sólo que funcionan contra un
// doble escrito por nosotros.

type Row = Record<string, unknown>;
const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
const MAX_ROWS = 1000;

function parseLogical(input: string): (row: Row) => boolean {
  let position = 0;
  const readQuoted = () => {
    position += 1;
    let out = "";
    while (position < input.length && input[position] !== '"') {
      if (input[position] === "\\") position += 1;
      out += input[position];
      position += 1;
    }
    position += 1;
    return out;
  };
  const readUntil = (stops: string) => {
    let out = "";
    while (position < input.length && !stops.includes(input[position])) out += input[position++];
    return out;
  };
  const term = (): ((row: Row) => boolean) => {
    if (input.startsWith("and(", position)) {
      position += 4;
      const parts = [term()];
      while (input[position] === ",") { position += 1; parts.push(term()); }
      position += 1;
      return (row) => parts.every((part) => part(row));
    }
    const column = readUntil(".");
    position += 1;
    const operator = readUntil(".");
    position += 1;
    const value = input[position] === '"' ? readQuoted() : readUntil(",)");
    return (row) => {
      const actual = row[column];
      if (operator === "is") return value === "null" ? actual == null : String(actual) === value;
      if (actual == null) return false;
      const c = String(actual) < value ? -1 : String(actual) > value ? 1 : 0;
      return operator === "eq" ? c === 0 : operator === "gt" ? c > 0 : operator === "lt" ? c < 0 : operator === "gte" ? c >= 0 : c <= 0;
    };
  };
  const terms = [term()];
  while (input[position] === ",") { position += 1; terms.push(term()); }
  assert.equal(position, input.length, `filtro lógico mal formado: ${input}`);
  return (row) => terms.some((t) => t(row));
}

/** `fetch` que se comporta como PostgREST para el subconjunto que usan las lecturas. */
function postgrestFetch(tables: Record<string, Row[]>, log: { url: string; prefer: string | null }[]): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
    const headers = new Headers(init?.headers);
    log.push({ url: url.pathname + url.search, prefer: headers.get("prefer") });
    const table = url.pathname.replace("/rest/v1/", "");
    let rows = [...(tables[table] ?? [])];
    let limit = MAX_ROWS;
    const orders: { column: string; ascending: boolean }[] = [];
    for (const [key, value] of url.searchParams) {
      if (key === "select") continue;
      if (key === "limit") { limit = Math.min(Number(value), MAX_ROWS); continue; }
      if (key === "order") {
        for (const part of value.split(",")) { const [column, dir] = part.split("."); orders.push({ column, ascending: dir !== "desc" }); }
        continue;
      }
      if (key === "or") {
        assert.match(value, /^\(.*\)$/, "el parámetro or va entre paréntesis");
        rows = rows.filter(parseLogical(value.slice(1, -1)));
        continue;
      }
      const dot = value.indexOf(".");
      const operator = value.slice(0, dot);
      const operand = value.slice(dot + 1);
      if (operator === "eq") rows = rows.filter((r) => String(r[key]) === operand);
      else if (operator === "in") { const set = new Set(operand.slice(1, -1).split(",")); rows = rows.filter((r) => set.has(String(r[key]))); }
      else if (operator === "gt") rows = rows.filter((r) => r[key] != null && String(r[key]) > operand);
      else if (operator === "lt") rows = rows.filter((r) => r[key] != null && String(r[key]) < operand);
      else if (operator === "gte") rows = rows.filter((r) => r[key] != null && String(r[key]) >= operand);
      else if (operator === "lte") rows = rows.filter((r) => r[key] != null && String(r[key]) <= operand);
      else throw new Error(`operador no soportado: ${key}=${value}`);
    }
    for (let i = orders.length - 1; i >= 0; i -= 1) {
      const { column, ascending } = orders[i];
      rows.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (ascending ? 1 : -1));
    }
    const total = rows.length;
    const page = rows.slice(0, limit);
    const wantsCount = /count=exact/.test(headers.get("prefer") ?? "");
    const range = page.length === 0 ? `*/${wantsCount ? total : "*"}` : `0-${page.length - 1}/${wantsCount ? total : "*"}`;
    return new Response(init?.method === "HEAD" ? null : JSON.stringify(page), { status: 200, headers: { "content-type": "application/json", "content-range": range } });
  };
}

function makeClient(tables: Record<string, Row[]>) {
  const log: { url: string; prefer: string | null }[] = [];
  const client = createClient("http://localhost:54321", "publishable-key-de-prueba", { global: { fetch: postgrestFetch(tables, log) }, auth: { persistSession: false } });
  return { client, log };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("cliente real: 1.500 filas con orden compuesto (name, id) → lectura completa por claves, 4 páginas de ≤ 500 + la vacía", async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({ id: uuid(i + 1), owner_id: OWNER, name: `N${String(i % 40).padStart(2, "0")}` }));
  const { client, log } = makeClient({ students: rows });
  const result = await readTable<Row>(client as never, "students", {
    filter: (q) => q.eq("owner_id", OWNER),
    order: [{ column: "name", ascending: true }, { column: "id", ascending: true }],
  });
  assert.equal(result.length, 1500);
  assert.equal(new Set(result.map((r) => r.id)).size, 1500);
  const sorted = [...rows].sort((a, b) => (String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : String(a.id) < String(b.id) ? -1 : 1));
  assert.deepEqual(result.map((r) => r.id), sorted.map((r) => r.id));
  // La primera petición pide el recuento exacto y todas llevan el filtro de propietario y un límite acotado.
  assert.match(log[0].prefer ?? "", /count=exact/);
  assert.ok(log.every((entry) => /owner_id=eq\./.test(entry.url) && /limit=500/.test(entry.url)));
  // Forma exacta de la página por clave (segunda lectura ordenada): or=(name.gt."…",and(name.eq."…",id.gt."…")) y order=name.asc,id.asc
  const keyset = log.find((entry) => decodeURIComponent(entry.url).includes("or=(name.gt."));
  assert.ok(keyset, "hay una página por clave");
  const decoded = decodeURIComponent(keyset.url);
  assert.match(decoded, /or=\(name\.gt\."N\d\d",and\(name\.eq\."N\d\d",id\.gt\."[0-9a-f-]{36}"\)\)/);
  assert.match(decoded, /order=name\.asc,id\.asc/);
});

test("cliente real: clave en una columna única (id) usa el filtro simple id=gt.… (sin or)", async () => {
  const rows = Array.from({ length: 1200 }, (_, i) => ({ id: uuid(i + 1), owner_id: OWNER }));
  const { client, log } = makeClient({ payment_allocations: rows });
  const result = await readTable<Row>(client as never, "payment_allocations", { filter: (q) => q.eq("owner_id", OWNER) });
  assert.equal(result.length, 1200);
  assert.ok(log.some((entry) => /[?&]id=gt\./.test(entry.url)));
  assert.ok(!log.some((entry) => /[?&]or=/.test(entry.url)));
});

test("cliente real: valores con comillas, comas y paréntesis viajan escapados y vuelven completos", async () => {
  const names = ['Ana "la" Gómez', "Pérez, Juan", "O'Brien (hijo)", "a.b.c", "back\\slash"];
  const rows = Array.from({ length: 700 }, (_, i) => ({ id: uuid(i + 1), owner_id: OWNER, name: names[i % names.length] }));
  const { client } = makeClient({ students: rows });
  const result = await readTable<Row>(client as never, "students", {
    filter: (q) => q.eq("owner_id", OWNER),
    order: [{ column: "name", ascending: true }, { column: "id", ascending: true }],
    pageSize: 50,
  });
  assert.equal(result.length, 700);
  assert.equal(new Set(result.map((r) => r.id)).size, 700);
});

test("cliente real: 450 ids → lotes con in.(…) de ≤ 100 ids, URL corta, resultado completo", async () => {
  const lessonIds = Array.from({ length: 450 }, (_, i) => uuid(i + 1));
  const participants = lessonIds.flatMap((id, i) => [{ id: uuid(10000 + i * 2), owner_id: OWNER, calendar_lesson_id: id }, { id: uuid(10001 + i * 2), owner_id: OWNER, calendar_lesson_id: id }]);
  const { client, log } = makeClient({ calendar_lesson_participants: participants });
  const rows = await readTableByIds<Row>(client as never, "calendar_lesson_participants", { matchColumn: "calendar_lesson_id", ids: lessonIds, filter: (q) => q.eq("owner_id", OWNER) });
  assert.equal(rows.length, 900);
  const sizes = log.map((entry) => {
    const match = /calendar_lesson_id=in\.\(([^)]*)\)/.exec(decodeURIComponent(entry.url));
    return match ? match[1].split(",").length : 0;
  });
  assert.ok(Math.max(...sizes) <= 100, `lote máximo ${Math.max(...sizes)}`);
  assert.ok(log.every((entry) => entry.url.length < 8000));
});

test("cliente real: RPC de conjunto (rpc + order/gt sobre sus columnas + recuento exacto)", async () => {
  const rows = Array.from({ length: 1100 }, (_, i) => ({ charge_id: uuid(i + 1), paid_amount: 0 }));
  const log: { url: string; prefer: string | null }[] = [];
  const impl = postgrestFetch({ "rpc/list_open_charge_balances": rows }, log);
  const client = createClient("http://localhost:54321", "k", { global: { fetch: impl }, auth: { persistSession: false } });
  const result = await readRpc<Row>(client as never, "list_open_charge_balances", {}, { order: [{ column: "charge_id", ascending: true }], idColumn: "charge_id" });
  assert.equal(result.length, 1100);
  assert.ok(log.every((entry) => entry.url.startsWith("/rest/v1/rpc/list_open_charge_balances")));
  assert.ok(log.some((entry) => /charge_id=gt\./.test(entry.url)));
});

test("cliente real: una página vacía y un recuento cero devuelven lista vacía en una sola petición", async () => {
  const { client, log } = makeClient({ students: [] });
  const result = await readTable<Row>(client as never, "students", { filter: (q) => q.eq("owner_id", OWNER) });
  assert.deepEqual(result, []);
  assert.equal(log.length, 1);
});
