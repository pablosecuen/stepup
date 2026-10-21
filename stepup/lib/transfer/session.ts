import type { Session, TransferClient } from "./orchestrator.ts";

/**
 * Sesión única del traslado. Las credenciales entran UNA vez (por la entrada estándar del proceso) y sólo viven en la memoria de este proceso: no se escriben en ningún archivo,
 * argumento, variable de entorno ni registro. Se conservan en memoria únicamente para volver a iniciar sesión si la sesión caduca durante una ejecución larga, sin volver a pedirlas.
 * `dispose()` las suelta y cierra SÓLO esta sesión (alcance local): no toca la sesión del teléfono ni ninguna otra.
 */

export interface AuthClient extends TransferClient {
  auth: {
    signInWithPassword(c: { email: string; password: string }): PromiseLike<{ data: { user: { id: string } | null } | null; error: unknown | null }>;
    signOut(options?: { scope?: "local" | "global" | "others" }): PromiseLike<unknown>;
    stopAutoRefresh?(): PromiseLike<void> | void;
  };
}

export class SessionError extends Error {
  readonly cause2: unknown;
  constructor(cause2: unknown) {
    super("No se pudo iniciar sesión con las credenciales ingresadas.");
    this.name = "SessionError";
    this.cause2 = cause2;
  }
}

export async function openSession(options: { createClient: () => AuthClient; email: string; password: string }): Promise<Session & { dispose(): Promise<void>; signInCount: number }> {
  let credentials: { email: string; password: string } | null = { email: options.email, password: options.password };
  const client = options.createClient();
  const holder = { client: client as TransferClient, ownerId: "", signInCount: 0 };

  async function signIn(): Promise<void> {
    if (!credentials) throw new SessionError("sin credenciales en memoria");
    const { data, error } = await client.auth.signInWithPassword(credentials);
    holder.signInCount += 1;
    if (error || !data?.user) throw new SessionError(error);
    if (holder.ownerId && holder.ownerId !== data.user.id) throw new SessionError("otra cuenta");
    holder.ownerId = data.user.id;
  }
  await signIn();
  return Object.assign(holder, {
    reauthenticate: signIn,
    async dispose() {
      credentials = null;
      try {
        await client.auth.stopAutoRefresh?.();
        await client.auth.signOut({ scope: "local" });
      } catch {
        /* ya cerrada */
      }
    },
  });
}
