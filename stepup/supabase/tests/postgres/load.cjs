// Postgres REAL (binarios de `embedded-postgres`, fuera del repo) con TODAS las migraciones reales y stubs mínimos de Supabase.
// A diferencia de PGlite (una única conexión), acá hay varias conexiones simultáneas de verdad: sirve para probar locks y concurrencia.
//
//   mkdir %TEMP%\epg && cd %TEMP%\epg && npm i embedded-postgres pg
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r3_quotas.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");

const MIGRATIONS = process.env.MIGRATIONS_DIR || path.join(__dirname, "..", "..", "migrations");

const STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text, email_confirmed_at timestamptz, aud text, role text);
  create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''))::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  grant usage on schema public, extensions, auth to anon, authenticated, service_role;
  -- Privilegios por defecto del proyecto (nube): las tablas/funciones nuevas de public nacen accesibles a los roles de la API.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  -- storage (sólo lo que las migraciones tocan)
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to anon, authenticated, service_role;
  -- tablas de la app móvil que ya existen en el proyecto real (fuera de este repo)
  create table public.active_sessions (user_id uuid primary key references auth.users(id) on delete cascade, device_id text not null, generation bigint not null default 1, authorized_at timestamptz not null default now(), expires_at timestamptz not null, last_seen_at timestamptz not null default now());
  alter table public.active_sessions enable row level security;
  create table public.cloud_backups (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, device_id text not null, schema_version integer not null, app_version text, checksum text not null, payload jsonb not null, created_at timestamptz not null default now());
  alter table public.cloud_backups enable row level security;
`;

async function start({ port = 5441, upTo = null, migrationsDir = null } = {}) {
  const EmbeddedPostgres = require("embedded-postgres").default;
  const { Client } = require("pg");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-epg-"));
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "pw", port, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: process.env.PG_LOG ? (m) => fs.appendFileSync(process.env.PG_LOG, String(m)) : () => {}, onError: process.env.PG_LOG ? (m) => fs.appendFileSync(process.env.PG_LOG, String(m)) : () => {} });
  await server.initialise();
  await server.start();
  const connect = async () => {
    const client = new Client({ host: "localhost", port, user: "postgres", password: "pw", database: "postgres" });
    client.on("error", () => {}); // un cierre del servidor al terminar no debe tumbar la prueba
    await client.connect();
    return client;
  };
  const admin = await connect();
  await admin.query(STUBS);
  // Funciones de la app móvil que existen en el proyecto real (fuera de este repo): ver fixtures/mobile_functions.sql.
  await admin.query(fs.readFileSync(path.join(__dirname, "fixtures", "mobile_functions.sql"), "utf8"));
  const failures = [];
  const MIG = migrationsDir || MIGRATIONS;
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (upTo && f > upTo) break;
    try {
      await admin.query(fs.readFileSync(path.join(MIG, f), "utf8"));
    } catch (e) {
      failures.push([f, String(e.message).split("\n")[0].slice(0, 160)]);
    }
  }
  /** Conexión nueva que actúa como una usuaria de la API (rol `authenticated`, `auth.uid()` = uid) o como `anon`. */
  async function session(uid, role = "authenticated") {
    const client = await connect();
    await client.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
    await client.query(`set role ${role}`);
    return client;
  }
  async function stop() {
    try { await admin.end(); } catch {}
    await server.stop();
  }
  return { admin, connect, session, stop, failures, files };
}

module.exports = { start };

if (require.main === module) {
  start().then(async (pg) => {
    console.log("migraciones:", pg.files.length, "con error:", pg.failures.length);
    for (const [f, m] of pg.failures) console.log(" ✗", f, "→", m);
    await pg.stop();
  });
}
