/**
 * Lectura COMPLETA y verificable de un conjunto de filas a través de PostgREST (R2).
 *
 * Problema que resuelve: PostgREST corta en silencio cualquier respuesta en `max_rows` (el repo declara 1000 en
 * `supabase/config.toml`; el valor remoto se trata como DESCONOCIDO). Una lectura sin paginar devuelve entonces las
 * primeras N filas SIN error y los saldos, la asistencia o el calendario se calculan sobre datos incompletos.
 *
 * Diseño:
 *  - Paginación por CLAVE (keyset), no por `offset`: cada página pide `limit` filas posteriores a la última ya leída según
 *    un orden estable y determinista cuya última columna es única (`id`). Una inserción o eliminación entre páginas nunca
 *    duplica ni omite filas que existían durante toda la lectura (con `offset` sí podría).
 *  - Nunca se asume que una página con exactamente `max_rows` (o `pageSize`) filas sea la última, ni que una más corta lo
 *    sea. CAMINO RÁPIDO (cuentas chicas): una sola petición con el orden ORIGINAL de la consulta (sin el desempate por `id`
 *    ni filtro de clave) y el recuento exacto; si trajo todas las filas (`filas === recuento`) termina ahí con el MISMO
 *    resultado y el mismo orden que antes de R2. Si no (hay más filas que una página, o el servidor no dio recuento), se
 *    descarta y se lee por claves, página a página, hasta recibir una página VACÍA. No depende del valor real de `max_rows`.
 *  - Cualquier error de cualquier página se propaga (nunca se devuelve un parcial como si fuera completo). Una respuesta
 *    sin arreglo, una fila repetida (el filtro de clave no se aplicó) o un recuento final que no coincide con lo leído
 *    (con una relectura que lo confirma) también fallan de forma visible.
 *
 * Este archivo no importa nada de Next/Supabase para poder probarse con `node --test`.
 */

export const READ_PAGE_SIZE = 500;
/** Tope de seguridad: nunca un bucle sin fin (400 páginas × 500 = 200.000 filas por lectura). */
export const READ_MAX_PAGES = 400;
/** Reintentos completos si el recuento final muestra que los datos cambiaron mientras se leían. */
const READ_MAX_ATTEMPTS = 3;

export interface OrderKey {
  /** Columna NOT NULL (un valor nulo no se puede usar como clave de página). */
  column: string;
  ascending: boolean;
}

/** Valores de las columnas de orden de la última fila leída. */
export type KeysetCursor = Record<string, string | number | boolean>;

/**
 * Subconjunto mínimo del constructor de consultas de PostgREST que necesita el helper. `supabase-js` lo cumple
 * estructuralmente; las pruebas usan un PostgREST de mentira con el mismo contrato.
 */
export interface PagedQuery extends PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  order(column: string, options?: { ascending?: boolean }): PagedQuery;
  limit(count: number): PagedQuery;
  or(filters: string): PagedQuery;
  gt(column: string, value: string | number | boolean): PagedQuery;
  lt(column: string, value: string | number | boolean): PagedQuery;
}

/** Devuelve la consulta base (tabla/RPC + filtros propios); `count` pide el recuento exacto (sólo la primera página). */
export type PagedSelect = (options: { count: boolean }) => PagedQuery;

/** Incompleta/inconsistente: nunca contiene datos de filas, sólo la causa. */
export class IncompleteReadError extends Error {
  readonly code = "INCOMPLETE_READ";
  constructor(reason: string) {
    super(`Lectura incompleta: ${reason}`);
    this.name = "IncompleteReadError";
  }
}

/** Escapa un valor para usarlo entre comillas dentro de un filtro lógico de PostgREST (`or=(...)`). */
function quote(value: string | number | boolean): string {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Filtro "estrictamente posterior al cursor" para el orden dado:
 *   (k0 op0 v0) OR (k0 = v0 AND k1 op1 v1) OR (k0 = v0 AND k1 = v1 AND k2 op2 v2) …
 * con `op` = `gt` si la columna es ascendente y `lt` si es descendente. Con una sola clave devuelve `null` y `applyKeyset`
 * usa el filtro simple `.gt/.lt`.
 */
export function buildKeysetOrFilter(order: readonly OrderKey[], cursor: KeysetCursor): string {
  const terms: string[] = [];
  for (let i = 0; i < order.length; i += 1) {
    const equalities = order.slice(0, i).map((key) => `${key.column}.eq.${quote(readCursor(cursor, key.column))}`);
    const key = order[i];
    const own = `${key.column}.${key.ascending ? "gt" : "lt"}.${quote(readCursor(cursor, key.column))}`;
    terms.push(equalities.length === 0 ? own : `and(${[...equalities, own].join(",")})`);
  }
  return terms.join(",");
}

function readCursor(cursor: KeysetCursor, column: string): string | number | boolean {
  const value = cursor[column];
  if (value === undefined || value === null) throw new IncompleteReadError("la fila no trae la columna de orden");
  return value;
}

function applyOrder(query: PagedQuery, order: readonly OrderKey[]): PagedQuery {
  let ordered = query;
  for (const key of order) ordered = ordered.order(key.column, { ascending: key.ascending });
  return ordered;
}

export function applyKeyset(query: PagedQuery, order: readonly OrderKey[], cursor: KeysetCursor | null): PagedQuery {
  if (cursor === null) return query;
  if (order.length === 1) {
    const [key] = order;
    const value = readCursor(cursor, key.column);
    return key.ascending ? query.gt(key.column, value) : query.lt(key.column, value);
  }
  return query.or(buildKeysetOrFilter(order, cursor));
}

function toCursor(row: Record<string, unknown>, order: readonly OrderKey[]): KeysetCursor {
  const cursor: KeysetCursor = {};
  for (const key of order) {
    const value = row[key.column];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new IncompleteReadError("la fila no trae la columna de orden");
    }
    cursor[key.column] = value;
  }
  return cursor;
}

export interface ReadAllOptions {
  /** Orden estable: la ÚLTIMA clave debe ser única (normalmente `id`). */
  order: readonly OrderKey[];
  /** Columna única que identifica la fila (para detectar repetidos). Por defecto `id`. */
  idColumn?: string;
  pageSize?: number;
  maxPages?: number;
}

async function runPage(
  select: PagedSelect,
  order: readonly OrderKey[],
  cursor: KeysetCursor | null,
  limit: number,
  withCount: boolean
): Promise<{ rows: Record<string, unknown>[]; count: number | null }> {
  let query = select({ count: withCount });
  query = applyOrder(query, order);
  query = applyKeyset(query, order, cursor);
  query = query.limit(limit);
  const { data, error, count } = await query;
  if (error) throw error;
  if (!Array.isArray(data)) throw new IncompleteReadError("la respuesta no es una lista");
  return { rows: data as Record<string, unknown>[], count: typeof count === "number" ? count : null };
}

/** Recuento exacto actual (sin filas) — sólo para confirmar un faltante tras leer todas las páginas. */
async function recount(select: PagedSelect): Promise<number | null> {
  const { count } = await runPage(select, [], null, 1, true);
  return count;
}

export async function readAllRows<Row = Record<string, unknown>>(select: PagedSelect, options: ReadAllOptions): Promise<Row[]> {
  const { order } = options;
  if (order.length === 0) throw new Error("readAllRows exige un orden estable");
  const idColumn = options.idColumn ?? "id";
  const pageSize = options.pageSize ?? READ_PAGE_SIZE;
  const maxPages = options.maxPages ?? READ_MAX_PAGES;
  if (pageSize < 1) throw new Error("pageSize inválido");

  let lastReason = "los datos cambiaron mientras se leían";
  // Camino rápido: el orden original de la consulta es el de `order` sin el desempate final por la columna única.
  const legacyOrder = order[order.length - 1].column === idColumn ? order.slice(0, -1) : order;
  const fast = await runPage(select, legacyOrder, null, pageSize, true);
  if (fast.count !== null && fast.rows.length === fast.count) return fast.rows as Row[];

  for (let attempt = 1; attempt <= READ_MAX_ATTEMPTS; attempt += 1) {
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<unknown>();
    let cursor: KeysetCursor | null = null;
    let total: number | null = null;

    for (let page = 0; ; page += 1) {
      if (page >= maxPages) throw new IncompleteReadError("se superó el máximo de páginas");
      const result = await runPage(select, order, cursor, pageSize, page === 0);
      if (page === 0) total = result.count;
      if (result.rows.length === 0) break;
      for (const row of result.rows) {
        const id = row[idColumn];
        if (seen.has(id)) throw new IncompleteReadError("una fila apareció dos veces entre páginas");
        seen.add(id);
        rows.push(row);
      }
      // Camino rápido (cuentas chicas): la primera página ya trajo TODAS las filas que existían — una sola petición.
      if (page === 0 && total !== null && result.rows.length === total) return rows as Row[];
      cursor = toCursor(result.rows[result.rows.length - 1], order);
    }

    if (total === null || rows.length === total) return rows as Row[];
    // Distinto del recuento inicial: ¿cambiaron los datos mientras se leía (alta/baja) o falta algo? Se confirma con otra lectura.
    const current = await recount(select);
    if (current === rows.length) return rows as Row[];
    lastReason = "el recuento final no coincide con las filas leídas";
  }
  throw new IncompleteReadError(lastReason);
}
