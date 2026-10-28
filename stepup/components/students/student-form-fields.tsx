import { LevelPicker } from "./level-picker";
import { NewStudentBillingFields } from "./first-month-fields";
import type { CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import {
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  MODALITY_LABEL,
  MODALITY_OPTIONS,
  STANDARD_LEVELS,
} from "@/lib/students/constants";
import { todayInArgentina } from "@/lib/format/date-format";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { ageFromBirthDate, joinGoals, splitFullName } from "@/lib/students/student-form-fields";

const SECTION = "min-w-0 rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-6";
const LEGEND = "px-2 text-label font-bold uppercase text-textMuted";

/**
 * Campos del formulario de alumno, compartidos entre "Nuevo alumno" y
 * "Editar alumno" — sin estado propio (formulario no controlado, la
 * Server Action lee `FormData` directo), sólo difieren en `defaultValues`.
 * Ningún campo opcional del móvil se exige acá — mismo criterio de
 * validación que `students-mapping.ts` (nombre/modalidad/categoría/tipo de
 * facturación/fecha de alta/precio son los únicos obligatorios).
 */
export function StudentFormFields({
  defaultValues,
  customLevels,
}: {
  defaultValues?: Partial<StudentRecord>;
  customLevels: CustomLevelRecord[];
}) {
  const split = splitFullName(defaultValues?.name ?? "");
  const age = ageFromBirthDate(defaultValues?.birthDate, todayInArgentina());

  return (
    <div className="flex flex-col gap-5">
      <fieldset className={SECTION}>
        <legend className={LEGEND}>Datos básicos</legend>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_1fr_8rem]">
            <Field label="Nombre *" htmlFor="firstName">
              <TextInput id="firstName" name="firstName" type="text" required autoComplete="off" defaultValue={split.firstName} placeholder="Ej. Ana" />
            </Field>
            <Field label="Apellido *" htmlFor="lastName">
              <TextInput id="lastName" name="lastName" type="text" required autoComplete="off" defaultValue={split.lastName} placeholder="Ej. Pérez" />
            </Field>
            <Field label="Edad" htmlFor="age">
              <TextInput id="age" name="age" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} autoComplete="off" defaultValue={age !== null ? String(age) : ""} placeholder="Ej. 25" />
            </Field>
          </div>

          <LevelPicker customLevels={customLevels} defaultSelected={defaultValues?.levels ?? []} />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Modalidad *" htmlFor="modality">
              <SelectInput id="modality" name="modality" required defaultValue={defaultValues?.modality ?? "presencial"}>
                {MODALITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {MODALITY_LABEL[option]}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label="Categoría *" htmlFor="category">
              <SelectInput id="category" name="category" required defaultValue={defaultValues?.category ?? "otro"}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {CATEGORY_LABEL[option]}
                  </option>
                ))}
              </SelectInput>
            </Field>

            {defaultValues ? (
              <div className="sm:col-span-2" role="note">
                <p className="text-[14.5px] font-[650] text-textPrimary">Plan de cobro</p>
                <p className="mt-0.5 text-[14px] text-textSecondary">
                  Para cambiar cómo se cobra a este alumno o su importe, usá la pestaña <span className="font-[650]">Cobros</span> de su ficha: ahí se corrige el cargo del mes y queda registrado.
                </p>
              </div>
            ) : (
              <NewStudentBillingFields />
            )}

            <Field label="Frecuencia semanal" htmlFor="weeklyFrequency">
              <TextInput id="weeklyFrequency" name="weeklyFrequency" type="number" min="0" step="1" defaultValue={defaultValues?.weeklyFrequency ?? 1} />
            </Field>

            <Field label="Duración habitual (min)" htmlFor="usualDurationMinutes">
              <TextInput id="usualDurationMinutes" name="usualDurationMinutes" type="number" min="1" step="1" defaultValue={defaultValues?.usualDurationMinutes ?? 60} />
            </Field>
          </div>

          <Field label="Fecha de alta *" htmlFor="dateJoined">
            <TextInput id="dateJoined" name="dateJoined" type="date" required defaultValue={defaultValues?.dateJoined ?? todayInArgentina()} className="sm:max-w-[calc(50%-10px)]" />
          </Field>
        </div>
      </fieldset>

      <fieldset className={SECTION}>
        <legend className={LEGEND}>Contacto y objetivos</legend>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Field label="Teléfono" htmlFor="phone">
              <TextInput id="phone" name="phone" type="tel" defaultValue={defaultValues?.phone ?? ""} />
            </Field>
            <Field label="WhatsApp" htmlFor="whatsapp">
              <TextInput id="whatsapp" name="whatsapp" type="tel" defaultValue={defaultValues?.whatsapp ?? ""} />
            </Field>
            <Field label="Email" htmlFor="email">
              <TextInput id="email" name="email" type="email" defaultValue={defaultValues?.email ?? ""} />
            </Field>
          </div>

          <Field label="Objetivos" htmlFor="goals" hint="Uno por línea o separados por comas. Ej: preparar IELTS, mejorar speaking.">
            <TextArea id="goals" name="goals" rows={3} defaultValue={joinGoals(defaultValues?.currentGoals ?? [])} placeholder="Ej. Preparar IELTS, mejorar speaking…" />
          </Field>

          <Field label="Observaciones internas" htmlFor="notes">
            <TextArea id="notes" name="notes" rows={3} defaultValue={defaultValues?.notes ?? ""} placeholder="Información útil para la profesora" />
          </Field>
        </div>
      </fieldset>

      <p className="text-[13px] text-textMuted">* Campos obligatorios. El resto puede completarse más adelante.</p>
    </div>
  );
}
