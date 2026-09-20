import Link from "next/link";
import { STUDENT_STATUS_LABEL, STUDENT_STATUS_OPTIONS, MODALITY_LABEL, MODALITY_OPTIONS, STANDARD_LEVELS } from "@/lib/students/constants";

const selectClassName =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm text-textPrimary transition-colors duration-150 ease-premium focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue";

/**
 * Formulario GET puro — sin JavaScript en el cliente. Cada envío navega a
 * `/alumnos?...` con los filtros como query string; la página (Server
 * Component) los lee de `searchParams` y hace el filtrado/orden real. Nunca
 * duplica el filtrado en el cliente.
 */
export function StudentsFiltersForm({
  search,
  status,
  level,
  modality,
  levelOptions,
}: {
  search: string;
  status: string;
  level: string;
  modality: string;
  levelOptions: string[];
}) {
  const allLevels = [...STANDARD_LEVELS, ...levelOptions.filter((l) => !STANDARD_LEVELS.includes(l))];

  return (
    <form method="GET" action="/alumnos" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card" aria-label="Buscar y filtrar alumnos">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="q" className="text-sm font-medium text-textSecondary">
          Buscar por nombre
        </label>
        <input
          id="q"
          name="q"
          type="text"
          defaultValue={search}
          placeholder="Nombre del alumno..."
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-textPrimary placeholder:text-textMuted transition-colors duration-150 ease-premium focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium text-textSecondary">
            Estado
          </label>
          <select id="status" name="status" defaultValue={status} className={selectClassName}>
            <option value="todos">Todos</option>
            {STUDENT_STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {STUDENT_STATUS_LABEL[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="level" className="text-sm font-medium text-textSecondary">
            Nivel
          </label>
          <select id="level" name="level" defaultValue={level} className={selectClassName}>
            <option value="todos">Todos</option>
            {allLevels.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="modality" className="text-sm font-medium text-textSecondary">
            Modalidad
          </label>
          <select id="modality" name="modality" defaultValue={modality} className={selectClassName}>
            <option value="todos">Todas</option>
            {MODALITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {MODALITY_LABEL[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-textMuted">
        Orden por próxima clase o último pago todavía no está disponible — depende de Calendario y Cobros (fases 3 y 5).
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-brandBlue px-4 py-2 text-sm font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          Aplicar filtros
        </button>
        <Link href="/alumnos" className="text-sm font-medium text-textSecondary hover:text-textPrimary hover:underline">
          Limpiar
        </Link>
      </div>
    </form>
  );
}
