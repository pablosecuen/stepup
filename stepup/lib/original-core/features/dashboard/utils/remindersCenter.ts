// Puerto VERBATIM del original (`src/features/dashboard/utils/remindersCenter.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLessonRegistration } from '../../calendar/types/index.ts';
import type { CollectionEntryWithStudent } from '../../payments/hooks/useCollectionsCenter.ts';
import type { CollectionUrgency } from '../../payments/utils/collectionsCenter.ts';
import type { EmptyClassItem } from './emptyClasses.ts';
import type { PendingClass } from '../types/index.ts';

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — menú TF > Recordatorios):
 * "Recordatorios" tenía el mismo destino que "Resumen financiero" — nunca
 * abría un Centro de recordatorios propio. Este agregador reúne, sin
 * inventar ni duplicar nada, las 4 categorías reales que ya existen en
 * otras partes de la app:
 *
 * 1. Clases sin alumnos — mismo `EmptyClassItem[]` que ya arma
 *    `buildEmptyClassesSummary` para Home.
 * 2. Clases terminadas sin registrar — mismo `PendingClass[]` que ya arma
 *    `buildPendingClasses` para Home.
 * 3/4. Pagos por vencer y vencidos — mismo `CollectionEntryWithStudent[]`
 *    que ya arma `buildCollectionsCenterEntries` para el Centro de cobros,
 *    separado en dos categorías por urgencia (`vence_hoy` = por vencer,
 *    cualquier etapa de mora = vencido).
 *
 * Deliberadamente NO existe una quinta categoría "cargos que requieren
 * revisión": sería el mismo cargo ya contado en 3 o 4, así que agregarla
 * violaría la regla de nunca duplicar un recordatorio. Cada item conserva
 * su objeto fuente completo (`source`) para que la pantalla reutilice,
 * sin reimplementarla, la MISMA acción de navegación que ya usan Home y
 * el Centro de cobros.
 *
 * Pura — no muta ninguno de los tres arrays de entrada. Una categoría sin
 * ítems no aparece en `categories` (nunca se muestra un contador en cero).
 */
export interface ReminderCenterItemBase {
  id: string;
  title: string;
}

export interface ClasesSinAlumnosReminderItem extends ReminderCenterItemBase {
  kind: 'clases_sin_alumnos';
  startIso: string;
  source: EmptyClassItem;
}

export interface ClasesSinRegistrarReminderItem extends ReminderCenterItemBase {
  kind: 'clases_sin_registrar';
  startIso: string;
  source: PendingClass;
}

export interface PagoReminderItem extends ReminderCenterItemBase {
  kind: 'pagos_por_vencer' | 'pagos_vencidos';
  concept: string;
  dueDate: string;
  urgency: CollectionUrgency;
  source: CollectionEntryWithStudent;
}

export type ReminderCenterItem =
  | ClasesSinAlumnosReminderItem
  | ClasesSinRegistrarReminderItem
  | PagoReminderItem;

export type ReminderCategoryKind = ReminderCenterItem['kind'];

export interface ReminderCenterCategory {
  kind: ReminderCategoryKind;
  label: string;
  items: ReminderCenterItem[];
}

export interface RemindersCenterSummary {
  totalCount: number;
  categories: ReminderCenterCategory[];
}

function pendingClassTitle(pendingClass: PendingClass): string {
  if (pendingClass.isGroupClass) {
    return `Clase grupal · ${pendingClass.studentNames.length} alumnos`;
  }
  return pendingClass.studentNames[0] ?? 'Sin alumnos';
}

export function buildRemindersCenterSummary(input: {
  emptyClassItems: readonly EmptyClassItem[];
  pendingClasses: readonly PendingClass[];
  collectionEntries: readonly CollectionEntryWithStudent[];
}): RemindersCenterSummary {
  const clasesSinAlumnos: ClasesSinAlumnosReminderItem[] = input.emptyClassItems.map((item) => ({
    kind: 'clases_sin_alumnos',
    id: `empty_${item.key}`,
    title: item.title,
    startIso: item.startIso,
    source: item,
  }));

  const clasesSinRegistrar: ClasesSinRegistrarReminderItem[] = input.pendingClasses.map((pendingClass) => ({
    kind: 'clases_sin_registrar',
    id: `pending_${pendingClass.reservationKey}`,
    title: pendingClassTitle(pendingClass),
    startIso: pendingClass.start,
    source: pendingClass,
  }));

  const pagosPorVencer: PagoReminderItem[] = input.collectionEntries
    .filter((entry) => entry.urgency === 'vence_hoy')
    .map((entry) => ({
      kind: 'pagos_por_vencer',
      id: `charge_${entry.chargeId}`,
      title: entry.studentName,
      concept: entry.concept,
      dueDate: entry.dueDate,
      urgency: entry.urgency,
      source: entry,
    }));

  const pagosVencidos: PagoReminderItem[] = input.collectionEntries
    .filter((entry) => entry.urgency !== 'vence_hoy')
    .map((entry) => ({
      kind: 'pagos_vencidos',
      id: `charge_${entry.chargeId}`,
      title: entry.studentName,
      concept: entry.concept,
      dueDate: entry.dueDate,
      urgency: entry.urgency,
      source: entry,
    }));

  const categories: ReminderCenterCategory[] = (
    [
      { kind: 'clases_sin_alumnos', label: 'Clases sin alumnos', items: clasesSinAlumnos },
      { kind: 'clases_sin_registrar', label: 'Clases sin registrar', items: clasesSinRegistrar },
      { kind: 'pagos_por_vencer', label: 'Pagos próximos a vencer', items: pagosPorVencer },
      { kind: 'pagos_vencidos', label: 'Pagos vencidos', items: pagosVencidos },
    ] satisfies ReminderCenterCategory[]
  ).filter((category) => category.items.length > 0);

  const totalCount = categories.reduce((sum, category) => sum + category.items.length, 0);

  return { totalCount, categories };
}
