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

const inputClassName =
  "rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted transition-colors duration-150 ease-premium focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue";
const labelClassName = "text-sm font-medium text-textSecondary";
const fieldClassName = "flex flex-col gap-1.5";

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
      <div className={fieldClassName}>
        <label htmlFor="name" className={labelClassName}>
          Nombre completo *
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={defaultValues?.name ?? ""}
          placeholder="Nombre y apellido"
          className={inputClassName}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={labelClassName}>Niveles</legend>
        <div className="flex flex-wrap gap-2">
          {allLevelNames.map((level) => (
            <label
              key={level}
              className="flex cursor-pointer items-center gap-1.5 rounded-pill border border-border bg-background px-3 py-1.5 text-xs font-medium text-textSecondary has-[:checked]:border-brandBlue has-[:checked]:bg-brandBlue/10 has-[:checked]:text-brandBlueDark"
            >
              <input type="checkbox" name="levels" value={level} defaultChecked={selectedLevels.has(level)} className="sr-only" />
              {level}
            </label>
          ))}
          {allLevelNames.length === 0 && <p className="text-xs text-textMuted">Todavía no hay niveles cargados.</p>}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className={fieldClassName}>
          <label htmlFor="modality" className={labelClassName}>
            Modalidad *
          </label>
          <select id="modality" name="modality" required defaultValue={defaultValues?.modality ?? "presencial"} className={inputClassName}>
            {MODALITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {MODALITY_LABEL[option]}
              </option>
            ))}
          </select>
        </div>

        <div className={fieldClassName}>
          <label htmlFor="category" className={labelClassName}>
            Categoría *
          </label>
          <select id="category" name="category" required defaultValue={defaultValues?.category ?? "otro"} className={inputClassName}>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {CATEGORY_LABEL[option]}
              </option>
            ))}
          </select>
        </div>

        <div className={fieldClassName}>
          <label htmlFor="billingType" className={labelClassName}>
            Tipo de facturación *
          </label>
          <select id="billingType" name="billingType" required defaultValue={defaultValues?.billingType ?? "por_clase"} className={inputClassName}>
            {BILLING_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {BILLING_LABEL[option]}
              </option>
            ))}
          </select>
        </div>

        <div className={fieldClassName}>
          <label htmlFor="price" className={labelClassName}>
            Precio (ARS) *
          </label>
          <input
            id="price"
            name="price"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={defaultValues?.price ?? ""}
            placeholder="0"
            className={inputClassName}
          />
        </div>

        <div className={fieldClassName}>
          <label htmlFor="weeklyFrequency" className={labelClassName}>
            Frecuencia semanal
          </label>
          <input
            id="weeklyFrequency"
            name="weeklyFrequency"
            type="number"
            min="0"
            step="1"
            defaultValue={defaultValues?.weeklyFrequency ?? 1}
            className={inputClassName}
          />
        </div>

        <div className={fieldClassName}>
          <label htmlFor="usualDurationMinutes" className={labelClassName}>
            Duración habitual (min)
          </label>
          <input
            id="usualDurationMinutes"
            name="usualDurationMinutes"
            type="number"
            min="1"
            step="1"
            defaultValue={defaultValues?.usualDurationMinutes ?? 60}
            className={inputClassName}
          />
        </div>
      </div>

      <div className={fieldClassName}>
        <label htmlFor="dateJoined" className={labelClassName}>
          Fecha de alta *
        </label>
        <input
          id="dateJoined"
          name="dateJoined"
          type="date"
          required
          defaultValue={defaultValues?.dateJoined ?? new Date().toISOString().slice(0, 10)}
          className={inputClassName}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className={fieldClassName}>
          <label htmlFor="phone" className={labelClassName}>
            Teléfono
          </label>
          <input id="phone" name="phone" type="tel" defaultValue={defaultValues?.phone ?? ""} className={inputClassName} />
        </div>
        <div className={fieldClassName}>
          <label htmlFor="whatsapp" className={labelClassName}>
            WhatsApp
          </label>
          <input id="whatsapp" name="whatsapp" type="tel" defaultValue={defaultValues?.whatsapp ?? ""} className={inputClassName} />
        </div>
        <div className={fieldClassName}>
          <label htmlFor="email" className={labelClassName}>
            Email
          </label>
          <input id="email" name="email" type="email" defaultValue={defaultValues?.email ?? ""} className={inputClassName} />
        </div>
      </div>

      <div className={fieldClassName}>
        <label htmlFor="notes" className={labelClassName}>
          Notas
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaultValues?.notes ?? ""}
          className={inputClassName}
        />
      </div>

      <p className="text-xs text-textMuted">* Campos obligatorios. El resto puede completarse más adelante.</p>
    </div>
  );
}
