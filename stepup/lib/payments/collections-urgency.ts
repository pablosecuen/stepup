import type { CollectionsCenterEntry } from "./collections-center.ts";

/**
 * Puerto de `summarizeCollectionsUrgency` (móvil,
 * `collectionsCenter.ts`) — usado por la tarjeta compacta de Cobros en
 * Inicio: "sin gráficos, sin montos ni nombres" (mismo criterio del
 * comentario real de `CollectionsCenterSummaryCard.tsx`), sólo dos
 * cantidades. El móvil separa `primer_vencimiento`/`segundo_vencimiento`/
 * `ultimo_vencimiento` porque ahí los recargos son CONFIGURABLES — acá los
 * recargos automáticos están desactivados estructuralmente siempre (commit
 * móvil `94ce7be`), así que esa distinción de etapas de mora nunca aplica:
 * cualquier obligación vencida real (mensual/entrenamiento con
 * `urgency === 'mes_vencido'`, o el resto con `isOverdue === true`) cae en
 * el mismo total `overdueCount`, equivalente al `totalWithDebt` real del
 * móvil bajo esa misma condición (recargos off). `dueToday` cubre
 * mensual/entrenamiento (`urgency === 'vence_hoy'`) y el resto de tipos
 * (por_clase/semanal/quincenal/paquete) cuando vencen justo hoy sin estar
 * todavía vencidos. Pura — no muta `entries`.
 */
export interface CollectionsUrgencySummary {
  dueToday: number;
  overdueCount: number;
}

export function summarizeCollectionsUrgency(entries: readonly CollectionsCenterEntry[], todayDateKey: string): CollectionsUrgencySummary {
  let dueToday = 0;
  let overdueCount = 0;

  for (const entry of entries) {
    if (entry.urgency !== null) {
      if (entry.urgency === "vence_hoy") dueToday += 1;
      else if (entry.urgency === "mes_vencido") overdueCount += 1;
      continue;
    }
    if (entry.isOverdue) {
      overdueCount += 1;
    } else if (entry.dueDate === todayDateKey) {
      dueToday += 1;
    }
  }

  return { dueToday, overdueCount };
}
