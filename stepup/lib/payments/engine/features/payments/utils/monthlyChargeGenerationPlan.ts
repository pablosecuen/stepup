// Puerto VERBATIM del original (`src/features/payments/utils/monthlyChargeGenerationPlan.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge } from '../types/index.ts';
import type { StudentBillingPlan, StudentStatus } from '../../student-profile/types/index.ts';
import { DEFAULT_MONTHLY_DUE_DAY, resolveEffectiveMonthlyAmount } from '../../student-profile/utils/studentBillingPlan.ts';
import { billingPeriodOfDateKey, resolveMonthlyDueDate, toDateKey } from './paymentDates.ts';
import { hasMonthlyCharge } from './paymentIdempotency.ts';
import { buildMonthlyCharge } from './paymentMutations.ts';

/** Insumo mínimo por alumno: sólo lo que hace falta para decidir/crear el cargo. */
export interface MonthlyChargeCandidateStudent {
  studentId: string;
  price: number;
  /**
   * Corrección 2026-09-02 (a pedido de Joaquín — vencimiento real de la
   * mensualidad): día del mes (1-28) real del alumno, ver
   * `MonthlyBillingPlan.dueDay`. Opcional — default `DEFAULT_MONTHLY_DUE_DAY`
   * (10) para no romper ningún llamador/fixture de prueba existente que
   * todavía no lo provee explícitamente.
   */
  dueDay?: number;
}

/**
 * Corrección 2026-09-02 (a pedido de Joaquín — ESTADO INACTIVO, regla de
 * elegibilidad financiera): única fuente que decide si un alumno es
 * facturable para UN período puntual, a partir de su estado ACTUAL y la
 * fecha efectiva de su último cambio de estado (`StudentProfile.statusChangeDate`).
 *   - `activo`: siempre facturable.
 *   - no activo, sin fecha de cambio conocida: nunca facturable (por
 *     seguridad — nunca facturar de más sin saber desde cuándo).
 *   - no activo, con fecha de cambio: facturable para el período de la baja
 *     y todos los anteriores (el período de la baja pudo tener actividad
 *     real antes de la fecha efectiva — no se reinterpreta acá; eso lo
 *     resuelven las reglas de baja/cargos ya devengados existentes); NUNCA
 *     para un período posterior al de la baja.
 * Reactivar (`status` vuelve a `activo`) hace que esta función vuelva a dar
 * `true` de inmediato para cualquier período futuro, sin ningún caso
 * especial — el gate de "ya existe" (`hasMonthlyCharge`) es, como siempre,
 * lo único que evita duplicar un cargo. Pura.
 */
export function isStudentBillableForPeriod(input: {
  status: StudentStatus;
  statusChangeDate: string | null;
  billingPeriod: string;
}): boolean {
  if (input.status === 'activo') return true;
  if (!input.statusChangeDate) return false;
  const inactivationPeriod = billingPeriodOfDateKey(toDateKey(input.statusChangeDate));
  return input.billingPeriod <= inactivationPeriod;
}

export type MonthlyChargeSkipReason = 'precio_invalido';

export interface MonthlyChargeSkipped {
  studentId: string;
  reason: MonthlyChargeSkipReason;
}

export interface MonthlyChargeGenerationPlan {
  toCreate: PaymentCharge[];
  skipped: MonthlyChargeSkipped[];
}

/**
 * Decide qué obligaciones mensuales faltan crear para `billingPeriod` (el
 * mes actual, ya resuelto en huso horario de Buenos Aires por el llamador),
 * dado un snapshot de alumnos activos con facturación mensual y los cargos
 * ya existentes. Idempotente por construcción: nunca duplica un cargo que
 * ya existe (persistido, o ya planificado más arriba en la misma corrida),
 * gracias a `buildMonthlyChargeId(studentId, billingPeriod)`. Nunca genera
 * cargos en cero: un precio inválido (no positivo o no finito) se omite y
 * se reporta en `skipped`, no se crea un cargo con importe 0. Pura — no
 * muta `existingCharges` ni `candidates`.
 */
export function planMonthlyChargeGeneration(input: {
  candidates: MonthlyChargeCandidateStudent[];
  existingCharges: PaymentCharge[];
  billingPeriod: string; // YYYY-MM, el mes actual (AR)
  createdAt: string; // ISO
}): MonthlyChargeGenerationPlan {
  const toCreate: PaymentCharge[] = [];
  const skipped: MonthlyChargeSkipped[] = [];

  input.candidates.forEach((student) => {
    if (!Number.isFinite(student.price) || student.price <= 0) {
      skipped.push({ studentId: student.studentId, reason: 'precio_invalido' });
      return;
    }

    const chargesSoFar = [...input.existingCharges, ...toCreate];
    if (hasMonthlyCharge(student.studentId, input.billingPeriod, chargesSoFar)) {
      return; // ya existe (persistido o ya planificado en esta misma corrida): idempotente, no es un error
    }

    // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
    // vencimiento el día 1 en vez del día real configurado): el vencimiento
    // se resuelve POR ALUMNO, nunca uno solo compartido — cada uno puede
    // tener su propio `dueDay` (`resolveMonthlyDueDate`, única fuente).
    const dueDate = resolveMonthlyDueDate(input.billingPeriod, student.dueDay ?? DEFAULT_MONTHLY_DUE_DAY);

    toCreate.push(
      buildMonthlyCharge({
        studentId: student.studentId,
        billingPeriod: input.billingPeriod,
        dueDate,
        originalAmount: student.price,
        createdAt: input.createdAt,
        existingCharges: chargesSoFar,
      })
    );
  });

  return { toCreate, skipped };
}

/**
 * Corrección 2026-07-26 (a pedido de Joaquín — ciclo mensual de cobros),
 * extendida 2026-09-02 (a pedido de Joaquín — ESTADO INACTIVO): decide qué
 * alumnos son candidatos a una mensualidad de `billingPeriod` — extraída de
 * `runMonthlyChargeGeneration` para poder probarla sin tocar los stores
 * reales. Ya no filtra sólo por `status === 'activo'` en el instante actual:
 * usa `isStudentBillableForPeriod` (arriba), que respeta la fecha efectiva
 * del cambio de estado — un alumno dado de baja DURANTE el período evaluado
 * sigue siendo candidato para ESE período (las reglas de baja/cargos ya
 * devengados existentes se aplican después, acá sólo se decide si
 * corresponde generar); uno dado de baja ANTES de que el período empezara,
 * no. Planes no mensuales y `plan.startPeriod` posterior al período
 * evaluado quedan afuera igual que antes. Pura — no lee ni escribe ningún
 * store.
 */
export function selectMonthlyChargeCandidates(input: {
  students: Array<{ id: string; status: StudentStatus; statusChangeDate?: string | null }>;
  resolvePlan: (studentId: string) => StudentBillingPlan | null;
  billingPeriod: string;
}): MonthlyChargeCandidateStudent[] {
  return input.students
    .filter((student) =>
      isStudentBillableForPeriod({
        status: student.status,
        statusChangeDate: student.statusChangeDate ?? null,
        billingPeriod: input.billingPeriod,
      })
    )
    .flatMap((student) => {
      const plan = input.resolvePlan(student.id);
      if (!plan || plan.type !== 'monthly') return [];
      if (plan.startPeriod && input.billingPeriod < plan.startPeriod) return [];
      // Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente
      // el flujo financiero mensual): nunca `plan.amount` directo — un
      // cambio "aplicado desde el próximo mes" deja `amount` con el valor
      // VIEJO a propósito hasta que el período facturado alcance la
      // vigencia nueva (`pendingAmount`/`pendingAmountEffectiveFrom`, ver
      // `resolveEffectiveMonthlyAmount`).
      return [
        {
          studentId: student.id,
          price: resolveEffectiveMonthlyAmount(plan, input.billingPeriod),
          dueDay: plan.dueDay,
        },
      ];
    });
}
