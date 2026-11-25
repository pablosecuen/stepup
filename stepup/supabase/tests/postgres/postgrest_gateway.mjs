// PASARELA LOCAL con la semántica de PostgREST/GoTrue/Storage (subconjunto que usa TeacherFlow) delante de un Postgres REAL aislado.
// NO es Supabase: no hay Docker ni un proyecto de prueba. Sirve para ejercitar la web real (Next) y el cliente supabase-js contra un esquema, RLS, roles y funciones reales,
// sin tocar Production. Ejecuta cada pedido con el rol de la persona (`authenticated`, `auth.uid()` = `sub` del JWT) o `service_role`; no verifica la firma del JWT.
import http from "node:http";

const IDENT = /^[a-z_][a-z0-9_]*$/;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function issueJwt({ sub, role = "authenticated", email = null, ttlSeconds = 3600 }) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role, aud: "authenticated", email, iat: now, exp: now + ttlSeconds, aal: "aal1", amr: [{ method: "password", timestamp: now }], session_id: sub })}.firma-local`;
}

export function decodeJwt(authorization) {
  try {
    const payload = String(authorization ?? "").replace(/^Bearer\s+/i, "").split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) : {};
  } catch {
    return {};
  }
}

function splitTop(text) {
  const parts = [];
  let depth = 0;
  let quote = false;
  let current = "";
  for (const char of text) {
    if (char === '"') quote = !quote;
    if (!quote && char === "(") depth += 1;
    if (!quote && char === ")") depth -= 1;
    if (!quote && depth === 0 && char === ",") {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current) parts.push(current);
  return parts;
}
const unquote = (value) => value.replace(/^"(.*)"$/, "$1");

/** Condición PostgREST (`eq.5`, `not.in.(a,b)`, `is.null`) → SQL con parámetros. */
function condition(column, expression, params) {
  if (!IDENT.test(column)) throw Object.assign(new Error(`columna inválida ${column}`), { status: 400 });
  let negate = false;
  let rest = expression;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const op = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  let sql;
  if (op === "is") sql = `${column} is ${value === "null" ? "null" : value === "true" ? "true" : value === "false" ? "false" : "null"}`;
  else if (op === "in") {
    params.push(splitTop(value.replace(/^\(|\)$/g, "")).map(unquote));
    sql = `${column}::text = any($${params.length}::text[])`;
  } else {
    const map = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };
    if (!map[op]) throw Object.assign(new Error(`operador no emulado ${op}`), { status: 400 });
    params.push(op === "like" || op === "ilike" ? value.replace(/\*/g, "%") : value);
    sql = `${column} ${map[op]} $${params.length}`;
  }
  return negate ? `not (${sql})` : sql;
}

function buildWhere(url, params) {
  const clauses = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    if (key === "or" || key === "and") {
      const inner = splitTop(value.replace(/^\(|\)$/g, "")).map((part) => {
        const [column, ...rest] = part.split(".");
        return condition(column, rest.join("."), params);
      });
      clauses.push(`(${inner.join(key === "or" ? " or " : " and ")})`);
    } else clauses.push(condition(key, value, params));
  }
  return clauses.length ? ` where ${clauses.join(" and ")}` : "";
}

function orderBy(url) {
  const raw = url.searchParams.get("order");
  if (!raw) return "";
  return ` order by ${raw.split(",").map((part) => {
    const [column, ...flags] = part.split(".");
    if (!IDENT.test(column)) throw Object.assign(new Error("orden inválido"), { status: 400 });
    return `${column} ${flags.includes("desc") ? "desc" : "asc"}${flags.includes("nullsfirst") ? " nulls first" : flags.includes("nullslast") ? " nulls last" : ""}`;
  }).join(", ")}`;
}

const columnsOf = (url) => {
  const select = url.searchParams.get("select");
  if (!select || select === "*" || select.includes("(")) return "*";
  const cols = select.split(",").map((col) => col.trim().split(":").pop());
  return cols.every((col) => IDENT.test(col)) ? cols.join(", ") : "*";
};

function pgError(error) {
  const code = String(error.code ?? "");
  const status = error.status ?? (code === "42501" ? 403 : code === "23505" ? 409 : code === "42883" || code === "42P01" ? 404 : 400);
  return { status, body: { code: code || "PGRST000", message: String(error.message), details: error.detail ?? null, hint: error.hint ?? null } };
}

export function createGateway({ pg, users, hits = [], onRequest, admin: adminHandler }) {
  const routines = new Map();
  async function routine(admin, name) {
    if (routines.has(name)) return routines.get(name);
    const meta = (await admin.query(`select p.proretset, t.typname as rettype, t.typtype, coalesce(p.proargnames, '{}') as names, p.proargtypes::oid[] as arg_oids,
        (select array_agg(format_type(o, null)) from unnest(p.proargtypes::oid[]) o) as arg_types
      from pg_proc p join pg_type t on t.oid = p.prorettype join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`, [name])).rows[0] ?? null;
    routines.set(name, meta);
    return meta;
  }

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url, "http://localhost");
    hits.push(`${req.method} ${url.pathname}`);
    onRequest?.(req, url);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };

    // Herramienta de PRUEBA local (no existe en ningún entorno real): acciones de apoyo sobre la base aislada.
    if (url.pathname.startsWith("/__admin/") && adminHandler) {
      try {
        return send(200, (await adminHandler(url)) ?? { ok: true });
      } catch (error) {
        return send(500, { message: String(error.message) });
      }
    }

    // ───────────── GoTrue (inicio de sesión, renovación, usuario y cierre)
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const body = raw ? JSON.parse(raw) : {};
      const grant = url.searchParams.get("grant_type");
      let user = null;
      if (grant === "password") user = users.get(String(body.email ?? "").toLowerCase());
      if (grant === "password" && (!user || user.password !== body.password)) return send(400, { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials", message: "Invalid login credentials" });
      if (grant === "refresh_token") user = [...users.values()].find((candidate) => `r-${candidate.id}` === body.refresh_token);
      if (!user) return send(400, { code: "bad_jwt", msg: "refresh inválido", message: "refresh inválido" });
      const accessToken = issueJwt({ sub: user.id, email: user.email });
      const now = Math.floor(Date.now() / 1000);
      return send(200, { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: `r-${user.id}`, user: { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, email_confirmed_at: "2026-01-01T00:00:00Z", created_at: user.createdAt ?? "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {} } });
    }
    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const claims = decodeJwt(req.headers.authorization);
      const user = [...users.values()].find((candidate) => candidate.id === claims.sub);
      if (!user) return send(401, { code: "bad_jwt", msg: "sin sesión", message: "sin sesión" });
      return send(200, { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, email_confirmed_at: "2026-01-01T00:00:00Z", created_at: user.createdAt ?? "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {} });
    }
    if (url.pathname.startsWith("/auth/v1/")) return send(url.pathname.endsWith("/logout") ? 204 : 200, url.pathname.endsWith("/logout") ? undefined : {});
    if (url.pathname.startsWith("/storage/v1/")) return send(req.method === "GET" ? 404 : 200, url.pathname.includes("/object/sign/") ? { signedURL: "/object/sign/x?token=local" } : []);

    // ───────────── PostgREST
    const claims = decodeJwt(req.headers.authorization);
    const service = claims.role === "service_role";
    const session = await pg.session(service ? "" : (claims.sub ?? ""), service ? "service_role" : claims.sub ? "authenticated" : "anon");
    try {
      const body = raw ? JSON.parse(raw) : null;
      const prefer = String(req.headers.prefer ?? "");
      const wantsRows = /return=representation/.test(prefer);
      const wantsCount = /count=exact/.test(prefer);
      const singleObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
      const rpc = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(url.pathname);
      const table = /^\/rest\/v1\/([a-z_0-9]+)$/.exec(url.pathname);
      if (rpc) {
        const meta = await routine(pg.admin, rpc[1]);
        if (!meta) return send(404, { code: "PGRST202", message: `función ${rpc[1]} no existe`, details: null, hint: null });
        const args = req.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : (body ?? {});
        const keys = Object.keys(args);
        const params = keys.map((key) => {
          const index = meta.names.indexOf(key);
          const type = index >= 0 ? meta.arg_types[index] : "";
          const value = args[key];
          return value !== null && typeof value === "object" && /json/.test(type) ? JSON.stringify(value) : value;
        });
        const call = `public.${rpc[1]}(${keys.map((key, i) => `${key} => $${i + 1}`).join(", ")})`;
        if (meta.rettype === "void") {
          await session.query(`select ${call}`, params);
          return send(204);
        }
        if (meta.proretset) return send(200, (await session.query(`select * from ${call}`, params)).rows);
        if (meta.typtype === "c") return send(200, (await session.query(`select (${call}).*`, params)).rows[0] ?? null);
        return send(200, (await session.query(`select ${call} as v`, params)).rows[0]?.v ?? null);
      }
      if (!table) return send(404, { code: "PGRST125", message: "ruta no emulada", details: null, hint: null });
      const name = table[1];
      const params = [];
      if (req.method === "GET" || req.method === "HEAD") {
        const where = buildWhere(url, params);
        const limit = url.searchParams.get("limit");
        const offset = url.searchParams.get("offset");
        const sql = `select ${columnsOf(url)} from public.${name}${where}${orderBy(url)}${limit ? ` limit ${Number(limit)}` : ""}${offset ? ` offset ${Number(offset)}` : ""}`;
        const result = await session.query(sql, params);
        const headers = {};
        if (wantsCount) {
          const total = Number((await session.query(`select count(*)::int n from public.${name}${where}`, params)).rows[0].n);
          headers["content-range"] = `${result.rows.length ? `${Number(offset ?? 0)}-${Number(offset ?? 0) + result.rows.length - 1}` : "*"}/${total}`;
        }
        if (singleObject) return result.rows.length === 1 ? send(200, result.rows[0], headers) : send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${result.rows.length} rows`, hint: null });
        return send(200, req.method === "HEAD" ? undefined : result.rows, headers);
      }
      if (req.method === "POST") {
        const rows = Array.isArray(body) ? body : [body];
        const keys = Object.keys(rows[0] ?? {});
        const out = [];
        const upsert = /resolution=merge-duplicates|resolution=ignore-duplicates/.test(prefer);
        const conflict = url.searchParams.get("on_conflict");
        for (const row of rows) {
          const values = keys.map((key) => (row[key] !== null && typeof row[key] === "object" ? JSON.stringify(row[key]) : row[key]));
          let sql = `insert into public.${name} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`;
          if (upsert && conflict) sql += ` on conflict (${conflict}) ${/ignore/.test(prefer) ? "do nothing" : `do update set ${keys.map((key) => `${key} = excluded.${key}`).join(", ")}`}`;
          sql += wantsRows ? " returning *" : "";
          out.push(...(await session.query(sql, values)).rows);
        }
        return wantsRows ? send(201, singleObject ? out[0] : out) : send(201);
      }
      if (req.method === "PATCH") {
        const keys = Object.keys(body ?? {});
        const where = buildWhere(url, params);
        const values = keys.map((key) => (body[key] !== null && typeof body[key] === "object" ? JSON.stringify(body[key]) : body[key]));
        const shifted = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + keys.length}`);
        const result = await session.query(`update public.${name} set ${keys.map((key, i) => `${key} = $${i + 1}`).join(", ")}${shifted}${wantsRows ? " returning *" : ""}`, [...values, ...params]);
        return wantsRows ? send(200, singleObject ? (result.rows[0] ?? null) : result.rows) : send(204);
      }
      if (req.method === "DELETE") {
        const where = buildWhere(url, params);
        const result = await session.query(`delete from public.${name}${where}${wantsRows ? " returning *" : ""}`, params);
        return wantsRows ? send(200, result.rows) : send(204);
      }
      return send(405, { code: "PGRST000", message: "método no emulado", details: null, hint: null });
    } catch (error) {
      const mapped = pgError(error);
      return send(mapped.status, mapped.body);
    } finally {
      await session.end();
    }
  });
  return server;
}
