// Puerto VERBATIM del original (`src/features/payments/services/firstMonthProrationRepairService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { getStudentsStore } from '../../students/hooks/studentStore.ts';
import { loadCalendarLessons, loadRecurrenceExceptions, loadRecurrenceRules } from '../../calendar/hooks/calendarStore.ts';
import { getTeacherAvailability, hydrateTeacherAvailability } from '../../calendar/hooks/teacherAvailabilityStore.ts';
import { collectActiveSeriesForStudent } from '../../calendar/utils/firstMonthProrationCandidates.ts';
import { ensureFirstMonthProrationDecision } from './firstMonthProrationService.ts';

/**
 * CORRECCIÓN P0 DEFINITIVA (a pedido de Joaquín — primer mes proporcional
 * automático al crear/incorporar a una serie a mitad de mes): reparación
 * general, idempotente y segura — corre en el arranque/vuelta a primer
 * plano de la app (mismo patrón que
 * `runAutomaticMonthlyAmountReconciliationRepair`/
 * `runAutomaticDuplicateMonthlyChargeRepair`, ver `financialReconciliationService.ts`)
 * y cubre los caminos que un evento puntual en el calendario no alcanza a
 * disparar en tiempo real: series guardadas con alumnos que ya tenían
 * (sin "agregar participante" de por medio), datos rehidratados/restaurados
 * a los que les falte la decisión, y series creadas antes de esta
 * corrección.
 *
 * Recorre TODOS los alumnos activos (nunca uno puntual) y delega la
 * decisión real, alumno por alumno, a la ÚNICA operación canónica
 * (`ensureFirstMonthProrationDecision`) — nunca reimplementa la detección
 * ni la mutación. Cada alumno es independiente: un error en uno no impide
 * seguir con el resto (se registra y se continúa, igual criterio que las
 * demás reparaciones automáticas del arranque).
 */
export interface FirstMonthProrationRepairSummary {
  /** Alumnos activos con al menos una serie activa, evaluados. */
  checked: number;
  /** Decisión (y cargo) creado o actualizado automáticamente. */
  decided: number;
  /** Ya tenían una decisión válida para su primer período — nada que hacer. */
  alreadyDecided: number;
  /** Cargo con pagos/asignaciones reales — nunca se toca en silencio; queda para revisión manual. */
  skippedHasMovements: number;
  /**
   * Corrección 2026-08-27, segunda ronda: decisión histórica de origen
   * genuinamente ambiguo (sin `source`, criterio `proportional`/`no_charge`
   * — tanto el panel manual como el camino automático pudieron producirla)
   * — nunca se asume automática sin evidencia; ni el cargo ni la decisión
   * se tocan. Queda para revisión manual con trazabilidad ("Revisar primer
   * mes proporcional" en Cobros).
   */
  needsManualReview: number;
  /** No corresponde (sin plan mensual, sin serie activa, ya con historial mensual anterior, o datos insuficientes). */
  notApplicable: number;
  /** Alumnos donde la operación falló con una excepción real (no capturada como "sin movimientos") — no interrumpe al resto. */
  failed: number;
}

export async function runAutomaticFirstMonthProrationRepair(): Promise<FirstMonthProrationRepairSummary> {
  const [recurrenceRules, lessons, exceptions] = await Promise.all([
    loadRecurrenceRules(),
    loadCalendarLessons(),
    loadRecurrenceExceptions(),
    hydrateTeacherAvailability(),
  ]);
  const availability = getTeacherAvailability();
  const activeStudents = getStudentsStore().filter((student) => student.status === 'activo');

  const summary: FirstMonthProrationRepairSummary = {
    checked: 0,
    decided: 0,
    alreadyDecided: 0,
    skippedHasMovements: 0,
    needsManualReview: 0,
    notApplicable: 0,
    failed: 0,
  };

  for (const student of activeStudents) {
    const activeSeries = collectActiveSeriesForStudent(student.id, recurrenceRules ?? []);
    if (activeSeries.length === 0) continue;
    summary.checked += 1;

    try {
      const outcome = await ensureFirstMonthProrationDecision({
        studentId: student.id,
        activeSeries,
        exceptions: exceptions ?? [],
        existingLessons: lessons ?? [],
        availability,
        // Sin realMutationDateKey a propósito: esto es una reparación, nunca
        // el instante real de una alta — la fecha efectiva sale sólo del
        // inicio real de las series (ver `resolveEffectiveFirstMonthJoinDate`).
      });
      switch (outcome.status) {
        case 'decided':
          summary.decided += 1;
          break;
        case 'already_decided':
          summary.alreadyDecided += 1;
          break;
        case 'skipped_has_movements':
          summary.skippedHasMovements += 1;
          break;
        case 'needs_manual_review':
          summary.needsManualReview += 1;
          break;
        case 'not_applicable':
          summary.notApplicable += 1;
          break;
      }
    } catch (error) {
      summary.failed += 1;
      console.error('No se pudo reparar el primer mes proporcional de un alumno', error);
    }
  }

  return summary;
}
