import type { EmptyClassItem } from "../calendar/empty-classes.ts";
import type { PendingLessonItem } from "../lessons/pending.ts";
import type { CollectionsCenterEntry } from "../payments/collections-center.ts";
import { CHARGE_TYPE_LABEL } from "../payments/labels.ts";
import { formatCivilDate, formatInstantDayShort } from "../format/date-format.ts";

/**
 * Puerto de `buildRemindersCenterSummary` (móvil, `remindersCenter.ts`) —
 * reúne, sin inventar ni duplicar nada, las 3 categorías reales que ya
 * arman otras partes de la app: clases sin alumnos (`buildEmptyClassesSummary`),
 * clases sin registrar (`buildPendingLessons`) y pagos que vencen HOY
 * (`buildCollectionsCenterEntries`). Los pagos YA VENCIDOS NO son recordatorios (decisión
 * del 21/11/2026): son información financiera y viven en Cobros y en el aviso diario de
 * Inicio (`DailyCollectionsNotice`, otra fuente); aquí ni se listan ni se cuentan, así que
 * ninguna insignia ni contador de Recordatorios los incluye. Una categoría sin ítems no
 * aparece en `categories` (nunca se muestra un contador en cero). Esta función es la ÚNICA
 * fuente de Inicio (insignia, cifra, panel) y de «Ver todo». Pura.
 */
export type ReminderCategoryKind = "clases_sin_alumnos" | "clases_sin_registrar" | "pagos_por_vencer";

export interface ReminderCenterItem {
  kind: ReminderCategoryKind;
  id: string;
  title: string;
  subtitle: string;
}

export interface ReminderCenterCategory {
  kind: ReminderCategoryKind;
  label: string;
  items: ReminderCenterItem[];
}

export interface RemindersCenterSummary {
  totalCount: number;
  categories: ReminderCenterCategory[];
}

function pendingLessonTitle(pending: PendingLessonItem): string {
  if (pending.item.participantIds.length > 1) return `Clase grupal · ${pending.item.participantIds.length} alumnos`;
  return pending.item.title?.trim() || pending.item.studentName || "Sin alumnos";
}

function chargeConcept(entry: CollectionsCenterEntry): string {
  return `${CHARGE_TYPE_LABEL[entry.chargeType] ?? entry.chargeType} · vence ${formatCivilDate(entry.dueDate)}`;
}

/**
 * «Vence hoy» (todavía no vencido): las mensualidades/entrenamientos lo traen en su urgencia (`vence_hoy`); el resto de los tipos (por clase, semanal, quincenal, paquete) no tienen urgencia y vencen
 * «hoy» cuando su fecha es hoy y todavía no están vencidos. Un cargo vencido o que vence en varios días NO es un recordatorio (sigue en Cobros).
 */
function isDueToday(entry: CollectionsCenterEntry, todayDateKey: string): boolean {
  if (entry.urgency !== null) return entry.urgency === "vence_hoy";
  return !entry.isOverdue && entry.dueDate === todayDateKey;
}

export function buildRemindersCenterSummary(input: {
  emptyClassItems: readonly EmptyClassItem[];
  pendingLessons: readonly PendingLessonItem[];
  collectionEntries: readonly CollectionsCenterEntry[];
  todayDateKey: string;
}): RemindersCenterSummary {
  const clasesSinAlumnos: ReminderCenterItem[] = input.emptyClassItems.map((item) => ({
    kind: "clases_sin_alumnos",
    id: `empty_${item.key}`,
    title: item.title,
    subtitle: formatInstantDayShort(item.startIso),
  }));

  const clasesSinRegistrar: ReminderCenterItem[] = input.pendingLessons.map((pending) => ({
    kind: "clases_sin_registrar",
    id: `pending_${pending.item.id}`,
    title: pendingLessonTitle(pending),
    subtitle: formatInstantDayShort(pending.item.start),
  }));

  const pagosPorVencer: ReminderCenterItem[] = input.collectionEntries
    .filter((entry) => isDueToday(entry, input.todayDateKey))
    .map((entry) => ({
      kind: "pagos_por_vencer",
      id: `charge_${entry.chargeId}`,
      title: entry.studentName,
      subtitle: chargeConcept(entry),
    }));

  const allCategories: ReminderCenterCategory[] = [
    { kind: "clases_sin_alumnos", label: "Clases sin alumnos", items: clasesSinAlumnos },
    { kind: "clases_sin_registrar", label: "Clases sin registrar", items: clasesSinRegistrar },
    { kind: "pagos_por_vencer", label: "Pagos próximos a vencer", items: pagosPorVencer },
  ];
  const categories = allCategories.filter((category) => category.items.length > 0);

  const totalCount = categories.reduce((sum, category) => sum + category.items.length, 0);

  return { totalCount, categories };
}
