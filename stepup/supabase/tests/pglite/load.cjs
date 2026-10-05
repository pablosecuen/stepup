// Carga el esquema REAL (todas las migraciones, en orden) en un Postgres en memoria, con stubs mínimos de Supabase.
const fs = require("fs");
const path = require("path");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");

const MIGRATIONS = process.env.MIGRATIONS_DIR || require("path").join(__dirname, "..", "..", "migrations");

async function load({ upTo, verbose = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text, email_confirmed_at timestamptz, aud text, role text);
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''))::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    grant usage on schema public, extensions, auth to anon, authenticated, service_role;
  `);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const failures = [];
  for (const f of files) {
    if (upTo && f > upTo) break;
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    try {
      await db.exec(sql);
    } catch (e) {
      failures.push([f, e.message.split("\n")[0].slice(0, 160)]);
    }
  }
  if (verbose) console.log("migraciones:", files.length, "con error:", failures.length);
  return { db, failures };
}
module.exports = { load };

if (require.main === module) {
  load({ verbose: true }).then(({ failures }) => {
    for (const [f, m] of failures) console.log(" ✗", f, "→", m);
  });
}
