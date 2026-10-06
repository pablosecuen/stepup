/**
 * Lecturas completas sobre tablas/RPC de Supabase (R2) — capa fina entre los repositorios y `paged-read.ts`.
 *
 * Reglas que cumple cada función de acá:
 *  - Siempre pagina por clave con un orden determinista cuya última columna es única (`id`): nunca depende del `max_rows`
 *    real del proyecto ni de que una página llena sea la última (ver `paged-read.ts`).
 *  - Nunca envía una lista de ids ilimitada: `readTableByIds` procesa los ids en lotes de `MAX_IDS_PER_REQUEST` (100),
 *    sin duplicados, y un fallo en cualquier lote hace fallar toda la lectura (nunca un parcial silencioso).
 *  - El filtro de propietario lo agrega el llamador en `filter` (los repositorios siempre ponen `owner_id = ownerId`); acá
 *    no se acepta ningún `owner_id` "de afuera": el aislamiento real sigue siendo RLS + ese filtro explícito.
 */
import { readAllRows, type OrderKey, type PagedQuery, type PagedSelect } from "./paged-read.ts";

/** Máximo de ids por solicitud (`.in()`): con uuid de 36 caracteres, 100 ids ≈ 4 KB, bien por debajo del límite de línea (~8 KB). */
export const MAX_IDS_PER_REQUEST = 100;

/** Subconjunto del cliente de Supabase que usan las lecturas (lo cumple `SupabaseClient`; las pruebas usan un PostgREST de mentira). */
export interface ReadClient {
  from(table: string): {
    select(columns?: string, options?: { count?: "exact"; head?: boolean }): any;
  };
  rpc(fn: string, args?: Record<string, unknown>, options?: { count?: "exact" }): any;
}

export const ID_ORDER: readonly OrderKey[] = [{ column: "id", ascending: true }];

export interface ReadTableOptions {
  columns?: string;
  /** Filtros propios de la consulta (siempre incluye `owner_id`). Debe devolver el mismo constructor. */
  filter?: (query: any) => any;
  /** Orden estable; la última clave debe ser única. Por defecto `id` ascendente. */
  order?: readonly OrderKey[];
  idColumn?: string;
  pageSize?: number;
}

function tableSelect(client: ReadClient, table: string, options: ReadTableOptions): PagedSelect {
  const columns = options.columns ?? "*";
  const filter = options.filter ?? ((query) => query);
  return ({ count }) => filter(client.from(table).select(columns, count ? { count: "exact" } : undefined)) as PagedQuery;
}

/** TODAS las filas de una tabla que cumplen el filtro, paginadas por clave. */
export function readTable<Row = Record<string, unknown>>(client: ReadClient, table: string, options: ReadTableOptions = {}): Promise<Row[]> {
  return readAllRows<Row>(tableSelect(client, table, options), {
    order: options.order ?? ID_ORDER,
    idColumn: options.idColumn,
    pageSize: options.pageSize,
  });
}

/** TODAS las filas que devuelve una función de conjunto (RPC `returns table`), paginadas por clave sobre sus columnas. */
export function readRpc<Row = Record<string, unknown>>(
  client: ReadClient,
  fn: string,
  args: Record<string, unknown>,
  options: { order: readonly OrderKey[]; idColumn: string; pageSize?: number }
): Promise<Row[]> {
  const select: PagedSelect = ({ count }) => client.rpc(fn, args, count ? { count: "exact" } : undefined) as PagedQuery;
  return readAllRows<Row>(select, { order: options.order, idColumn: options.idColumn, pageSize: options.pageSize });
}

/** Presupuesto de caracteres de ids por solicitud (≈ 4,5 KB): deja margen bajo el límite de línea (~8 KB) con ids más largos que un uuid. */
export const MAX_ID_CHARS_PER_REQUEST = 4500;

/**
 * Ids sin duplicados ni vacíos, en lotes de a lo sumo `size` ids (por defecto 100) y `maxChars` caracteres (por defecto
 * 4.500: con uuid son 100 ids; con ids más largos, p. ej. `individual:<uuid>:<uuid>`, el lote se achica solo), conservando
 * el orden de aparición.
 */
export function chunkIds(ids: readonly string[], size: number = MAX_IDS_PER_REQUEST, maxChars: number = MAX_ID_CHARS_PER_REQUEST): string[][] {
  if (size < 1 || maxChars < 1) throw new Error("tamaño de lote inválido");
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  const chunks: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const id of unique) {
    const cost = id.length + 1;
    if (current.length > 0 && (current.length >= size || chars + cost > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(id);
    chars += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface ReadByIdsOptions extends ReadTableOptions {
  /** Columna que se compara contra la lista (`in`). */
  matchColumn: string;
  ids: readonly string[];
  batchSize?: number;
}

/**
 * Filas cuyo `matchColumn` está en `ids`, en lotes de a lo sumo 100 ids. Cada lote se pagina por clave (un lote puede traer
 * más filas que ids, p. ej. los participantes de 100 clases). Se unen sin duplicados (por `id`); el resultado conserva el
 * orden de los lotes y, dentro de cada uno, el orden de la consulta — el llamador que necesite un orden global lo aplica
 * explícitamente. Si falla cualquier lote, falla toda la lectura.
 */
export async function readTableByIds<Row = Record<string, unknown>>(client: ReadClient, table: string, options: ReadByIdsOptions): Promise<Row[]> {
  const idColumn = options.idColumn ?? "id";
  const baseFilter = options.filter ?? ((query) => query);
  const out: Row[] = [];
  const seen = new Set<unknown>();
  for (const batch of chunkIds(options.ids, options.batchSize)) {
    const rows = await readTable<Row>(client, table, {
      ...options,
      filter: (query) => baseFilter(query).in(options.matchColumn, batch),
    });
    for (const row of rows) {
      const id = (row as Record<string, unknown>)[idColumn];
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
  }
  return out;
}

/** Recuento exacto de las filas de una tabla que cumplen el filtro (consulta `head`, sin traer filas). */
export async function countTable(client: ReadClient, table: string, filter?: (query: any) => any): Promise<number> {
  const base = client.from(table).select("id", { count: "exact", head: true });
  const { count, error } = await (filter ? filter(base) : base);
  if (error) throw error;
  if (typeof count !== "number") throw new Error("Recuento no disponible.");
  return count;
}
