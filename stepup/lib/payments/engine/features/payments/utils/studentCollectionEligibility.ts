// Puerto VERBATIM del original (`src/features/payments/utils/studentCollectionEligibility.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentStatus } from '../../student-profile/types/index.ts';

/**
 * Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
 * CIRCUITO DE COBROS): única regla que decide si un alumno es candidato a
 * aparecer en CUALQUIER superficie OPERATIVA de cobro — Centro de cobros,
 * resumen financiero del Home, alertas/badges/contadores, pastilla de
 * estado mensual. Sólo depende del estado ACTUAL del alumno, nunca de
 * cuándo cambió: mientras no sea `'activo'`, el alumno nunca es candidato
 * operativo, sin importar si existe deuda legítima de un período anterior a
 * la baja — esa deuda se conserva íntegra en el historial financiero (nunca
 * se borra, nunca se perdona); sólo deja de representarse como una
 * situación de cobro vigente mientras el alumno esté pausado/inactivo/
 * archivado. Reactivar (`status` vuelve a `'activo'`) hace que esta función
 * vuelva a dar `true` de inmediato, sin ningún caso especial.
 *
 * Deliberadamente la MISMA regla para `'pausado'`, `'inactivo'` y
 * `'archivado'` — hoy los tres se tratan igual en todos los gates
 * existentes del dominio (generación mensual, pastilla "No aplica",
 * reactivación); no se inventa una distinción nueva entre ellos acá.
 *
 * Distinta, a propósito, de `isStudentBillableForPeriod`
 * (`monthlyChargeGenerationPlan.ts`): esa otra función responde "¿corresponde
 * GENERAR una obligación nueva para tal período?" (mira la fecha efectiva de
 * baja, para no facturar de más ni de menos el mes de la baja). Ésta
 * responde una pregunta distinta: "¿debo MOSTRAR a este alumno en el
 * circuito operativo de cobro AHORA?" — siempre no, mientras no esté
 * activo, sin excepción por fecha ni por período. Pura.
 */
export function isStudentEligibleForCollectionsDisplay(status: StudentStatus): boolean {
  return status === 'activo';
}
