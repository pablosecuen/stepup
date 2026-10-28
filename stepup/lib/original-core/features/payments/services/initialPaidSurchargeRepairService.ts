// Puerto VERBATIM del original (`src/features/payments/services/initialPaidSurchargeRepairService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { InitialPaidSurchargeCorrectionEntry } from '../types/index.ts';
import { applyInitialPaidSurchargeCorrection, findInitialPaidSurchargeCandidates, INITIAL_PAID_SURCHARGE_CORRECTION_REASON, type InitialPaidSurchargeCandidate } from '../utils/initialPaidSurchargeRepair.ts';
import { applyPaymentsMutation, getPaymentsSnapshot, hydratePaymentsStore } from '../hooks/paymentsStore.ts';
import { appendInitialPaidSurchargeCorrectionEntry } from '../hooks/initialPaidSurchargeCorrectionLogStore.ts';
import { getSurchargeSettingsSnapshot, hydrateSurchargeSettingsStore } from '../hooks/surchargeSettingsStore.ts';
import type { SurchargeSettings } from '../utils/surchargeSettings.ts';
import { getStudentProfilesSnapshot } from '../../student-profile/hooks/useStudentProfile.ts';

function studentsForCandidateSearch(): Array<{ id: string; dateJoined: string }> {
  return Object.values(getStudentProfilesSnapshot()).map((profile) => ({
    id: profile.id,
    dateJoined: profile.dateJoined,
  }));
}

/**
 * Corrección 2026-08-31 (a pedido de Joaquín — ERROR FINANCIERO: recargo
 * desactivado que seguía apareciendo como deuda): deps OPCIONALES para leer
 * la configuración de recargos VIGENTE — un llamador real (por defecto) usa
 * el store real; una prueba que no las provee sigue calculando con
 * `surchargeSettings: undefined` (el mismo `DEFAULT_SURCHARGE_SETTINGS` que
 * ya usaban todas las pruebas existentes de este servicio) sin tocar
 * AsyncStorage real.
 */
export interface SurchargeSettingsReadDeps {
  hydrateSurchargeSettings?: () => Promise<SurchargeSettings>;
  getSurchargeSettingsSnapshot?: () => SurchargeSettings;
}

const defaultSurchargeSettingsDeps: SurchargeSettingsReadDeps = {
  hydrateSurchargeSettings: hydrateSurchargeSettingsStore,
  getSurchargeSettingsSnapshot,
};

async function resolveCurrentSurchargeSettings(deps: SurchargeSettingsReadDeps): Promise<SurchargeSettings | undefined> {
  if (deps.hydrateSurchargeSettings) await deps.hydrateSurchargeSettings();
  return deps.getSurchargeSettingsSnapshot?.();
}

/**
 * Corrección 2026-08-02 (a pedido de Joaquín — alta financiera de alumnos
 * nuevos): repara automáticamente, en el arranque de la app, únicamente los
 * casos identificados con certeza absoluta (`isCertain: true`). Nunca
 * corrige por nombre ni por id — recorre TODO el estado financiero. Cada
 * candidato se corrige dentro de la MISMA `applyPaymentsMutation` (mismo
 * criterio anti-condición-de-carrera que `applyFirstMonthSituation`), así
 * que dos corridas concurrentes de la reparación automática nunca se pisan
 * ni duplican un ajuste — y una corrida repetida nunca vuelve a encontrar
 * los mismos candidatos, porque una vez corregidos ya no cumplen el patrón
 * del bug (su pago pasa a estar en término, sin recargo).
 */
export async function runAutomaticInitialPaidSurchargeRepair(
  now: Date = new Date(),
  surchargeSettingsDeps: SurchargeSettingsReadDeps = defaultSurchargeSettingsDeps
): Promise<{ correctedCount: number; correctedStudentIds: string[] }> {
  await hydratePaymentsStore();
  const surchargeSettings = await resolveCurrentSurchargeSettings(surchargeSettingsDeps);
  const students = studentsForCandidateSearch();

  const entriesToLog: InitialPaidSurchargeCorrectionEntry[] = [];

  await applyPaymentsMutation((current) => {
    const candidates = findInitialPaidSurchargeCandidates({
      now,
      charges: current.charges,
      payments: current.payments,
      allocations: current.allocations,
      adjustments: current.adjustments,
      students,
      surchargeSettings,
    }).filter((candidate) => candidate.isCertain);

    let next = current;
    candidates.forEach((candidate) => {
      const idSuffix = `${candidate.studentId}_${candidate.billingPeriod}_${now.getTime()}`;
      const result = applyInitialPaidSurchargeCorrection({
        candidate,
        state: next,
        now,
        newPaymentId: `payment_repair_${idSuffix}`,
        newAllocationId: `payment_repair_${idSuffix}_alloc_1`,
      });
      next = result.nextState;
      entriesToLog.push({
        id: `initial_paid_surcharge_correction_${idSuffix}`,
        studentId: result.studentId,
        billingPeriod: result.billingPeriod,
        previousSurchargeAmount: result.previousSurchargeAmount,
        voidedPaymentId: result.voidedPaymentId,
        newPaymentId: result.newPaymentId,
        correctedAt: now.toISOString(),
        reason: INITIAL_PAID_SURCHARGE_CORRECTION_REASON,
      });
    });
    return next;
  });

  for (const entry of entriesToLog) {
    try {
      await appendInitialPaidSurchargeCorrectionEntry(entry);
    } catch (auditError) {
      // Best-effort: la corrección real ya se aplicó y persistió — perder
      // sólo la entrada de auditoría no amerita deshacer un cambio
      // financiero correcto.
      console.error('No se pudo guardar el registro de auditoría de la reparación de recargo inicial', auditError);
    }
  }

  return {
    correctedCount: entriesToLog.length,
    correctedStudentIds: entriesToLog.map((entry) => entry.studentId),
  };
}

/**
 * Lectura pura (sin mutar nada) del candidato del alumno para el período
 * actual, sin importar si es certero o no — la usa `CobrosTab.tsx` para
 * decidir si ofrece "[ Corregir situación inicial ]". `null` si no hay
 * ningún candidato (nunca hubo recargo incorrecto detectable, o ya se
 * corrigió).
 */
export function findInitialPaidSurchargeCandidateForStudent(
  studentId: string,
  now: Date = new Date()
): InitialPaidSurchargeCandidate | null {
  const state = getPaymentsSnapshot();
  const students = studentsForCandidateSearch();
  const candidates = findInitialPaidSurchargeCandidates({
    now,
    charges: state.charges,
    payments: state.payments,
    allocations: state.allocations,
    adjustments: state.adjustments,
    students,
    surchargeSettings: getSurchargeSettingsSnapshot(),
  });
  return candidates.find((candidate) => candidate.studentId === studentId) ?? null;
}

/**
 * Corrección manual desde "[ Corregir situación inicial ]" — la profesora
 * ya vio importe/pago/recargo/resultado y confirmó explícitamente. Misma
 * operación que la reparación automática, sólo que sin exigir
 * `isCertain: true` (la confirmación explícita reemplaza la certeza
 * heurística) y acotada a un único alumno.
 */
export async function applyManualInitialPaidSurchargeCorrection(
  studentId: string,
  now: Date = new Date(),
  surchargeSettingsDeps: SurchargeSettingsReadDeps = defaultSurchargeSettingsDeps
): Promise<InitialPaidSurchargeCorrectionEntry> {
  await hydratePaymentsStore();
  const surchargeSettings = await resolveCurrentSurchargeSettings(surchargeSettingsDeps);
  const students = studentsForCandidateSearch();

  let entry: InitialPaidSurchargeCorrectionEntry | null = null;

  await applyPaymentsMutation((current) => {
    const candidate = findInitialPaidSurchargeCandidates({
      now,
      charges: current.charges,
      payments: current.payments,
      allocations: current.allocations,
      adjustments: current.adjustments,
      students,
      surchargeSettings,
    }).find((item) => item.studentId === studentId);

    if (!candidate) {
      throw new Error('No se encontró ningún recargo incorrecto para corregir en este alumno.');
    }

    const idSuffix = `${candidate.studentId}_${candidate.billingPeriod}_${now.getTime()}`;
    const result = applyInitialPaidSurchargeCorrection({
      candidate,
      state: current,
      now,
      newPaymentId: `payment_repair_${idSuffix}`,
      newAllocationId: `payment_repair_${idSuffix}_alloc_1`,
    });

    entry = {
      id: `initial_paid_surcharge_correction_${idSuffix}`,
      studentId: result.studentId,
      billingPeriod: result.billingPeriod,
      previousSurchargeAmount: result.previousSurchargeAmount,
      voidedPaymentId: result.voidedPaymentId,
      newPaymentId: result.newPaymentId,
      correctedAt: now.toISOString(),
      reason: INITIAL_PAID_SURCHARGE_CORRECTION_REASON,
    };
    return result.nextState;
  });

  if (!entry) {
    // Inalcanzable: si no había candidato, el updater lanzó y
    // `applyPaymentsMutation` rechazó — este código nunca corre.
    throw new Error('No se pudo aplicar la corrección de situación inicial.');
  }
  const confirmedEntry: InitialPaidSurchargeCorrectionEntry = entry;

  try {
    await appendInitialPaidSurchargeCorrectionEntry(confirmedEntry);
  } catch (auditError) {
    console.error('No se pudo guardar el registro de auditoría de la corrección manual de situación inicial', auditError);
  }

  return confirmedEntry;
}
