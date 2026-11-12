import type { CalendarViewItem } from "./occurrences.ts";
import type { PositionedItem } from "./layout.ts";
import { instantTimeLabel } from "./civil-calendar.ts";

/**
 * Clases simultáneas del teléfono (calendario de semana): las que se tocan en el tiempo comparten carriles y sus columnas son demasiado angostas para nombres completos. En vez de recortar o
 * reducir letras, el conjunto se marca como UN grupo (contorno + cantidad) y al tocarlo se abre una lista compacta con el nombre completo, el horario y la modalidad de cada clase; cada fila abre el
 * detalle de su propia clase. Un grupo es exactamente el conjunto que `layoutDayItems` reparte en carriles (`group`), nunca una aproximación por píxeles. PURO.
 */
export interface SimultaneousGroup {
  /** Estable entre dibujos: día + primera clase del grupo. */
  key: string;
  /** Alto/posición del grupo dentro de la columna del día (px desde las 08:00): la zona interactiva de sus clases. */
  topPx: number;
  bottomPx: number;
  /** Las clases, por hora de inicio y luego por nombre. */
  members: CalendarViewItem[];
  startIso: string;
  endIso: string;
}

export const GROUP_BADGE_CLEARANCE_PX = 14;

export function simultaneousGroups(dayKey: string, positioned: readonly PositionedItem[], titleOf: (item: CalendarViewItem) => string): SimultaneousGroup[] {
  const byGroup = new Map<number, PositionedItem[]>();
  for (const entry of positioned) {
    if (entry.laneCount < 2) continue;
    byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry]);
  }
  return [...byGroup.values()]
    .filter((entries) => entries.length > 1)
    .map((entries) => {
      const members = entries
        .map((entry) => entry.item)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || titleOf(a).localeCompare(titleOf(b), "es"));
      return {
        key: `${dayKey}|${entries[0].group}|${members[0].id}`,
        topPx: Math.min(...entries.map((entry) => entry.hitTop)),
        bottomPx: Math.max(...entries.map((entry) => entry.hitTop + entry.hitHeight)),
        members,
        startIso: members[0].start,
        endIso: new Date(Math.max(...members.map((member) => Date.parse(member.end)))).toISOString(),
      };
    })
    .sort((a, b) => a.topPx - b.topPx);
}

/** ¿Empieza otra clase (fuera del grupo) justo debajo? Entonces la insignia de cantidad no se dibuja: taparía su nombre; el contorno punteado y el texto accesible siguen identificando el grupo. */
export function badgeFitsBelow(group: SimultaneousGroup, positioned: readonly PositionedItem[]): boolean {
  const ids = new Set(group.members.map((member) => member.id));
  return !positioned.some((entry) => !ids.has(entry.item.id) && entry.top >= group.bottomPx - 1 && entry.top < group.bottomPx + GROUP_BADGE_CLEARANCE_PX);
}

const MODALITY_LABEL: Record<string, string> = { online: "Online", presencial: "Presencial", mixta: "Mixta" };

export function groupRowDetail(item: CalendarViewItem): { time: string; modality: string; state: string | null } {
  const state = item.status === "cancelled" ? "Cancelada" : item.status === "rescheduled" ? "Reprogramada" : null;
  return { time: `${instantTimeLabel(item.start)} a ${instantTimeLabel(item.end)}`, modality: MODALITY_LABEL[item.modality] ?? String(item.modality), state };
}

/** «3 clases a las 11:00: Emma Larga, Facundo Torres y Gabriela Soto. Abrir la lista.» */
export function groupAriaLabel(group: SimultaneousGroup, titleOf: (item: CalendarViewItem) => string): string {
  const names = group.members.map(titleOf);
  const joined = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `${group.members.length} clases a las ${instantTimeLabel(group.startIso)}: ${joined}. Abrir la lista.`;
}
