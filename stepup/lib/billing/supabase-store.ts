import "server-only";
import { createClient } from "@supabase/supabase-js";
import { logBilling } from "./log.ts";
import { RpcBillingStore, type RpcCaller } from "./rpc-store.ts";
import type { BillingStore } from "./store.ts";

/**
 * Única puerta de la facturación hacia la base con la clave de SERVICIO (`SUPABASE_SERVICE_ROLE_KEY`). Reglas:
 *  - sólo corre en el servidor (`server-only`) y la clave nunca lleva el prefijo `NEXT_PUBLIC_`;
 *  - sólo llama a las funciones `billing_*` (ejecutables únicamente por `service_role`); no hay ninguna consulta suelta;
 *  - ningún error de la base sale de acá con su mensaje: sólo un código corto en el registro seguro. Con la clave ausente
 *    (estado actual de Production) la fábrica devuelve `null` y la facturación queda cerrada.
 *
 * Esta clave NO está configurada en Vercel en M1. Es una DECISIÓN DE Joaquín antes de M2 (ver docs/billing/M1_ARQUITECTURA.md).
 */
export class BillingStoreError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("billing_store_error");
    this.name = "BillingStoreError";
    this.code = code;
  }
}

function serviceConfig(env: Readonly<Record<string, string | undefined>>): { url: string; key: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

export function createBillingStore(env: Readonly<Record<string, string | undefined>> = process.env): BillingStore | null {
  const config = serviceConfig(env);
  if (!config) return null;
  const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const rpc: RpcCaller = async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      logBilling("store", "rpc_failed", { method: name, code: typeof error.code === "string" ? error.code : "unknown" }, "error");
      throw new BillingStoreError(typeof error.code === "string" ? error.code : "unknown");
    }
    return data;
  };
  return new RpcBillingStore(rpc);
}
