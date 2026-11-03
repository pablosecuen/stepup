"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rescheduleWithAvailabilityAction } from "@/lib/actions/reschedule-parity";
import { changeSeriesSlotAction } from "@/lib/actions/schedule-change";
import { guardNetwork } from "@/lib/actions/network-guard";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { AvailabilityPicker } from "@/components/calendar/availability-picker";
import { formatCivilDayLabelShort, instantDateKey, instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { addDaysToDateKey, getDateKeyJsDay } from "@/lib/calendar/timezone";
import { formatMinutes } from "@/lib/format/number-format";

export interface ChangeScheduleOccurrence {
  id: string;
  start: string;
  end: string;
  recurrenceId: string | null;
  title: string | null;
  studentName: string;
  participantNames: string[];
}

type Scope = "single" | "series";

const WEEKDAY_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
const clockPlus = (time: string, minutes: number) => {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * «Cambiar horario»: mueve UNA clase (o esta y las siguientes de su serie) a cualquier horario libre. No necesita otra serie para intercambiar —el intercambio atómico sigue siendo una acción
 * aparte—. Abre con la fecha, hora, duración y participantes actuales, muestra a dónde va a pasar y recién guarda al confirmar. «Solo esta clase» deja el resto de la serie como estaba;
 * «Esta y las siguientes» cambia el día y la hora de ESA sesión semanal desde esta clase en adelante. Nunca deja dos clases superpuestas, no toca registros, asistencia, tareas, adjuntos,
 * cobros ni pagos. Cancelar no cambia nada.
 */
export function ChangeSchedulePanel({
  occurrence,
  initialScope = "single",
  onCancel,
  onDone,
}: {
  occurrence: ChangeScheduleOccurrence;
  initialScope?: Scope;
  onCancel: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isSeries = !!occurrence.recurrenceId;
  const [scope, setScope] = useState<Scope>(isSeries ? initialScope : "single");
  const originalDate = instantDateKey(occurrence.start);
  const originalTime = instantTimeLabel(occurrence.start);
  const duration = Math.round((Date.parse(occurrence.end) - Date.parse(occurrence.start)) / 60_000);
  const [pick, setPick] = useState({ date: originalDate, time: originalTime });
  const [error, setError] = useState<string | null>(null);
  const [needs, setNeeds] = useState<null | { kind: "blocked" } | { kind: "replace"; key?: string } | { kind: "series-replace" }>(null);
  const [operationId] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<string | null>(null);

  const changed = pick.date !== originalDate || pick.time !== originalTime;
  const targetWeekday = WEEKDAY_PLURAL[getDateKeyJsDay(pick.date)];
  const seriesWindow = { minDate: addDaysToDateKey(originalDate, -6), maxDate: addDaysToDateKey(originalDate, 6) };
  const names = occurrence.participantNames.length > 0 ? occurrence.participantNames : occurrence.studentName ? [occurrence.studentName] : [];
  const nowText = `${formatCivilDayLabelShort(originalDate)} · ${originalTime}–${clockPlus(originalTime, duration)}`;
  const nextText = `${formatCivilDayLabelShort(pick.date)} · ${pick.time}–${clockPlus(pick.time, duration)}`;

  function choose(next: Scope) {
    setScope(next);
    setNeeds(null);
    setError(null);
    // Al pasar a «esta y las siguientes» el día nuevo tiene que estar a menos de una semana de esta clase: si no, se vuelve a la selección actual.
    if (next === "series" && (pick.date < seriesWindow.minDate || pick.date > seriesWindow.maxDate)) setPick({ date: originalDate, time: originalTime });
  }

  function save(flags: { allowBlocked?: boolean; replace?: boolean; replacementKey?: string; confirmReplace?: boolean } = {}) {
    setError(null);
    const [hour, minute] = pick.time.split(":").map(Number);
    startTransition(async () => {
      if (scope === "series" && occurrence.recurrenceId) {
        const result = await guardNetwork(() => changeSeriesSlotAction({ ruleId: occurrence.recurrenceId as string, originalStart: occurrence.start, targetDate: pick.date, targetTime: pick.time, confirmReplace: flags.confirmReplace }));
        if (result.error) {
          setNeeds(result.replaces ? { kind: "series-replace" } : null);
          setError(result.error);
          return;
        }
        setDone(`Listo: desde ${formatCivilDayLabelShort(pick.date)}, esta sesión de la serie pasa a los ${targetWeekday} a las ${pick.time}.`);
      } else {
        const result = await guardNetwork(() => rescheduleWithAvailabilityAction({ id: occurrence.id, operationId, originalStart: occurrence.start, date: pick.date, hour, minute, allowBlocked: flags.allowBlocked, replace: flags.replace, replacementKey: flags.replacementKey }));
        if (result.error) {
          setNeeds(result.confirmation === "blocked" ? { kind: "blocked" } : result.confirmation === "replace" ? { kind: "replace", key: result.replacementKey } : null);
          setError(result.error);
          return;
        }
        setDone(`Listo: la clase pasó a ${nextText}. El horario original quedó liberado y marcado como reprogramado.`);
      }
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="ok" title="Cambio guardado">
          {done}
        </Notice>
        <div>
          <Button variant="primary" onClick={onDone} data-autofocus>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div className="rounded-md border-[1.5px] border-border bg-surface2 p-3">
        <p className="text-[15px] font-[650] text-textPrimary [overflow-wrap:anywhere]">{occurrence.title?.trim() || occurrence.studentName || "Clase"}</p>
        <p className="text-[14px] text-textSecondary">Ahora: {nowText} · {formatMinutes(duration)}</p>
        {names.length > 0 && <p className="text-[13.5px] text-textMuted [overflow-wrap:anywhere]">Participantes: {names.join(", ")}</p>}
      </div>

      {isSeries && (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-[14px] font-[650] text-textSecondary">¿Qué querés cambiar?</legend>
          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border-[1.5px] border-border p-2.5 has-[:checked]:border-ink has-[:checked]:bg-accentSoft">
            <input type="radio" name="schedule-scope" checked={scope === "single"} onChange={() => choose("single")} className="mt-1 h-5 w-5 accent-ink" />
            <span>
              <span className="block text-[15px] font-[650] text-textPrimary">Solo esta clase</span>
              <span className="block text-[13.5px] text-textSecondary">Mueve únicamente la clase del {formatCivilDayLabelShort(originalDate)}. La serie sigue igual.</span>
            </span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border-[1.5px] border-border p-2.5 has-[:checked]:border-ink has-[:checked]:bg-accentSoft">
            <input type="radio" name="schedule-scope" checked={scope === "series"} onChange={() => choose("series")} className="mt-1 h-5 w-5 accent-ink" />
            <span>
              <span className="block text-[15px] font-[650] text-textPrimary">Esta y las siguientes</span>
              <span className="block text-[13.5px] text-textSecondary">Esta sesión semanal cambia de día y hora desde aquí en adelante; las otras sesiones de la serie no cambian. Elegí un día de la misma semana.</span>
            </span>
          </label>
        </fieldset>
      )}

      <AvailabilityPicker
        key={scope}
        inline
        date={pick.date}
        time={pick.time}
        duration={duration}
        ignoreId={occurrence.id}
        series={scope === "series" && occurrence.recurrenceId ? { recurrenceId: occurrence.recurrenceId, originalStartIso: occurrence.start } : undefined}
        selectableUnavailable={scope === "single"}
        minDate={scope === "series" ? seriesWindow.minDate : undefined}
        maxDate={scope === "series" ? seriesWindow.maxDate : undefined}
        onSelect={(date, time) => {
          setPick({ date, time });
          setNeeds(null);
          setError(null);
        }}
      />

      <div role="status" aria-live="polite" className="rounded-md border-[1.5px] border-accentLine bg-accentSoft p-3.5">
        <p className="text-[15px] font-bold text-textPrimary">{changed ? "Quedará así" : "Todavía no elegiste un horario distinto"}</p>
        {changed && (
          <>
            <p className="text-[15px] text-textSecondary">
              {nowText} → <strong className="text-textPrimary">{nextText}</strong> ({formatMinutes(duration)}, la duración no cambia)
            </p>
            <p className="text-[13.5px] text-textMuted">
              {scope === "series"
                ? `Desde el ${formatCivilDayLabelShort(pick.date)}, esta sesión será todos los ${targetWeekday} a las ${pick.time}. Las demás sesiones de la serie no cambian.`
                : "Solo esta clase. El horario original queda liberado y marcado como reprogramado; el historial se conserva."}
            </p>
          </>
        )}
      </div>

      {error && <Notice tone={needs ? "warn" : "bad"}>{error}</Notice>}

      {needs?.kind === "blocked" && (
        <Notice tone="warn" title="Ese horario está bloqueado en tu disponibilidad">
          <p>Si querés, podés agendarla igual: el bloqueo es tuyo. No se superpone con otra clase.</p>
          <div className="mt-2">
            <Button variant="secondary" disabled={pending} onClick={() => save({ allowBlocked: true })}>
              Agendar igualmente
            </Button>
          </div>
        </Notice>
      )}
      {needs?.kind === "replace" && (
        <Notice tone="warn" title="Ese horario lo ocupa otra clase">
          <p>No queda superpuesta: si confirmás, esa otra clase se cancela y deja un aviso en la ficha de sus alumnos.</p>
          <div className="mt-2">
            <Button variant="secondary" disabled={pending} onClick={() => save({ replace: true, replacementKey: needs.key })}>
              Cancelar esa clase y mover esta
            </Button>
          </div>
        </Notice>
      )}
      {needs?.kind === "series-replace" && (
        <Notice tone="warn" title="Este cambio reemplaza cambios ya programados">
          <p>Si confirmás, esos cambios futuros dejan de regir y el nuevo horario los reemplaza desde esta fecha. Las clases pasadas no se tocan.</p>
          <div className="mt-2">
            <Button variant="secondary" disabled={pending} onClick={() => save({ confirmReplace: true })}>
              Confirmar y reemplazar
            </Button>
          </div>
        </Notice>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <Button variant="primary" busy={pending} disabled={!changed || pending} onClick={() => save()}>
          {pending ? "Guardando..." : scope === "series" ? "Confirmar para esta y las siguientes" : "Confirmar el cambio"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
