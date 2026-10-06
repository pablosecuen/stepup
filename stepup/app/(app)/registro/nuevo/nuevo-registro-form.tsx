"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startAdhocRegistrationAction } from "@/lib/actions/lesson-registrations";
import { guardNetwork } from "@/lib/actions/network-guard";
import { ADHOC_OUTCOME_LABEL, LATE_CANCELLATION_POLICY_LABEL, type AdhocOutcome, type LateCancellationPolicy } from "@/lib/lessons/adhoc";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { FormErrorBox } from "@/components/auth/form-boxes";

const OUTCOMES: AdhocOutcome[] = ["clase_dictada", "profesora_ausente", "feriado", "cancelada_con_aviso", "cancelada_tarde", "reprogramada"];
const LATE_CANCELLATION_POLICIES: LateCancellationPolicy[] = ["cobrar_100", "cobrar_porcentaje", "descontar_del_paquete", "no_cobrar"];

// Clave fija — sólo existe una pantalla real de "/registro/nuevo" a la vez
// (no hay varios borradores ad-hoc simultáneos que distinguir), a
// diferencia de una edición, que SÍ necesita distinguirse por registro.
const ADHOC_OPERATION_ID_STORAGE_KEY = "teacherflow:registro-adhoc:operation-id";

/**
 * Formulario de registro ad-hoc — estado controlado + `startTransition`
 * llamando la Server Action directo (mismo patrón que
 * `registration-workspace.tsx`/`start-registration-button.tsx`), nunca
 * `<form action>`: acá no hay ningún reset nativo de React 19 del que
 * protegerse, así que no hace falta el mecanismo de eco de valores de
 * `new-lesson-form.tsx`.
 */
export function NuevoRegistroForm({ students }: { students: { id: string; name: string; level: string }[] }) {
  const router = useRouter();
  // Idempotencia real que sobrevive una RECARGA (a pedido explícito de
  // Joaquín — un `useState(() => crypto.randomUUID())` sólo sobrevive
  // mientras el componente sigue montado, nunca una recarga real de la
  // página). Persistido en `sessionStorage`: se recupera si ya existía un
  // intento sin confirmar, se genera sólo si no existe, y se limpia
  // ÚNICAMENTE tras una respuesta exitosa confirmada — nunca antes, nunca
  // ante un error (ver `useDraftOperationId`).
  const { operationId, clear: clearOperationId } = useDraftOperationId(ADHOC_OPERATION_ID_STORAGE_KEY);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [modality, setModality] = useState("presencial");
  const [outcome, setOutcome] = useState<AdhocOutcome>("clase_dictada");
  const [holidayException, setHolidayException] = useState(false);
  const [lateCancellationPolicy, setLateCancellationPolicy] = useState<LateCancellationPolicy>("no_cobrar");
  const [lateCancellationPercentage, setLateCancellationPercentage] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, query]);

  const selectedStudents = students.filter((s) => selectedIds.includes(s.id));

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function handleSubmit() {
    if (!operationId) return; // todavía no se recuperó/generó el id — nunca enviar sin él.
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => startAdhocRegistrationAction({
        studentIds: selectedIds,
        date,
        time,
        durationMinutes: Number(durationMinutes) || 0,
        modality,
        activityKind: "class",
        outcome,
        holidayException,
        operationId,
        lateCancellationPolicy: outcome === "cancelada_tarde" ? lateCancellationPolicy : null,
        lateCancellationPercentage: outcome === "cancelada_tarde" && lateCancellationPolicy === "cobrar_porcentaje" ? Number(lateCancellationPercentage) || 0 : null,
      }));
      if (result.error) {
        setError(result.error);
        return;
      }
      // Recién ahora, con la respuesta exitosa confirmada, se limpia el
      // borrador — un error de arriba nunca llega hasta acá, así que el
      // mismo operationId sigue disponible para un reintento real.
      clearOperationId();
      router.push(`/registro/libre/${result.data!.registrationId}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-textSecondary">Alumno o grupo *</label>
        {selectedStudents.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {selectedStudents.map((s) => (
              <span key={s.id} className="flex items-center gap-1.5 rounded-pill bg-surface px-2.5 py-1 text-xs font-semibold text-textPrimary">
                {s.name}
                <button type="button" onClick={() => toggle(s.id)} aria-label={`Quitar a ${s.name}`} className="text-textMuted hover:text-textPrimary">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar alumno activo"
          aria-label="Buscar alumno activo"
          className="mt-1.5 w-full rounded-md border border-borderStrong px-2.5 py-2 text-sm"
        />
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-textMuted">No hay alumnos activos con ese nombre.</p>
          ) : (
            filtered.map((s) => {
              const isSelected = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-pressed={isSelected}
                  className="flex w-full items-center justify-between gap-2 border-b border-border px-2.5 py-2 text-left text-sm last:border-b-0 hover:bg-background"
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={`flex h-4 w-4 items-center justify-center rounded border text-[11px] font-bold leading-none text-white ${isSelected ? "border-brandBlue bg-brandBlue" : "border-borderStrong"}`}>{isSelected ? "✓" : ""}</span>
                    {s.name}
                  </span>
                  <span className="text-xs text-textMuted">{s.level}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-textSecondary">Fecha *</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-borderStrong px-2.5 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-textSecondary">Hora *</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-md border border-borderStrong px-2.5 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-textSecondary">Duración (min) *</span>
          <input
            type="number"
            min="1"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            className="rounded-md border border-borderStrong px-2.5 py-2 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-textSecondary">Modalidad</label>
        <select aria-label="Modalidad" value={modality} onChange={(e) => setModality(e.target.value)} className="rounded-md border border-borderStrong px-2.5 py-2 text-sm">
          <option value="presencial">Presencial</option>
          <option value="online">Online</option>
          <option value="mixta">Mixta</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-textSecondary">Resultado</label>
        <select aria-label="Resultado" value={outcome} onChange={(e) => setOutcome(e.target.value as AdhocOutcome)} className="rounded-md border border-borderStrong px-2.5 py-2 text-sm">
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {ADHOC_OUTCOME_LABEL[o]}
            </option>
          ))}
        </select>
        {outcome === "feriado" && (
          <label className="mt-1 flex items-center gap-2 text-sm text-textSecondary">
            <input type="checkbox" checked={holidayException} onChange={(e) => setHolidayException(e.target.checked)} />
            Excepción: igual se dictó
          </label>
        )}
        {outcome === "cancelada_tarde" && (
          <div className="mt-1.5 flex flex-col gap-2 rounded-md border border-border bg-background p-3">
            <label className="text-xs font-medium text-textSecondary">
              Política de cancelación tardía
              <select
                value={lateCancellationPolicy}
                onChange={(e) => setLateCancellationPolicy(e.target.value as LateCancellationPolicy)}
                className="mt-1 w-full rounded-md border border-borderStrong px-2.5 py-2 text-sm"
              >
                {LATE_CANCELLATION_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {LATE_CANCELLATION_POLICY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            {lateCancellationPolicy === "cobrar_porcentaje" && (
              <label className="text-xs font-medium text-textSecondary">
                Porcentaje a cobrar
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={lateCancellationPercentage}
                  onChange={(e) => setLateCancellationPercentage(e.target.value)}
                  className="mt-1 w-full rounded-md border border-borderStrong px-2.5 py-2 text-sm"
                />
              </label>
            )}
          </div>
        )}
      </div>

      {error && <FormErrorBox message={error} />}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending || !operationId}
        className="rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white shadow-card disabled:opacity-60"
      >
        {pending ? "Guardando..." : "Registrar clase"}
      </button>
    </div>
  );
}
