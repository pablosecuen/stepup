// Servidor local con la forma de Supabase (sesión, funciones, lectura con RLS y almacenamiento con sus reglas: tipos permitidos y tope de tamaño de cada bucket) delante de un Postgres REAL aislado.
// Compartido por las pruebas de la extracción del teléfono y del orquestador del traslado. Datos SINTÉTICOS; no toca ninguna red.
//
// Sesión: `/auth/v1/token` con `grant_type=password` (correo → usuario de `auth.users`; la contraseña se comprueba contra `hooks.passwords` si existe) y `grant_type=refresh_token`,
// `/auth/v1/logout`, `/auth/v1/health`. Lecturas `/rest/v1/<tabla>`: columnas, filtros eq/gt/lt/in, orden, límite, `or` de claves y recuento exacto (lo que usa la paginación por claves de la web).
// Almacenamiento: subida sin pisar, descarga, tipos permitidos y tope por bucket.
const http = require("http");
const crypto = require("crypto");
const { helpers: H } = require("./r6_import.cjs");

const IDENT = /^[a-z_][a-z0-9_]*$/;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Traduce los parámetros de PostgREST que usa la web a SQL parametrizado (sólo un subconjunto: eq, gt, lt, in, order, limit, offset, or de claves). */
function buildSelect(table, params) {
  const values = [];
  const bind = (v) => (values.push(v), `$${values.length}`);
  const select = params.get("select") || "*";
  const cols = select === "*" ? "*" : select.split(",").map((c) => c.trim()).filter(Boolean);
  if (cols !== "*" && !cols.every((c) => IDENT.test(c))) throw Object.assign(new Error("columnas no válidas"), { code: "PGRST100" });
  const where = [];
  const orderBy = [];
  let limit = null;
  let offset = 0;
  for (const [key, raw] of params.entries()) {
    if (key === "select") continue;
    if (key === "order") {
      for (const part of raw.split(",")) {
        const [col, dir] = part.split(".");
        if (!IDENT.test(col)) throw Object.assign(new Error("orden no válido"), { code: "PGRST100" });
        orderBy.push(`"${col}" ${dir === "desc" ? "desc" : "asc"}`);
      }
    } else if (key === "limit") limit = Number(raw);
    else if (key === "offset") offset = Number(raw);
    else if (key === "or") {
      // (k.gt."v") o  and(k.eq."v",k2.gt."v2"),…  → sólo claves de paginación.
      const terms = [];
      const parse = (expr) => {
        const m = /^([a-z_][a-z0-9_]*)\.(eq|gt|lt)\."((?:[^"\\]|\\.)*)"$/.exec(expr);
        if (!m) throw Object.assign(new Error("filtro or no soportado"), { code: "PGRST100" });
        return `"${m[1]}" ${{ eq: "=", gt: ">", lt: "<" }[m[2]]} ${bind(m[3].replace(/\\(.)/g, "$1"))}`;
      };
      const inner = raw.replace(/^\(|\)$/g, "");
      for (const term of inner.split(/,(?![^()]*\))/)) {
        const t = term.trim();
        terms.push(t.startsWith("and(") ? `(${t.slice(4, -1).split(",").map(parse).join(" and ")})` : parse(t));
      }
      where.push(`(${terms.join(" or ")})`);
    } else {
      if (!IDENT.test(key)) throw Object.assign(new Error("filtro no válido"), { code: "PGRST100" });
      const m = /^(eq|gt|lt|in)\.(.*)$/.exec(raw);
      if (!m) throw Object.assign(new Error("operador no soportado"), { code: "PGRST100" });
      if (m[1] === "in") {
        const items = m[2].replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
        where.push(`"${key}" = any(${bind(items)})`);
      } else where.push(`"${key}" ${{ eq: "=", gt: ">", lt: "<" }[m[1]]} ${bind(m[2])}`);
    }
  }
  const tail = `${where.length ? ` where ${where.join(" and ")}` : ""}${orderBy.length ? ` order by ${orderBy.join(", ")}` : ""}`;
  return {
    rows: `select ${cols === "*" ? "*" : cols.map((c) => `"${c}"`).join(", ")} from public."${table}"${tail}${limit !== null ? ` limit ${limit | 0}` : ""}${offset ? ` offset ${offset | 0}` : ""}`,
    count: `select count(*)::int n from public."${table}"${where.length ? ` where ${where.join(" and ")}` : ""}`,
    values,
  };
}

/** Servidor local con la forma de Supabase. `hooks`: `rpcFailOnce` (una falla del servidor), `passwords` (correo → contraseña), `refreshFails`, `counts`, `expired` (Set de tokens caducados). */
async function startShim(pg, tokens, hooks) {
  hooks.counts ??= { passwordGrants: 0, refreshGrants: 0, logouts: 0, rpcCalls: 0 };
  hooks.expired ??= new Set();
  const refreshTokens = new Map();
  const sessions = new Map();
  const objects = new Map();
  const contentTypes = new Map();
  const sessionFor = async (uid) => {
    if (!sessions.has(uid)) sessions.set(uid, await H.apiSession(pg, uid, 60000));
    return sessions.get(uid);
  };
  const issue = async (uid, email) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: uid, role: "authenticated", aud: "authenticated", exp, n: crypto.randomUUID() })}.ZmlybWE`;
    const refresh = crypto.randomUUID();
    tokens.set(access, uid);
    refreshTokens.set(refresh, { uid, email });
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: { id: uid, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
  };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const send = (status, payload, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const url = new URL(req.url, "http://localhost");
    const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
    const uid = tokens.get(bearer);
    try {
      if (url.pathname === "/auth/v1/health") return send(200, { name: "GoTrue" });
      if (url.pathname === "/auth/v1/token") {
        const grant = url.searchParams.get("grant_type");
        const input = body.length ? JSON.parse(body.toString("utf8")) : {};
        if (grant === "password") {
          hooks.counts.passwordGrants += 1;
          const user = (await pg.admin.query("select id, email from auth.users where lower(email) = lower($1)", [String(input.email ?? "")])).rows[0];
          const expected = hooks.passwords ? hooks.passwords[String(input.email ?? "").toLowerCase()] : undefined;
          if (!user || (hooks.passwords && expected !== input.password)) return send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
          return send(200, await issue(user.id, user.email));
        }
        if (grant === "refresh_token") {
          hooks.counts.refreshGrants += 1;
          const known = refreshTokens.get(input.refresh_token);
          if (!known || hooks.refreshFails) return send(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
          return send(200, await issue(known.uid, known.email));
        }
        return send(400, { code: 400, msg: "grant no soportado" });
      }
      if (url.pathname === "/auth/v1/logout") {
        hooks.counts.logouts += 1;
        return send(204);
      }
      if (url.pathname === "/auth/v1/user") {
        if (!uid || hooks.expired.has(bearer)) return send(401, { code: 401, msg: "invalid JWT" });
        return send(200, { id: uid, aud: "authenticated", role: "authenticated", email: `${uid}@example.invalid`, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
      }
      if (!uid) return send(401, { message: "JWT inválido", code: "PGRST301" });
      if (hooks.expired.has(bearer)) return send(401, { message: "JWT expired", code: "PGRST303" });
      const s = await sessionFor(uid);
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        hooks.counts.rpcCalls += 1;
        if (hooks.rpcFailOnce) {
          hooks.rpcFailOnce = false;
          return send(503, { message: "servicio no disponible", code: "PGRST000" });
        }
        const fn = url.pathname.split("/").pop();
        if (!/^[a-z_]+$/.test(fn)) return send(404, { code: "PGRST202", message: "no existe" });
        const args = body.length ? JSON.parse(body.toString("utf8")) : {};
        const meta = (await pg.admin.query("select unnest(p.proargnames[1:p.pronargs]) n, format_type(unnest(string_to_array(p.proargtypes::text, ' ')::oid[]), null) t from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1", [fn])).rows.filter((m) => m.n);
        if (meta.length === 0 && Object.keys(args).length > 0) return send(404, { code: "PGRST202", message: "función desconocida" });
        const call = meta.map((m, i) => `${m.n} => $${i + 1}::${m.t}`).join(", ");
        const values = meta.map((m) => (typeof args[m.n] === "object" && args[m.n] !== null ? JSON.stringify(args[m.n]) : args[m.n]));
        try {
          const r = await s.query(`select to_jsonb(public.${fn}(${call})) as r`, values);
          return send(200, r.rows[0].r);
        } catch (e) {
          return send(400, { code: e.code, message: e.message, details: null, hint: null });
        }
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.split("/").pop();
        if (!IDENT.test(table)) return send(404, {});
        try {
          const q = buildSelect(table, url.searchParams);
          const r = await s.query(q.rows, q.values);
          const total = /count=exact/.test(String(req.headers.prefer ?? "")) ? (await s.query(q.count, q.values)).rows[0].n : null;
          return send(200, r.rows, { "content-range": total === null ? `0-${Math.max(0, r.rows.length - 1)}/*` : `${r.rows.length ? 0 : "*"}${r.rows.length ? `-${r.rows.length - 1}` : ""}/${total}` });
        } catch (e) {
          return send(e.code === "42501" ? 403 : 400, { code: e.code, message: e.message });
        }
      }
      const m = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/);
      if (m && req.method === "GET") {
        const key = `${m[1]}/${decodeURIComponent(m[2])}`;
        if (!objects.has(key) || decodeURIComponent(m[2]).split("/")[0] !== uid) return send(404, { statusCode: "404", error: "not_found", message: "Object not found" });
        res.writeHead(200, { "content-type": contentTypes.get(key) || "application/octet-stream" });
        return res.end(objects.get(key));
      }
      if (m && req.method === "POST") {
        const bucket = m[1];
        const objectPath = decodeURIComponent(m[2]);
        const b = (await pg.admin.query("select file_size_limit, allowed_mime_types from storage.buckets where id = $1", [bucket])).rows[0];
        if (!b) return send(404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
        if (objectPath.split("/")[0] !== uid) return send(403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
        if (b.allowed_mime_types && !b.allowed_mime_types.includes((req.headers["content-type"] || "").split(";")[0])) return send(415, { statusCode: "415", error: "invalid_mime_type", message: "mime type not supported" });
        if (b.file_size_limit && body.length > Number(b.file_size_limit)) return send(413, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
        const key = `${bucket}/${objectPath}`;
        if (objects.has(key) && req.headers["x-upsert"] !== "true") return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
        objects.set(key, body);
        contentTypes.set(key, (req.headers["content-type"] || "").split(";")[0]);
        await pg.admin.query("delete from storage.objects where bucket_id = $1 and name = $2", [bucket, objectPath]);
        await pg.admin.query("insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4::jsonb)", [bucket, objectPath, uid, JSON.stringify({ size: body.length })]);
        return send(200, { Key: key, Id: crypto.randomUUID() });
      }
      return send(404, { message: "ruta desconocida" });
    } catch (e) {
      return send(500, { message: String(e.message) });
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    objects,
    contentTypes,
    stop: async () => {
      await new Promise((r) => server.close(r));
      for (const s of sessions.values()) await s.end();
    },
  };
}

module.exports = { startShim };
