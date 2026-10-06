import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSupabaseConfig, getSupabaseRuntimeConfig, isSupabaseConfigured, shouldFailClosed } from "../config.ts";

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;

function withEnv<T>(vars: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) previous[key] = process.env[key];
  try {
    for (const key of ENV_KEYS) {
      const value = vars[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("sin variables: no configurado", () => {
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }, () => {
    assert.equal(isSupabaseConfigured(), false);
    assert.equal(getSupabaseRuntimeConfig(), null);
  });
});

test("sólo una de las dos variables: no configurado", () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: "https://abcxyzproj.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
    () => {
      assert.equal(isSupabaseConfigured(), false);
    }
  );
});

test("valores de ejemplo (.env.example copiado tal cual): no configurado", () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://your-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example_placeholder",
    },
    () => {
      assert.equal(isSupabaseConfigured(), false);
    }
  );
});

test("URL inválida: no configurado", () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123" },
    () => {
      assert.equal(isSupabaseConfigured(), false);
    }
  );
});

test("configuración válida y completa: configurado", () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://abcxyzproj.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
    },
    () => {
      assert.equal(isSupabaseConfigured(), true);
      const config = getSupabaseRuntimeConfig();
      assert.equal(config?.url, "https://abcxyzproj.supabase.co");
      assert.equal(config?.publishableKey, "sb_publishable_abc123");
    }
  );
});

test("nunca lee ni expone una service_role key", () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://abcxyzproj.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
    },
    () => {
      const config = getSupabaseRuntimeConfig();
      const serialized = JSON.stringify(config);
      assert.equal(/service_role/i.test(serialized), false);
    }
  );
});

// ---------------------------------------------------------------------------------------------------------------
// R1 — fallar cerrado en Production
// ---------------------------------------------------------------------------------------------------------------
const GOOD_URL = "https://abcxyzproj.supabase.co";
const GOOD_KEY = "sb_publishable_abc123";
const prodEnv = (extra: Record<string, string | undefined> = {}) => ({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: GOOD_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: GOOD_KEY, ...extra });

test("evaluateSupabaseConfig distingue ausente, inválida y válida (sin devolver nunca los valores en el estado)", () => {
  assert.equal(evaluateSupabaseConfig({}).state, "missing");
  assert.equal(evaluateSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: GOOD_URL }).state, "missing");
  assert.equal(evaluateSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: GOOD_KEY }).state, "invalid");
  assert.equal(evaluateSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://your-project.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: GOOD_KEY }).state, "invalid");
  assert.equal(evaluateSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: GOOD_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example_placeholder" }).state, "invalid");
  assert.equal(evaluateSupabaseConfig(prodEnv()).state, "ok");
});

test("Production exige HTTPS: http sólo para un servidor local fuera de Vercel", () => {
  assert.equal(evaluateSupabaseConfig(prodEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://abcxyzproj.supabase.co" })).state, "invalid");
  assert.equal(evaluateSupabaseConfig(prodEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).state, "ok", "`next start` local contra un Auth de prueba");
  assert.equal(evaluateSupabaseConfig(prodEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", VERCEL: "1" })).state, "invalid", "desplegado en Vercel, nunca http");
  assert.equal(evaluateSupabaseConfig({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: GOOD_KEY }).state, "ok", "desarrollo local con Supabase local");
});

test("la heurística de placeholder está anclada: una clave o proyecto reales con «xxxx» o «example» en el medio NO se rechazan", () => {
  assert.equal(evaluateSupabaseConfig(prodEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_Ab12xxxxQ9zExampleKey" })).state, "ok");
  assert.equal(evaluateSupabaseConfig(prodEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abxxxxcdexampleyz.supabase.co" })).state, "ok");
});

test("shouldFailClosed: Production sin configuración válida falla cerrado; con configuración válida o en desarrollo no", () => {
  assert.equal(shouldFailClosed({ NODE_ENV: "production" }), true, "variables ausentes");
  assert.equal(shouldFailClosed(prodEnv({ NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url" })), true, "variable inválida");
  assert.equal(shouldFailClosed(prodEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "   " })), true, "variable vacía");
  assert.equal(shouldFailClosed(prodEnv()), false);
  assert.equal(shouldFailClosed({ NODE_ENV: "development" }), false, "desarrollo local: modo vista previa como siempre");
  assert.equal(shouldFailClosed({}), false);
});
