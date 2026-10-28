import { addDaysToDateKey, biweeklyPeriodKey, billingPeriodOfDateKey, isoWeekKey, startOfIsoWeek } from "./dates.ts";
import { resolveStudentBillingPlan, type StudentBillingPlan } from "./billing-plan.ts";
import { isStudentBillableForPeriod } from "./monthly-charge-plan.ts";

/** Candidato a cargo semanal/quincenal: el período y el vencimiento van POR alumno (en la misma semana cada uno puede vencer otro día). */
export interface PeriodicChargeCandidate {
  studentId: string;
  amount: number;
  periodKey: string;
  dueDate: string;
}

export interface PeriodicChargeStudentInput {
  id: string;
  status: "activo" | "pausado" | "inactivo" | "archivado";
  statusChangeDate: string | null;
  billingPlan: StudentBillingPlan | null;
  billingType: "por_clase" | "mensual";
  price: number;
}

/**
 * Vencimiento del cargo semanal dentro de la semana ISO que empieza en `weekStartMonday`: `dueWeekday` usa la convención JS (0 = domingo … 6 = sábado);
 * una semana ISO va de lunes a domingo, así que el domingo es el ÚLTIMO día (desplazamiento 6), no el primero. Puerto de `dueDateForWeekday` (móvil).
 */
export function dueDateForWeekday(weekStartMonday: string, dueWeekday: number): string {
  return addDaysToDateKey(weekStartMonday, (dueWeekday - 1 + 7) % 7);
}

/**
 * Candidatos semanales y quincenales del día `todayKey`. Puerto de `runPeriodicChargeGeneration` (móvil), con una salvedad documentada:
 * el móvil sólo mira alumnos `activo`; acá se usa la misma regla de elegibilidad que la mensualidad (`isStudentBillableForPeriod`), que para un
 * alumno activo es idéntica y además no deja de facturar el período de baja de quien pasó a inactivo ese mismo mes (decisión ya vigente en la web).
 */
export function buildPeriodicChargeCandidates(students: PeriodicChargeStudentInput[], todayKey: string): { weekly: PeriodicChargeCandidate[]; biweekly: PeriodicChargeCandidate[] } {
  const weekly: PeriodicChargeCandidate[] = [];
  const biweekly: PeriodicChargeCandidate[] = [];
  const billingPeriod = billingPeriodOfDateKey(todayKey);
  for (const student of students) {
    if (!isStudentBillableForPeriod({ status: student.status, statusChangeDate: student.statusChangeDate, billingPeriod })) continue;
    const plan = resolveStudentBillingPlan({ billingPlan: student.billingPlan, billingType: student.billingType, price: student.price });
    if (plan.type === "weekly") {
      weekly.push({ studentId: student.id, amount: plan.amount, periodKey: isoWeekKey(todayKey), dueDate: dueDateForWeekday(startOfIsoWeek(todayKey), plan.dueWeekday) });
    } else if (plan.type === "biweekly") {
      const periodKey = biweeklyPeriodKey(todayKey, plan.anchorDate);
      biweekly.push({ studentId: student.id, amount: plan.amount, periodKey, dueDate: periodKey });
    }
  }
  return { weekly, biweekly };
}
