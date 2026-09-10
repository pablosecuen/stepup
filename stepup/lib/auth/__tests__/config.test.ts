import { test } from "node:test";
import assert from "node:assert/strict";
import { getSupabaseRuntimeConfig, isSupabaseConfigured } from "../config.ts";

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
