/**
 * Cobro de una sesión según la ACTIVIDAD y el ACUERDO, no según el tipo de facturación general del alumno ni porque «tenga alguna cuota de entrenamiento». Una sesión de entrenamiento está cubierta por
 * la cuota mensual sólo si esa cuota es de SU acuerdo y de SU período:
 *   - sesión de una serie con acuerdo de cobro: está cubierta por ese acuerdo (identidad explícita: la serie lo declara);
 *   - sesión SUELTA (sin serie): sólo si exactamente UN acuerdo vigente tiene el MISMO grupo de alumnos que la sesión (mismo entrenamiento) Y ese alumno tiene la cuota vigente de ESE acuerdo en el
 *     mes de la sesión. Con dos acuerdos posibles, con un grupo distinto o sin la cuota de ese acuerdo en ese mes, NO se supone nada: la sesión conserva su cobro.
 * Una clase común nunca está cubierta. PURO.
 */
export interface TrainingAgreementRule {
  id: string;
  activityKind: string;
  status: string;
  startDate: string;
  endDate: string | null;
  agreementId: string | null;
  participantIds: readonly string[];
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set(a).size === new Set(b).size && a.every((id) => b.includes(id));

/** El acuerdo al que pertenece una sesión suelta de entrenamiento, o `null` si no hay uno solo que lo identifique sin ambigüedad. */
export function resolveLooseSessionAgreement(input: { participantIds: readonly string[]; dateKey: string; rules: readonly TrainingAgreementRule[] }): string | null {
  const agreements = new Set(
    input.rules
      .filter((rule) => rule.activityKind === "training" && !!rule.agreementId && rule.status !== "ended" && rule.startDate <= input.dateKey && (rule.endDate === null || rule.endDate >= input.dateKey) && sameSet(rule.participantIds, input.participantIds))
      .map((rule) => rule.agreementId as string)
  );
  return agreements.size === 1 ? [...agreements][0] : null;
}

/** Clave de una cuota mensual de entrenamiento vigente: acuerdo + alumno (el período lo fija la consulta). */
export const trainingChargeKey = (agreementId: string, studentId: string) => `${agreementId}|${studentId}`;

export function isCoveredByTrainingPlan(input: {
  activityKind: string | null | undefined;
  /** Acuerdo que declara la serie de la sesión (si la tiene). */
  seriesAgreementId: string | null | undefined;
  /** Acuerdo identificado para una sesión suelta (`resolveLooseSessionAgreement`). */
  matchedAgreementId?: string | null;
  studentId: string;
  /** Cuotas mensuales de entrenamiento vigentes del mes de la sesión (`trainingChargeKey`). */
  trainingChargeKeys?: ReadonlySet<string>;
}): boolean {
  if (input.activityKind !== "training") return false;
  if (input.seriesAgreementId) return true;
  return !!input.matchedAgreementId && (input.trainingChargeKeys?.has(trainingChargeKey(input.matchedAgreementId, input.studentId)) ?? false);
}
