/**
 * Cobro de una sesión según la ACTIVIDAD y el ACUERDO de cada participante, nunca según el tipo de facturación general del alumno ni porque «tenga alguna cuota de entrenamiento».
 * Una sesión de entrenamiento está cubierta por una cuota mensual sólo si esa cuota es de SU acuerdo y el participante pertenece a él; si eso no está declarado, NO se supone nada:
 *   - clase común: se cobra por el régimen propio del alumno; un entrenamiento jamás la cubre ni ella consume su cuota;
 *   - entrenamiento con acuerdo declarado por su serie (o por la propia clase) y participante que pertenece a ese acuerdo: cubierto por ESE acuerdo, sin cobro por clase;
 *   - entrenamiento cuyo participante no pertenece a ningún acuerdo: se cobra por el régimen propio del alumno (no hay otra obligación que lo cubra);
 *   - entrenamiento sin acuerdo declarado, o con un participante que no pertenece al acuerdo de la serie, y con acuerdos posibles: FALTA UNA ASOCIACIÓN. No se genera cobro ni se
 *     da por cubierto: la profesora lo resuelve explícitamente (a qué acuerdo pertenece, o «cobrar como clase suelta») y la decisión queda guardada para ese participante.
 * Una decisión explícita guardada manda sobre todo lo demás. PURO.
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

/**
 * SUGERENCIA (nunca una decisión) para una sesión suelta de entrenamiento: el único acuerdo vigente con el MISMO grupo de alumnos, o `null` si no hay uno solo. Sólo sirve para
 * preseleccionar la opción más probable en la pantalla; la sesión no queda asociada hasta que la profesora lo confirma.
 */
export function resolveLooseSessionAgreement(input: { participantIds: readonly string[]; dateKey: string; rules: readonly TrainingAgreementRule[] }): string | null {
  const agreements = new Set(
    input.rules
      .filter((rule) => rule.activityKind === "training" && !!rule.agreementId && rule.status !== "ended" && rule.startDate <= input.dateKey && (rule.endDate === null || rule.endDate >= input.dateKey) && sameSet(rule.participantIds, input.participantIds))
      .map((rule) => rule.agreementId as string)
  );
  return agreements.size === 1 ? [...agreements][0] : null;
}

/** Decisión explícita guardada para un participante: `agreementId` = cubierto por ese acuerdo; `null` = se cobra por su régimen propio (clase suelta). */
export type SavedBillingResolution = { agreementId: string | null };

export type ParticipantBillingDecision =
  /** Cubierto por la cuota mensual de ESE acuerdo: la sesión no genera cobro por clase. */
  | { kind: "covered"; agreementId: string; source: "series" | "explicit" }
  /** Se cobra por el régimen propio del alumno (una clase común, un entrenamiento sin acuerdo que lo incluya, o una decisión explícita de cobrarla como clase suelta). */
  | { kind: "own_regime"; source: "class" | "no_agreement" | "explicit" }
  /** Falta una asociación: no se genera cobro ni se supone cobertura hasta que la profesora lo resuelva. `suggestedAgreementId` sólo preselecciona. */
  | { kind: "needs_association"; candidateAgreementIds: string[]; suggestedAgreementId: string | null };

export interface SessionBillingInput {
  activityKind: string | null | undefined;
  /** Acuerdo que la propia sesión declara (el de su serie o el guardado en la clase), si lo tiene. */
  sessionAgreementId: string | null;
  participantIds: readonly string[];
  /** Acuerdos a los que pertenece cada participante (integrante de una serie de ese acuerdo o con cuota de ese acuerdo). Sin entrada = ninguno. */
  membership: ReadonlyMap<string, ReadonlySet<string>>;
  /** Decisiones explícitas ya guardadas, por participante. */
  saved: ReadonlyMap<string, SavedBillingResolution>;
  /** Sugerencia para una sesión suelta (`resolveLooseSessionAgreement`). */
  looseSuggestionAgreementId?: string | null;
}

export function resolveSessionBilling(input: SessionBillingInput): Map<string, ParticipantBillingDecision> {
  const result = new Map<string, ParticipantBillingDecision>();
  for (const studentId of input.participantIds) {
    if (input.activityKind !== "training") {
      result.set(studentId, { kind: "own_regime", source: "class" });
      continue;
    }
    const saved = input.saved.get(studentId);
    if (saved) {
      result.set(studentId, saved.agreementId ? { kind: "covered", agreementId: saved.agreementId, source: "explicit" } : { kind: "own_regime", source: "explicit" });
      continue;
    }
    const memberOf = input.membership.get(studentId) ?? new Set<string>();
    if (input.sessionAgreementId && memberOf.has(input.sessionAgreementId)) {
      result.set(studentId, { kind: "covered", agreementId: input.sessionAgreementId, source: "series" });
      continue;
    }
    const candidates = [...new Set([...(input.sessionAgreementId ? [input.sessionAgreementId] : []), ...memberOf])];
    if (candidates.length === 0) {
      result.set(studentId, { kind: "own_regime", source: "no_agreement" });
      continue;
    }
    const suggested = input.sessionAgreementId ?? (candidates.length === 1 ? candidates[0] : input.looseSuggestionAgreementId && candidates.includes(input.looseSuggestionAgreementId) ? input.looseSuggestionAgreementId : null);
    result.set(studentId, { kind: "needs_association", candidateAgreementIds: candidates, suggestedAgreementId: suggested });
  }
  return result;
}

/** Sólo un participante con la asociación resuelta como «régimen propio» genera cobro por clase: cubierto y pendiente de resolver nunca lo generan. */
export const generatesPerClassCharge = (decision: ParticipantBillingDecision) => decision.kind === "own_regime";
