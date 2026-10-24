/**
 * Cobro de una sesión según la ACTIVIDAD, no según el tipo de facturación general del alumno. Una sesión de ENTRENAMIENTO cuya serie tiene su
 * acuerdo de cobro mensual (`training_billing_agreement_id`) ya está cubierta por la cuota de ese mes: registrarla no genera un cobro por clase
 * suelta, aunque el alumno pague sus OTRAS clases por clase. También está cubierta una sesión de entrenamiento SUELTA (sin serie) de un alumno que tiene la cuota mensual de entrenamiento de ESE
 * mes (`hasTrainingChargeForPeriod`): es el mismo entrenamiento. Una clase común (o un entrenamiento sin acuerdo ni cuota del mes) conserva su cobro de siempre. PURO.
 */
export function isCoveredByTrainingPlan(input: { activityKind: string | null | undefined; trainingBillingAgreementId: string | null | undefined; hasTrainingChargeForPeriod?: boolean }): boolean {
  return input.activityKind === "training" && (!!input.trainingBillingAgreementId || input.hasTrainingChargeForPeriod === true);
}
