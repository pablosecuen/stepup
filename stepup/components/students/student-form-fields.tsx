import type { CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import {
  BILLING_LABEL,
  BILLING_TYPE_OPTIONS,
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  MODALITY_LABEL,
  MODALITY_OPTIONS,
  STANDARD_LEVELS,
} from "@/lib/students/constants";
import { todayInArgentina } from "@/lib/format/date-format";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";

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
  const allLevelNames = [...STANDARD_LEVELS, ...customLevels.map((l) => l.name)];
  const selectedLevels = new Set(defaultValues?.levels ?? []);

  return (
    <div className="flex flex-col gap-5">
      <fieldset className={SECTION}>
        <legend className={LEGEND}>Datos básicos</legend>
        <div className="flex flex-col gap-5">
          <Field label="Nombre completo *" htmlFor="name">
            <TextInput id="name" name="name" type="text" required defaultValue={defaultValues?.name ?? ""} placeholder="Nombre y apellido" />
          </Field>

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="text-sm font-[650] text-textSecondary">Niveles</legend>
            <div className="flex flex-wrap gap-2">
              {allLevelNames.map((level) => (
                <label
                  key={level}
                  className="flex min-h-11 max-w-full cursor-pointer items-center gap-1.5 rounded-pill border-[1.5px] border-borderMid bg-surface px-4 py-1.5 text-[14.5px] font-[650] text-textPrimary transition-colors duration-150 hover:border-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2 has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-background"
                >
                  <input type="checkbox" name="levels" value={level} defaultChecked={selectedLevels.has(level)} className="peer sr-only" />
                  <span aria-hidden className="hidden text-xs font-bold peer-checked:inline">✓</span>
                  <span className="[overflow-wrap:anywhere]">{level}</span>
                </label>
              ))}
              {allLevelNames.length === 0 && <p className="text-xs text-textMuted">Todavía no hay niveles cargados.</p>}
            </div>
          </fieldset>

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

            <Field label="Tipo de facturación *" htmlFor="billingType">
              <SelectInput id="billingType" name="billingType" required defaultValue={defaultValues?.billingType ?? "por_clase"}>
                {BILLING_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {BILLING_LABEL[option]}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label="Precio (ARS) *" htmlFor="price">
              <TextInput id="price" name="price" type="number" min="0" step="1" required defaultValue={defaultValues?.price ?? ""} placeholder="0" />
            </Field>

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
        <legend className={LEGEND}>Contacto y notas</legend>
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

          <Field label="Notas" htmlFor="notes">
            <TextArea id="notes" name="notes" rows={3} defaultValue={defaultValues?.notes ?? ""} />
          </Field>
        </div>
      </fieldset>

      <p className="text-[13px] text-textMuted">* Campos obligatorios. El resto puede completarse más adelante.</p>
    </div>
  );
}
