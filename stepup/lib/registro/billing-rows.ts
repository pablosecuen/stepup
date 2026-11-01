import type { ParticipantBillingDecision } from "../payments/training-coverage.ts";

export type BillingRow =
  | { studentId: string; studentName: string; kind: "covered"; agreementLabel: string }
  | { studentId: string; studentName: string; kind: "own_regime"; explicit: boolean }
  | { studentId: string; studentName: string; kind: "needs_association"; options: { agreementId: string; label: string }[]; suggestedAgreementId: string | null };

const FALLBACK_LABEL = "Entrenamiento";

/**
 * Filas del panel «Cobro de este entrenamiento»: una por participante CON cobro por clase (los demás planes no generan cobro por una sesión, así que no hay nada que aclarar). Una
 * clase común no tiene panel. La decisión viene de `resolveRegistrationBilling`; acá sólo se le pone nombre a cada acuerdo y se ordenan las opciones. PURO.
 */
export function buildBillingRows(input: {
  activityKind: string;
  participants: readonly { studentId: string; name: string; billsPerClass: boolean }[];
  decisions: ReadonlyMap<string, ParticipantBillingDecision>;
  agreementLabels: ReadonlyMap<string, string>;
}): BillingRow[] {
  if (input.activityKind !== "training") return [];
  const label = (agreementId: string) => input.agreementLabels.get(agreementId) ?? FALLBACK_LABEL;
  const rows: BillingRow[] = [];
  for (const participant of input.participants) {
    if (!participant.billsPerClass) continue;
    const decision = input.decisions.get(participant.studentId);
    if (!decision) continue;
    if (decision.kind === "covered") rows.push({ studentId: participant.studentId, studentName: participant.name, kind: "covered", agreementLabel: label(decision.agreementId) });
    else if (decision.kind === "own_regime") rows.push({ studentId: participant.studentId, studentName: participant.name, kind: "own_regime", explicit: decision.source === "explicit" });
    else
      rows.push({
        studentId: participant.studentId,
        studentName: participant.name,
        kind: "needs_association",
        options: decision.candidateAgreementIds.map((agreementId) => ({ agreementId, label: label(agreementId) })),
        suggestedAgreementId: decision.suggestedAgreementId,
      });
  }
  return rows;
}
