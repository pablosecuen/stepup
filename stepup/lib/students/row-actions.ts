import type { StudentStatus } from "../db/database.types.ts";

export type StudentRowActionKey = "perfil" | "registrar_clase" | "registrar_pago" | "reprogramar" | "reporte" | "editar" | "cambiar_estado";

export interface StudentRowAction {
  key: StudentRowActionKey;
  label: string;
  href: string;
}

const instantDateKey = (instant: string) => instant.slice(0, 10);

/**
 * Accesos directos de UN alumno desde la lista. Cada uno lleva al circuito que ya existe en la web (nada se reimplementa) y el destino siempre incluye el id del alumno de ESA fila:
 * registrar clase (registro nuevo con el alumno elegido), registrar pago (Cobros del alumno), reprogramar (su próxima clase en el calendario; sólo si la tiene y está activo), reporte, editar y
 * cambios de estado (archivar o restaurar según su estado: la elección sobre la agenda futura y el cobro mensual se hace en su ficha). El original solo ofrecía archivar/restaurar/eliminar por
 * deslizamiento en la lista; el resto vivía en la ficha. «Eliminar definitivamente» no se ofrece (decisión pendiente).
 */
export function buildStudentRowActions(input: { id: string; status: StudentStatus; nextClassStart: string | null }): StudentRowAction[] {
  const id = encodeURIComponent(input.id);
  const actions: StudentRowAction[] = [{ key: "perfil", label: "Ver perfil", href: `/alumnos/${id}` }];
  if (input.status === "activo") actions.push({ key: "registrar_clase", label: "Registrar clase", href: `/registro/nuevo?alumno=${id}` });
  actions.push({ key: "registrar_pago", label: "Registrar pago", href: `/alumnos/${id}?tab=cobros` });
  if (input.status === "activo" && input.nextClassStart) {
    actions.push({ key: "reprogramar", label: "Reprogramar clase", href: `/calendario?view=day&day=${instantDateKey(input.nextClassStart)}&reprogramarAlumno=${id}&reprogramarInicio=${encodeURIComponent(input.nextClassStart)}` });
  }
  actions.push({ key: "reporte", label: "Reporte", href: `/alumnos/${id}?tab=reportes` });
  actions.push({ key: "editar", label: "Editar alumno", href: `/alumnos/${id}/editar` });
  actions.push({ key: "cambiar_estado", label: input.status === "activo" || input.status === "pausado" ? "Archivar o cambiar estado" : "Restaurar alumno", href: `/alumnos/${id}?tab=resumen#cambiar-estado` });
  return actions;
}
