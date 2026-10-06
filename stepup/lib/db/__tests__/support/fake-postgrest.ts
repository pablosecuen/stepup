/**
 * PostgREST de MENTIRA (sólo pruebas) con el comportamiento que importa para R2:
 *  - `max_rows`: corta en silencio cualquier respuesta (como PostgREST real), también con `limit` mayor.
 *  - `Content-Range`/recuento exacto (`count: "exact"`), `head`.
 *  - límite de longitud de URL: una lista `in` demasiado larga falla (como el gateway, ~8 KB).
 *  - filtros `eq/neq/in/is/gt/gte/lt/lte/or(and(...))` (las comillas dobles y el escape se interpretan igual que PostgREST).
 *  - orden con `nullsFirst` y desempate por la propia fila (el orden real del llamador decide).
 *  - inyección de errores por llamada, RPC con manejadores, escrituras registradas (insert/update/delete/rpc de escritura).
 * No simula RLS salvo que se pida (`rls`): por defecto un repositorio que olvide `.eq("owner_id", …)` ve filas ajenas, y así
 * las pruebas detectan ese olvido.
 */

export type Row = Record<string, unknown>;

export interface FakeCall {
  kind: "select" | "rpc" | "write";
  table: string;
  /** Longitud aproximada de la URL (query string) de la solicitud. */
  urlLength: number;
  /** Tamaño de cada lista `in` enviada. */
  inSizes: number[];
  limit: number | null;
  rowsReturned: number;
  keyset: boolean;
  withCount: boolean;
  head: boolean;
  /** Valores `eq("owner_id", …)` enviados (para comprobar el aislamiento). */
  ownerFilters: string[];
}

export interface FakeOptions {
  tables?: Record<string, Row[]>;
  maxRows?: number;
  maxUrlLength?: number;
  rpcs?: Record<string, (args: Record<string, unknown>, fake: FakePostgrest) => Row[] | unknown>;
  /** Si es `true`, cada tabla se filtra por `owner_id === currentOwner` como haría RLS. */
  rls?: boolean;
  currentOwner?: string;
  /** Devuelve un error para fallar la llamada número `index` (0-based, contando todas). */
  failCall?: (index: number, call: FakeCall) => unknown | null;
  /** Se ejecuta DESPUÉS de cada llamada de lectura (para simular altas/bajas entre páginas). */
  afterCall?: (index: number, call: FakeCall, fake: FakePostgrest) => void;
}

type Predicate = (row: Row) => boolean;

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  // Instantes: se comparan por tiempo real (Postgres compara timestamptz, no texto).
  if (typeof a === "string" && typeof b === "string" && TIMESTAMP.test(a) && TIMESTAMP.test(b)) return Date.parse(a) - Date.parse(b);
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function coerce(column: unknown, raw: string): unknown {
  return typeof column === "number" ? Number(raw) : raw;
}

// --- parser de `or=(...)` / `and(...)` con valores entre comillas dobles (escape con \) -----------------------------------
function parseLogical(input: string): Predicate {
  let position = 0;
  const peek = () => input[position];
  function readQuoted(): string {
    position += 1; // comilla de apertura
    let out = "";
    while (position < input.length && input[position] !== '"') {
      if (input[position] === "\\") position += 1;
      out += input[position];
      position += 1;
    }
    position += 1; // comilla de cierre
    return out;
  }
  function readUntil(stops: string): string {
    let out = "";
    while (position < input.length && !stops.includes(input[position])) {
      out += input[position];
      position += 1;
    }
    return out;
  }
  function parseTerm(): Predicate {
    if (input.startsWith("and(", position)) {
      position += 4;
      const parts: Predicate[] = [parseTerm()];
      while (peek() === ",") {
        position += 1;
        parts.push(parseTerm());
      }
      position += 1; // ")"
      return (row) => parts.every((part) => part(row));
    }
    const column = readUntil(".");
    position += 1;
    const operator = readUntil(".");
    position += 1;
    const value = peek() === '"' ? readQuoted() : readUntil(",)");
    return (row) => {
      const actual = row[column];
      if (operator === "is") return value === "null" ? actual === null || actual === undefined : String(actual) === value;
      if (actual === null || actual === undefined) return false;
      const expected = coerce(actual, value);
      const c = compare(actual, expected);
      switch (operator) {
        case "eq": return c === 0;
        case "gt": return c > 0;
        case "gte": return c >= 0;
        case "lt": return c < 0;
        case "lte": return c <= 0;
        default: throw new Error(`operador no soportado por el PostgREST de mentira: ${operator}`);
      }
    };
  }
  const terms: Predicate[] = [parseTerm()];
  while (peek() === ",") {
    position += 1;
    terms.push(parseTerm());
  }
  if (position !== input.length) throw new Error(`filtro lógico inválido: ${input}`);
  return (row) => terms.some((term) => term(row));
}

export class FakePostgrest {
  tables: Record<string, Row[]>;
  readonly maxRows: number;
  readonly maxUrlLength: number;
  readonly calls: FakeCall[] = [];
  private readonly options: FakeOptions;

  constructor(options: FakeOptions = {}) {
    this.options = options;
    this.tables = options.tables ?? {};
    this.maxRows = options.maxRows ?? 1000;
    this.maxUrlLength = options.maxUrlLength ?? 8000;
  }

  /** Cantidad de llamadas de ESCRITURA (insert/update/delete/rpc marcado como escritura). */
  get writeCalls(): FakeCall[] {
    return this.calls.filter((call) => call.kind === "write");
  }

  from(table: string) {
    return new Builder(this, table, "select");
  }

  rpc(fn: string, args: Record<string, unknown> = {}, opts?: { count?: "exact" }) {
    const handler = this.options.rpcs?.[fn];
    const builder = new Builder(this, fn, "rpc");
    builder.rpcHandler = handler ? () => handler(args, this) : () => {
      throw new Error(`RPC sin manejador: ${fn}`);
    };
    builder.withCount = opts?.count === "exact";
    builder.urlExtra = JSON.stringify(args).length;
    return builder;
  }

  /** Uso interno del builder. */
  dispatch(builder: Builder): { data: unknown; error: unknown; count: number | null } {
    const index = this.calls.length;
    let rows: Row[];
    if (builder.kind === "rpc") {
      const result = builder.rpcHandler!();
      rows = Array.isArray(result) ? (result as Row[]) : [];
      if (!Array.isArray(result)) {
        const call = this.record(builder, 0);
        this.calls[this.calls.length - 1].kind = "write";
        const injected = this.options.failCall?.(index, call);
        return injected ? { data: null, error: injected, count: null } : { data: result, error: null, count: null };
      }
    } else {
      rows = [...(this.tables[builder.table] ?? [])];
      if (this.options.rls && this.options.currentOwner !== undefined) rows = rows.filter((row) => row.owner_id === this.options.currentOwner);
    }
    if (builder.urlLength() > this.maxUrlLength) {
      this.record(builder, 0);
      return { data: null, error: { code: "414", message: "URI demasiado larga" }, count: null };
    }
    for (const predicate of builder.predicates) rows = rows.filter(predicate);
    const total = rows.length;
    for (let i = builder.orders.length - 1; i >= 0; i -= 1) {
      const { column, ascending, nullsFirst } = builder.orders[i];
      const nullsAtStart = nullsFirst ?? !ascending;
      rows.sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        const an = av === null || av === undefined;
        const bn = bv === null || bv === undefined;
        if (an || bn) return an && bn ? 0 : an ? (nullsAtStart ? -1 : 1) : nullsAtStart ? 1 : -1;
        return ascending ? compare(av, bv) : compare(bv, av);
      });
    }
    const limit = builder.limitValue === null ? this.maxRows : Math.min(builder.limitValue, this.maxRows);
    const page = builder.headOnly ? [] : rows.slice(0, limit);
    const call = this.record(builder, page.length);
    const injected = this.options.failCall?.(index, call);
    if (injected) return { data: null, error: injected, count: null };
    const out = { data: builder.headOnly ? null : page, error: null, count: builder.withCount ? total : null };
    this.options.afterCall?.(index, call, this);
    return out;
  }

  record(builder: Builder, rowsReturned: number): FakeCall {
    const call: FakeCall = {
      kind: builder.kind === "rpc" ? "rpc" : "select",
      table: builder.table,
      urlLength: builder.urlLength(),
      inSizes: builder.inSizes,
      limit: builder.limitValue,
      rowsReturned,
      keyset: builder.usedKeyset,
      withCount: builder.withCount,
      head: builder.headOnly,
      ownerFilters: builder.ownerFilters,
    };
    this.calls.push(call);
    return call;
  }

  recordWrite(table: string, builder: Builder): FakeCall {
    const call = this.record(builder, 0);
    call.kind = "write";
    call.table = table;
    return call;
  }
}

class Builder implements PromiseLike<{ data: unknown; error: unknown; count: number | null }> {
  predicates: Predicate[] = [];
  orders: { column: string; ascending: boolean; nullsFirst?: boolean }[] = [];
  limitValue: number | null = null;
  withCount = false;
  headOnly = false;
  inSizes: number[] = [];
  ownerFilters: string[] = [];
  usedKeyset = false;
  rpcHandler: (() => unknown) | null = null;
  urlExtra = 0;
  private urlParts: string[] = [];
  private single: "single" | "maybe" | null = null;
  private writeKind: string | null = null;

  private readonly fake: FakePostgrest;
  readonly table: string;
  readonly kind: "select" | "rpc";

  constructor(fake: FakePostgrest, table: string, kind: "select" | "rpc") {
    this.fake = fake;
    this.table = table;
    this.kind = kind;
  }

  urlLength(): number {
    return this.urlParts.join("&").length + this.urlExtra;
  }

  select(_columns?: string, options?: { count?: "exact"; head?: boolean }) {
    this.withCount = options?.count === "exact";
    this.headOnly = options?.head === true;
    return this;
  }

  private add(part: string, predicate: Predicate) {
    this.urlParts.push(part);
    this.predicates.push(predicate);
    return this;
  }

  eq(column: string, value: unknown) {
    if (column === "owner_id") this.ownerFilters.push(String(value));
    return this.add(`${column}=eq.${value}`, (row) => row[column] === value);
  }
  neq(column: string, value: unknown) { return this.add(`${column}=neq.${value}`, (row) => row[column] !== value); }
  is(column: string, value: null | boolean) { return this.add(`${column}=is.${value}`, (row) => (value === null ? row[column] === null || row[column] === undefined : row[column] === value)); }
  gt(column: string, value: string | number) { return this.add(`${column}=gt.${value}`, (row) => row[column] != null && compare(row[column], value) > 0); }
  gte(column: string, value: string | number) { return this.add(`${column}=gte.${value}`, (row) => row[column] != null && compare(row[column], value) >= 0); }
  lt(column: string, value: string | number) { return this.add(`${column}=lt.${value}`, (row) => row[column] != null && compare(row[column], value) < 0); }
  lte(column: string, value: string | number) { return this.add(`${column}=lte.${value}`, (row) => row[column] != null && compare(row[column], value) <= 0); }
  not(column: string, operator: string, value: unknown) {
    if (operator !== "is") throw new Error("not() sólo soporta `is` en el PostgREST de mentira");
    return this.add(`${column}=not.is.${value}`, (row) => !(value === null ? row[column] === null || row[column] === undefined : row[column] === value));
  }
  in(column: string, values: readonly unknown[]) {
    this.inSizes.push(values.length);
    const set = new Set(values);
    return this.add(`${column}=in.(${values.join(",")})`, (row) => set.has(row[column]));
  }
  or(filters: string) {
    this.usedKeyset = true;
    return this.add(`or=(${encodeURIComponent(filters)})`, parseLogical(filters));
  }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.urlParts.push(`order=${column}`);
    this.orders.push({ column, ascending: options?.ascending !== false, nullsFirst: options?.nullsFirst });
    return this;
  }
  limit(count: number) {
    this.limitValue = count;
    this.urlParts.push(`limit=${count}`);
    return this;
  }
  maybeSingle() { this.single = "maybe"; return this; }

  // Escrituras: se registran (para probar "GET no escribe") y se aplican de forma mínima.
  insert(_values: unknown) { this.writeKind = "insert"; return this; }
  update(_values: unknown) { this.writeKind = "update"; return this; }
  delete() { this.writeKind = "delete"; return this; }
  upsert(_values: unknown) { this.writeKind = "upsert"; return this; }

  then<TResult1 = { data: unknown; error: unknown; count: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    let result: { data: unknown; error: unknown; count: number | null };
    try {
      if (this.writeKind) {
        this.fake.recordWrite(this.table, this);
        result = { data: null, error: null, count: null };
      } else {
        result = this.fake.dispatch(this);
        if (this.single && !result.error && Array.isArray(result.data)) {
          result = { ...result, data: result.data[0] ?? null };
        }
      }
    } catch (error) {
      return Promise.reject(error).then(onfulfilled, onrejected);
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

/** Fila sintética con `id` uuid determinista y `owner_id`. */
export function uuid(n: number, prefix = "00000000"): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
