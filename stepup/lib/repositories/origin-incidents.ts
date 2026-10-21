import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import { readTable, readTableByIds } from "../db/read.ts";
import { isMissingTableError } from "../transfer/export-destination.ts";
import { groupIncidentViews, type OriginIncidentRow, type OriginIncidentView } from "./origin-incidents-mapping.ts";

/**
 * Incidencias heredadas del traslado (sólo lectura): referencias que ya estaban rotas en TeacherFlow anterior. Siempre filtran por la cuenta de la sesión (además de RLS).
 * Si la base todavía no tiene la tabla (migración R13 sin aplicar) o no hay incidencias, devuelven vacío: la pantalla se comporta como antes.
 */
async function loadIncidents(ctx: AuthenticatedDbContext, entity: "pedagogicalLessons" | "paymentCharges"): Promise<OriginIncidentRow[]> {
  try {
    return await readTable<OriginIncidentRow>(ctx.supabase, "origin_incidents", {
      columns: "id, legacy_mobile_id, entity, row_legacy_id, field, original_reference, kind, detail",
      filter: (q) => q.eq("owner_id", ctx.ownerId).eq("entity", entity),
    });
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

async function incidentsFor(ctx: AuthenticatedDbContext, entity: "pedagogicalLessons" | "paymentCharges", table: "lesson_registrations" | "payment_charges", webIds: readonly string[]): Promise<Record<string, OriginIncidentView[]>> {
  if (webIds.length === 0) return {};
  const rows = await loadIncidents(ctx, entity);
  if (rows.length === 0) return {};
  const legacyIds = [...new Set(rows.map((r) => r.row_legacy_id))];
  const owners = await readTableByIds<{ id: string; legacy_mobile_id: string }>(ctx.supabase, table, {
    ids: legacyIds,
    matchColumn: "legacy_mobile_id",
    columns: "id, legacy_mobile_id",
    filter: (q) => q.eq("owner_id", ctx.ownerId),
  });
  const wanted = new Set(webIds);
  const webIdByLegacyId = new Map(owners.filter((o) => wanted.has(o.id)).map((o) => [o.legacy_mobile_id, o.id]));
  return groupIncidentViews(rows, webIdByLegacyId);
}

/** Incidencias de las clases registradas indicadas (por identificador de la web). */
export function loadRegistrationIncidents(ctx: AuthenticatedDbContext, registrationIds: readonly string[]): Promise<Record<string, OriginIncidentView[]>> {
  return incidentsFor(ctx, "pedagogicalLessons", "lesson_registrations", registrationIds);
}

/** Incidencias de los cobros indicados (por identificador de la web). */
export function loadChargeIncidents(ctx: AuthenticatedDbContext, chargeIds: readonly string[]): Promise<Record<string, OriginIncidentView[]>> {
  return incidentsFor(ctx, "paymentCharges", "payment_charges", chargeIds);
}
