/**
 * Lógica PURA de selección del alumno principal — separada de las Server
 * Actions a propósito (mismo patrón que `lib/students/archive-prune-plan.ts`):
 * puede probarse directo con `node --test`, sin red ni bundler.
 *
 * Contrato (Fase 10, 20261001140000, hallazgo real: hasta esta ronda
 * `primaryStudentId` se asignaba como `selected[0]` — el primer elemento
 * del array de checkboxes marcados, que sigue el orden del DOM, nunca una
 * elección explícita de la profesora):
 * - un solo alumno seleccionado → se asigna automáticamente (no hay
 *   elección real posible, nunca se le pide confirmarlo);
 * - dos o más → exige una elección explícita, presente en el array de
 *   seleccionados; nunca cae de vuelta al primero por descarte;
 * - si el id enviado no está entre los seleccionados (desmarcado, o un
 *   payload manipulado), se rechaza siempre con el mismo error.
 */
export type ResolvePrimaryStudentResult = { primaryStudentId: string } | { error: string };

export function resolveExplicitPrimaryStudentId(selectedIds: readonly string[], submittedPrimaryId: string | null): ResolvePrimaryStudentResult {
  if (selectedIds.length === 0) {
    return { error: "Elegí al menos un alumno." };
  }
  if (selectedIds.length === 1) {
    return { primaryStudentId: selectedIds[0] };
  }
  if (!submittedPrimaryId || !selectedIds.includes(submittedPrimaryId)) {
    return { error: "Elegí quién es el alumno principal." };
  }
  return { primaryStudentId: submittedPrimaryId };
}

/**
 * Estado del selector de principal del lado del cliente, tras marcar o
 * desmarcar un alumno — usado por `new-lesson-form.tsx`/`series-status-actions.tsx`
 * para decidir si conservar, limpiar o auto-asignar `primaryStudentId`.
 *
 * Hallazgo real durante el E2E de esta ronda: al pasar de 1 a 2+
 * seleccionados, el valor auto-asignado cuando había un solo candidato
 * quedaba "pegado" sin que la profesora lo hubiera elegido de verdad entre
 * las opciones — mismo bug de fondo que esta ronda corrige, manifestado
 * en el cliente en vez de en el servidor. `prevSize` es el tamaño de la
 * selección ANTES del toggle que se acaba de aplicar.
 */
export function nextPrimaryAfterToggle(prevSize: number, nextSelectedIds: readonly string[], currentPrimaryId: string): string {
  if (nextSelectedIds.length === 1) {
    return nextSelectedIds[0];
  }
  if (prevSize <= 1) {
    return "";
  }
  if (!nextSelectedIds.includes(currentPrimaryId)) {
    return "";
  }
  return currentPrimaryId;
}
