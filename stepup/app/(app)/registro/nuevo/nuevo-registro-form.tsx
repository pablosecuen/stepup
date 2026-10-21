"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startAdhocRegistrationAction } from "@/lib/actions/lesson-registrations";
import { guardNetwork } from "@/lib/actions/network-guard";
import { ADHOC_OUTCOME_LABEL, LATE_CANCELLATION_POLICY_LABEL, type AdhocOutcome, type LateCancellationPolicy } from "@/lib/lessons/adhoc";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { StudentPicker } from "@/components/students/student-picker";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button, PrivateButtonLink } from "@/components/ui/button";
import { Field, SelectInput, TextInput, checkClass, choiceGroupClass, choiceRowClass } from "@/components/ui/field";

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

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedStudents = students.filter((s) => selectedSet.has(s.id));

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
    <div className="flex flex-col gap-5">
      <fieldset className="min-w-0 rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-6">
        <legend className="px-2 text-label font-bold uppercase text-textMuted">Alumno o grupo *</legend>
        <StudentPicker students={students} selectedIds={selectedSet} onToggle={toggle} searchLabel="Buscar alumno activo" emptyText="No hay alumnos activos todavía." />
      </fieldset>

      <fieldset className="min-w-0 rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-6">
        <legend className="px-2 text-label font-bold uppercase text-textMuted">Clase</legend>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Fecha *" htmlFor="adhoc-date">
              <TextInput id="adhoc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Hora *" htmlFor="adhoc-time">
              <TextInput id="adhoc-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="Duración (min) *" htmlFor="adhoc-duration">
              <TextInput id="adhoc-duration" type="number" min="1" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
            </Field>
          </div>

          <Field label="Modalidad" htmlFor="adhoc-modality">
            <SelectInput id="adhoc-modality" aria-label="Modalidad" value={modality} onChange={(e) => setModality(e.target.value)}>
              <option value="presencial">Presencial</option>
              <option value="online">Online</option>
              <option value="mixta">Mixta</option>
            </SelectInput>
          </Field>

          <div className="flex flex-col gap-3">
            <Field label="Resultado" htmlFor="adhoc-outcome">
              <SelectInput id="adhoc-outcome" aria-label="Resultado" value={outcome} onChange={(e) => setOutcome(e.target.value as AdhocOutcome)}>
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {ADHOC_OUTCOME_LABEL[o]}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {outcome === "feriado" && (
              <label className={choiceRowClass}>
                <input type="checkbox" checked={holidayException} onChange={(e) => setHolidayException(e.target.checked)} className={checkClass} />
                Excepción: igual se dictó
              </label>
            )}
            {outcome === "cancelada_tarde" && (
              <div className="flex flex-col gap-4 rounded-md border-[1.5px] border-border bg-surface2 p-3.5">
                <Field label="Política de cancelación tardía" htmlFor="adhoc-policy">
                  <SelectInput id="adhoc-policy" value={lateCancellationPolicy} onChange={(e) => setLateCancellationPolicy(e.target.value as LateCancellationPolicy)}>
                    {LATE_CANCELLATION_POLICIES.map((p) => (
                      <option key={p} value={p}>
                        {LATE_CANCELLATION_POLICY_LABEL[p]}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                {lateCancellationPolicy === "cobrar_porcentaje" && (
                  <Field label="Porcentaje a cobrar" htmlFor="adhoc-percentage">
                    <TextInput id="adhoc-percentage" type="number" min="0" max="100" value={lateCancellationPercentage} onChange={(e) => setLateCancellationPercentage(e.target.value)} />
                  </Field>
                )}
              </div>
            )}
          </div>
        </div>
      </fieldset>

      {error && <FormErrorBox message={error} />}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <Button variant="primary" onClick={handleSubmit} busy={pending} disabled={!operationId}>
          {pending ? "Guardando..." : "Registrar clase"}
        </Button>
        <PrivateButtonLink href="/registro" variant="ghost">
          Cancelar
        </PrivateButtonLink>
      </div>
    </div>
  );
}
