import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRenderUser } from "@/lib/auth/render-user";
import { DeviceNotAuthorizedError, readDeviceAccess } from "@/lib/auth/device-session/server";

/**
 * Contexto autenticado real para los repositorios (Server Components/
 * Actions/Route Handlers). Nunca confía en un `ownerId` provisto por el
 * cliente: siempre resuelve `auth.uid()` a través del propio cliente de
 * Supabase autenticado por cookie de sesión — la misma identidad que RLS
 * usa en el servidor de Postgres, así que un repositorio que la ignore por
 * error igual queda protegido por RLS (defensa en profundidad, nunca la
 * única capa).
 */
export interface AuthenticatedDbContext {
  supabase: SupabaseClient;
  ownerId: string;
}

export class DbNotConfiguredError extends Error {
  constructor() {
    super("Supabase no está configurado en este entorno.");
    this.name = "DbNotConfiguredError";
  }
}

export class DbUnauthenticatedError extends Error {
  constructor() {
    super("No hay una sesión real activa.");
    this.name = "DbUnauthenticatedError";
  }
}

/**
 * Resuelve el cliente de Supabase + el owner_id real de la sesión activa.
 * Lanza (nunca devuelve un contexto a medias) si no hay configuración o
 * sesión — cada repositorio debe llamarse SIEMPRE detrás de una ruta ya
 * protegida por `app/(app)/layout.tsx`/`proxy.ts`, así que llegar hasta acá
 * sin sesión real es un estado inesperado, no un camino normal a manejar en
 * silencio.
 */
export async function requireAuthenticatedDbContext(): Promise<AuthenticatedDbContext> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new DbNotConfiguredError();

  // Compartido con el layout privado dentro de la misma solicitud (una sola verificación con Auth por navegación).
  const user = await getRenderUser();
  if (!user) throw new DbUnauthenticatedError();

  // Toda pantalla y acción exige uno de los dos dispositivos autorizados (lectura compartida con el layout).
  const access = await readDeviceAccess(user.id);
  if (access.kind !== "authorized") throw new DeviceNotAuthorizedError(access);

  return { supabase, ownerId: user.id };
}
