import type { EmptyClassItem } from "../calendar/empty-classes.ts";
import type { PendingLessonItem } from "../lessons/pending.ts";
import type { CollectionsCenterEntry } from "../payments/collections-center.ts";
import { CHARGE_TYPE_LABEL } from "../payments/labels.ts";
import { formatCivilDate, formatInstantDayShort } from "../format/date-format.ts";

/**
 * Puerto de `buildRemindersCenterSummary` (móvil, `remindersCenter.ts`) —
 * reúne, sin inventar ni duplicar nada, las 4 categorías reales que ya
 * arman otras partes de la app: clases sin alumnos (`buildEmptyClassesSummary`),
 * clases sin registrar (`buildPendingLessons`), y pagos por vencer/vencidos
 * (`buildCollectionsCenterEntries`, separados por `urgency === 'vence_hoy'`
 * vs el resto). Deliberadamente NO existe una quinta categoría — sería el
 * mismo cargo ya contado en pagos. Una categoría sin ítems no aparece en
 * `categories` (nunca se muestra un contador en cero). Pura.
 */
export type ReminderCategoryKind = "clases_sin_alumnos" | "clases_sin_registrar" | "pagos_por_vencer" | "pagos_vencidos";

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
 * Mismo criterio real del móvil (`buildCollectionsCenterEntries` ahí
 * excluye `pendiente_en_termino` antes de construir cada `CollectionEntry`):
 * un cargo recién generado que vence en varios días no "necesita atención"
 * todavía — nunca entra a Recordatorios aunque sí aparezca en el Centro de
 * Cobros completo (`/cobros`, que a propósito muestra TODO lo pendiente).
 */
function needsAttention(entry: CollectionsCenterEntry, todayDateKey: string): boolean {
  if (entry.urgency !== null) return entry.urgency !== "pendiente_en_termino";
  return entry.isOverdue || entry.dueDate === todayDateKey;
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

  const urgentEntries = input.collectionEntries.filter((entry) => needsAttention(entry, input.todayDateKey));

  const pagosPorVencer: ReminderCenterItem[] = urgentEntries
    .filter((entry) => entry.urgency === "vence_hoy")
    .map((entry) => ({
      kind: "pagos_por_vencer",
      id: `charge_${entry.chargeId}`,
      title: entry.studentName,
      subtitle: chargeConcept(entry),
    }));

  const pagosVencidos: ReminderCenterItem[] = urgentEntries
    .filter((entry) => entry.urgency !== "vence_hoy")
    .map((entry) => ({
      kind: "pagos_vencidos",
      id: `charge_${entry.chargeId}`,
      title: entry.studentName,
      subtitle: chargeConcept(entry),
    }));

  const allCategories: ReminderCenterCategory[] = [
    { kind: "clases_sin_alumnos", label: "Clases sin alumnos", items: clasesSinAlumnos },
    { kind: "clases_sin_registrar", label: "Clases sin registrar", items: clasesSinRegistrar },
    { kind: "pagos_por_vencer", label: "Pagos próximos a vencer", items: pagosPorVencer },
    { kind: "pagos_vencidos", label: "Pagos vencidos", items: pagosVencidos },
  ];
  const categories = allCategories.filter((category) => category.items.length > 0);

  const totalCount = categories.reduce((sum, category) => sum + category.items.length, 0);

  return { totalCount, categories };
}
