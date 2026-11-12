"use client";

import { Dialog } from "@/components/ui/dialog";
import { groupAriaLabel, groupRowDetail, type SimultaneousGroup } from "@/lib/calendar/simultaneous-groups";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";

/**
 * Marca de un grupo de clases simultáneas en la grilla del teléfono: contorno punteado (no sólo color) y, cuando hay lugar, la cantidad. Es el ÚNICO control del grupo (las clases de abajo quedan
 * inertes: no reciben toque ni foco), así que no hay controles superpuestos y el lector de pantalla oye un solo botón con todos los nombres. Es transparente: no tapa ningún nombre.
 */
export function GroupMark({ group, title, showCount, onOpen }: { group: SimultaneousGroup; title: string; showCount: boolean; onOpen: (group: SimultaneousGroup) => void }) {
  return (
    <button
      type="button"
      data-group-mark={group.key}
      aria-haspopup="dialog"
      aria-label={title}
      onClick={() => onOpen(group)}
      className="absolute inset-x-px z-20 cursor-pointer rounded-md border-2 border-dashed border-ink/70 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
      style={{ top: group.topPx - 1, height: group.bottomPx - group.topPx + 2 }}
    >
      {showCount && (
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-[11px] -right-[3px] inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-ink px-1 text-[10px] font-bold leading-none text-background">
          {group.members.length}
        </span>
      )}
    </button>
  );
}

/** Lista compacta del grupo: nombre completo (sin recortar), horario y modalidad de cada clase; cada fila abre el detalle de ESA clase. */
export function GroupSheet({ group, titleOf, timeRange, onPick, onClose }: { group: SimultaneousGroup; titleOf: (item: CalendarViewItem) => string; timeRange: string; onPick: (item: CalendarViewItem) => void; onClose: () => void }) {
  return (
    <Dialog title={`${group.members.length} clases · ${timeRange}`} size="sm" onClose={onClose}>
      <ul data-group-sheet className="flex flex-col gap-2 pb-2">
        {group.members.map((member) => {
          const detail = groupRowDetail(member);
          return (
            <li key={member.id}>
              <button
                type="button"
                data-group-row={member.id}
                onClick={() => onPick(member)}
                className="flex min-h-14 w-full flex-col items-start justify-center rounded-md border-[1.5px] border-borderMid bg-surface px-3.5 py-2.5 text-left transition-colors hover:bg-paperDeep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
              >
                <span className="[overflow-wrap:anywhere] text-[16px] font-semibold leading-snug text-textPrimary">{titleOf(member)}</span>
                <span className="text-[13.5px] leading-snug text-textSecondary tf-num">
                  {detail.time} · {detail.modality}
                  {detail.state && <> · <b className="font-semibold">{detail.state}</b></>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
