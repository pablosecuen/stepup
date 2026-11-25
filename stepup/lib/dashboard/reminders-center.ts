import type { EmptyClassItem } from "../calendar/empty-classes.ts";
import { formatInstantDayShort } from "../format/date-format.ts";

/**
 * Puerto de `buildRemindersCenterSummary` (móvil, `remindersCenter.ts`), con la decisión del 24/11/2026: un recordatorio es SÓLO lo que no
 * tiene otro lugar propio en la aplicación. Hoy esa categoría es una: las clases sin alumnos (`buildEmptyClassesSummary`).
 *
 * Quedaron FUERA, y no se listan ni se cuentan aquí (ninguna insignia, cifra ni «Ver todo» los incluye):
 *   - Clases sin registrar: tienen su bloque prioritario en Inicio («Clases por registrar», con lista, contador, accesos y «Ver todas»)
 *     y la pantalla Registro. Repetirlas en Recordatorios era la redundancia a eliminar.
 *   - Pagos próximos a vencer / que vencen hoy y pagos vencidos: son información financiera y viven en «Cobros de hoy» (Inicio), en el aviso
 *     diario de Inicio (`DailyCollectionsNotice`, otra fuente) y en Cobros. No se borra ningún pago, obligación ni vencimiento: sólo
 *     dejan de repetirse como recordatorio.
 * Una categoría sin ítems no aparece en `categories` (nunca se muestra un contador en cero). Con cero recordatorios Inicio no dibuja la
 * tarjeta (ni su espacio). Esta función es la ÚNICA fuente de Inicio (insignia, cifra, tarjeta) y de «Ver todo». Pura.
 */
export type ReminderCategoryKind = "clases_sin_alumnos";

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

export function buildRemindersCenterSummary(input: { emptyClassItems: readonly EmptyClassItem[] }): RemindersCenterSummary {
  const clasesSinAlumnos: ReminderCenterItem[] = input.emptyClassItems.map((item) => ({
    kind: "clases_sin_alumnos",
    id: `empty_${item.key}`,
    title: item.title,
    subtitle: formatInstantDayShort(item.startIso),
  }));

  const allCategories: ReminderCenterCategory[] = [{ kind: "clases_sin_alumnos", label: "Clases sin alumnos", items: clasesSinAlumnos }];
  const categories = allCategories.filter((category) => category.items.length > 0);

  const totalCount = categories.reduce((sum, category) => sum + category.items.length, 0);

  return { totalCount, categories };
}
