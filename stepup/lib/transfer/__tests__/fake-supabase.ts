import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Supabase de mentira, local y con datos SINTÉTICOS, para probar el circuito del traslado de punta a punta sin tocar ninguna red ni Production.
 * Habla lo justo del protocolo real: salud y contraseña de GoTrue, cierre de sesión, la función del respaldo y la lectura de tablas de PostgREST.
 */

export type FakeAuthMode = "ok" | "health_500" | "health_401" | "token_500" | "token_429" | "token_unconfirmed";

export interface FakeSupabaseOptions {
  email: string;
  password: string;
  userId?: string;
  backupPayload: unknown;
  backupCreatedAt?: string;
  /** Tablas del destino (nombre → filas). */
  tables: Record<string, Record<string, unknown>[]>;
  /** Tablas que "todavía no existen" (R9/R10 sin aplicar). */
  missingTables?: string[];
}

export interface FakeSupabase {
  url: string;
  mode: FakeAuthMode;
  /** Lo que recibió el servidor (sin cuerpos): método, ruta y, para el cierre de sesión, el alcance. */
  calls: { method: string; path: string; scope?: string }[];
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startFakeSupabase(options: FakeSupabaseOptions): Promise<FakeSupabase> {
  const userId = options.userId ?? "00000000-0000-4000-8000-0000000000aa";
  const token = "fake-access-token";
  const state: FakeSupabase = { url: "", mode: "ok", calls: [], close: async () => {} };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, payload?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const raw = await body(req);
    state.calls.push({ method: req.method ?? "GET", path: url.pathname, ...(url.pathname === "/auth/v1/logout" ? { scope: url.searchParams.get("scope") ?? "" } : {}) });
    if (url.pathname === "/auth/v1/health") {
      if (state.mode === "health_500") return send(503, { message: "caído" });
      if (state.mode === "health_401") return send(401, { message: "Invalid API key" });
      return send(200, { name: "GoTrue" });
    }
    if (url.pathname === "/auth/v1/token") {
      if (state.mode === "token_500") return send(500, { code: 500, error_code: "unexpected_failure", msg: "boom" });
      if (state.mode === "token_429") return send(429, { code: 429, error_code: "over_request_rate_limit", msg: "slow down" });
      const credentials = JSON.parse(raw || "{}") as { email?: string; password?: string };
      if (credentials.email === options.email && credentials.password !== options.password) return send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      if (credentials.email !== options.email) return send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      if (state.mode === "token_unconfirmed") return send(400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
      return send(200, {
        access_token: token,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "fake-refresh",
        user: { id: userId, aud: "authenticated", role: "authenticated", email: options.email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
      });
    }
    if (url.pathname === "/auth/v1/logout") return send(204);
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: "JWT inválido", code: "PGRST301" });
    if (url.pathname === "/rest/v1/rpc/fetch_own_latest_cloud_backup") {
      return send(200, [{ id: "backup-1", schema_version: 2, app_version: "1.0.0", checksum: "a".repeat(64), created_at: options.backupCreatedAt ?? new Date().toISOString(), payload: options.backupPayload }]);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      if (options.missingTables?.includes(table) || !(table in options.tables)) return send(404, { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` });
      const rows = options.tables[table];
      return send(200, rows, { "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0" });
    }
    return send(404, { message: "no existe" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
  return state;
}
