import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { StudentCreationClaimRow } from "@/lib/db/database.types";

/**
 * Repositorio del borrador ("claim") de alta manual de alumno — Fase 2,
 * corrección de carrera real. La identidad del borrador nace y vive
 * enteramente server-side (`claim_student_creation()`); este repositorio
 * nunca genera ni acepta un id de borrador provisto por el navegador.
 * Ver `supabase/migrations/20260927100000_student_creation_race_fix.sql`.
 */

export interface StudentCreationClaim {
  claimId: string;
  expiresAt: string;
}

/** Reclama un borrador nuevo — usado por la página `/alumnos/nuevo` cuando no trae `?draft=` en la URL, o cuando el que traía resultó inválido/vencido/ajeno. */
export async function claimStudentCreation(ctx: AuthenticatedDbContext): Promise<StudentCreationClaim> {
  const { data, error } = await ctx.supabase.rpc("claim_student_creation");
  if (error) throw error;
  const row = (data as Array<{ claim_id: string; expires_at: string }> | null)?.[0];
  if (!row) throw new Error("No se pudo reclamar un borrador de alta.");
  return { claimId: row.claim_id, expiresAt: row.expires_at };
}

export interface StudentCreationClaimState {
  id: string;
  status: "pending" | "created";
  studentId: string | null;
  expiresAt: string;
  /** true si `status==='pending'` y ya venció — calculado acá (no en el componente de página, que debe quedar puro). */
  expired: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee el estado real de un borrador propio (para que la página decida si
 * mostrar el formulario, redirigir al alumno ya creado, o reclamar uno
 * nuevo). `null` cubre a propósito TRES casos sin distinguirlos (mismo
 * criterio anti-enumeración que el resto del proyecto): no existe, es de
 * otro profesor (RLS lo excluye), o el id ni siquiera tiene forma de UUID.
 */
export async function getStudentCreationClaim(
  ctx: AuthenticatedDbContext,
  claimId: string
): Promise<StudentCreationClaimState | null> {
  if (!UUID_RE.test(claimId)) return null;
  const { data, error } = await ctx.supabase
    .from("student_creation_claims")
    .select("id, status, student_id, expires_at")
    .eq("owner_id", ctx.ownerId)
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Pick<StudentCreationClaimRow, "id" | "status" | "student_id" | "expires_at">;
  return {
    id: row.id,
    status: row.status,
    studentId: row.student_id,
    expiresAt: row.expires_at,
    expired: row.status === "pending" && new Date(row.expires_at).getTime() < Date.now(),
  };
}
