// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/collectionsCenter.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { FirstMonthProrationDecision, Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { allocatePayment, recordPayment } from '../paymentMutations.ts';
import { buildCollectionsCenterEntries, summarizeCollectionsUrgency, URGENCY_RANK } from '../collectionsCenter.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function charge(overrides: Partial<PaymentCharge> & { id: string; studentId: string; dueDate: string }): PaymentCharge {
  return {
    type: 'mensual',
    originalAmount: 10000,
    currency: 'ARS',
    createdAt: '2026-01-01T00:00:00.000Z',
    billingPeriod: overrides.dueDate.slice(0, 7),
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> & { id: string; studentId: string; paidAt: string }): Payment {
  return {
    amount: 10000,
    currency: 'ARS',
    method: 'efectivo',
    recordedAt: `${overrides.paidAt}T12:00:00.000Z`,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function allocation(
  overrides: Partial<PaymentAllocation> & { id: string; paymentId: string; chargeId: string; studentId: string }
): PaymentAllocation {
  return { amount: 10000, ...overrides };
}

function firstMonthDecision(
  overrides: Partial<FirstMonthProrationDecision> & { id: string; studentId: string; billingPeriod: string; chargeId: string | null }
): FirstMonthProrationDecision {
  return {
    effectiveJoinDate: `${overrides.billingPeriod}-18`,
    criterion: 'proportional',
    classesRemaining: 2,
    classesPerFullPeriod: 4,
    permanentMonthlyAmount: 10000,
    chargedAmount: 10000,
    createdAt: '2026-01-01T00:00:00.000Z',
    confirmedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Vence hoy
// ---------------------------------------------------------------------------

test('vence hoy: un cargo en término cuyo vencimiento es exactamente hoy aparece con urgencia "vence_hoy"', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-15' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15' });
  assertEqual(entries.length, 1, 'una entrada');
  assertEqual(entries[0].urgency, 'vence_hoy', 'vence exactamente hoy');
  assertEqual(entries[0].pendingAmount, 10000, 'sin recargo todavía');
});

test('un cargo en término que todavía NO vence hoy no aparece en el centro de cobros', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-10' }); // día 5 del mes, vencimiento real el 10: pendiente en término, ni vence pronto ni vence hoy
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-05' });
  assertEqual(entries.length, 0, 'no urge todavía: no vence hoy y no está en mora');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
// monetarias automáticas"): sin recargos, `collectionsCenter.ts` ya
// colapsaba (desde la Fase de recargos configurables) las 3 etapas
// diferenciadas en una única urgencia genérica `'vencido'` — ese
// comportamiento, antes sólo alcanzable apagando el switch a mano, ahora es
// el ÚNICO alcanzable: cualquier obligación vencida, sin importar hace
// cuántos días, aparece como `'vencido'`, nunca primer/segundo/último
// vencimiento (esos textos implicaban un % de recargo que ya no existe). El
// importe pendiente es siempre el original, sin recargo.
// ---------------------------------------------------------------------------

test('mora (etapa first_late real): aparece con urgencia genérica "vencido", nunca "primer vencimiento" ni con recargo', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15' }); // día 15: first_late
  assertEqual(entries[0].urgency, 'vencido', 'urgencia genérica, sin recargos automáticos');
  assertEqual(entries[0].pendingAmount, 10000, 'importe original, sin recargo');
});

test('mora (etapa second_late real): aparece con urgencia genérica "vencido", nunca "segundo vencimiento" ni con recargo', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-22' }); // día 22: second_late
  assertEqual(entries[0].urgency, 'vencido', 'urgencia genérica, sin recargos automáticos');
  assertEqual(entries[0].pendingAmount, 10000, 'importe original, sin recargo');
});

test('mora (etapa last_late real): aparece con urgencia genérica "vencido", nunca "último vencimiento" ni con recargo', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-30' }); // día 30: last_late
  assertEqual(entries[0].urgency, 'vencido', 'urgencia genérica, sin recargos automáticos');
  assertEqual(entries[0].pendingAmount, 10000, 'importe original, sin recargo');
});

// ---------------------------------------------------------------------------
// Saldadas: nunca aparecen
// ---------------------------------------------------------------------------

test('una obligación saldada (incluso con sobrepago) no aparece', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const p = payment({ id: 'payment-1', studentId: 's1', amount: 10500, paidAt: '2026-07-05' });
  const a = allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'c-1', studentId: 's1', amount: 10500 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-20' });
  assertEqual(entries.length, 0, 'saldada, con sobrepago incluso: no necesita atención');
});

// ---------------------------------------------------------------------------
// Pagos parciales
// ---------------------------------------------------------------------------

test('pagos parciales: hasPartialPayment=true cuando ya se pagó algo pero queda saldo pendiente', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const p = payment({ id: 'payment-1', studentId: 's1', amount: 4000, paidAt: '2026-07-05' });
  const a = allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'c-1', studentId: 's1', amount: 4000 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-22' });
  assertEqual(entries.length, 1, 'sigue apareciendo: queda saldo');
  assertEqual(entries[0].hasPartialPayment, true, 'tiene un pago parcial');
  assertEqual(entries[0].pendingAmount, 6000, '10000 requeridos (sin recargo) menos los 4000 ya pagados');
});

test('sin ningún pago todavía: hasPartialPayment=false', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15' });
  assertEqual(entries[0].hasPartialPayment, false, 'todavía nada pagado');
});

// ---------------------------------------------------------------------------
// Anulados: nunca cuentan
// ---------------------------------------------------------------------------

test('un cargo anulado no aparece en el centro de cobros', () => {
  const c = charge({
    id: 'c-1',
    studentId: 's1',
    dueDate: '2026-07-01',
    voidedAt: '2026-07-02T00:00:00.000Z',
    voidReason: 'clase cancelada',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-22' });
  assertEqual(entries.length, 0, 'un cargo anulado nunca necesita atención');
});

test('un pago anulado no cuenta como parcial ni reduce el saldo pendiente', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const p = payment({
    id: 'payment-1',
    studentId: 's1',
    amount: 4000,
    paidAt: '2026-07-05',
    voidedAt: '2026-07-06T00:00:00.000Z',
    voidReason: 'error de carga',
  });
  const a = allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'c-1', studentId: 's1', amount: 4000 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-22' });
  assertEqual(entries[0].hasPartialPayment, false, 'el pago anulado no cuenta como parcial');
  assertEqual(entries[0].pendingAmount, 10000, 'el saldo pendiente es el total (sin recargo), como si nunca se hubiera pagado nada');
});

// ---------------------------------------------------------------------------
// Concepto: distingue mensualidades de clases individuales
// ---------------------------------------------------------------------------

test('el concepto distingue una mensualidad de una clase individual', () => {
  const mensual = charge({ id: 'c-mensual', studentId: 's1', dueDate: '2026-07-01', billingPeriod: '2026-07' });
  const porClase = charge({
    id: 'c-clase',
    studentId: 's2',
    dueDate: '2026-07-11',
    type: 'por_clase',
    billingPeriod: undefined,
    savedLessonId: 'lesson-1',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [mensual, porClase] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-11' });
  const mensualEntry = entries.find((e) => e.chargeId === 'c-mensual')!;
  const claseEntry = entries.find((e) => e.chargeId === 'c-clase')!;
  assertEqual(mensualEntry.concept, 'Mensualidad de julio 2026', 'concepto de mensualidad');
  assertEqual(claseEntry.concept, 'Clase del 11/07/2026', 'concepto de clase individual, con fecha DD/MM/YYYY');
  assertEqual(mensualEntry.chargeType, 'mensual', 'tipo mensual');
  assertEqual(claseEntry.chargeType, 'por_clase', 'tipo por clase');
});

// ---------------------------------------------------------------------------
// Orden: las situaciones más urgentes primero
// ---------------------------------------------------------------------------

test('ordena primero las situaciones más urgentes — las 3 etapas de mora comparten la urgencia genérica "vencido" (mismo rango), desempatadas por vencimiento más antiguo', () => {
  const hoy = charge({ id: 'c-hoy', studentId: 's1', dueDate: '2026-07-20' });
  const primero = charge({ id: 'c-primero', studentId: 's2', dueDate: '2026-07-05' }); // día 16 del ciclo: first_late (mora real)
  const ultimo = charge({ id: 'c-ultimo', studentId: 's3', dueDate: '2026-06-01' }); // muy vencida: last_late (mora real)
  const segundo = charge({ id: 'c-segundo', studentId: 's4', dueDate: '2026-06-25' }); // día 26: second_late (mora real)

  const state: PaymentsRepositoryState = { ...emptyState(), charges: [hoy, primero, ultimo, segundo] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-20' });

  assertEqual(entries.map((e) => e.urgency).join(','), 'vencido,vencido,vencido,vence_hoy', 'sin recargos, las 3 etapas de mora comparten urgencia genérica; "vence hoy" sigue siendo la menos urgente');
  assertEqual(entries.map((e) => e.chargeId).slice(0, 3).join(','), 'c-ultimo,c-segundo,c-primero', 'dentro del mismo rango, ordena por vencimiento más antiguo primero');
});

test('dentro de la misma urgencia, ordena por vencimiento más antiguo primero', () => {
  const a = charge({ id: 'c-a', studentId: 's1', dueDate: '2026-05-01' }); // last_late, vencida hace más tiempo
  const b = charge({ id: 'c-b', studentId: 's2', dueDate: '2026-05-15' }); // last_late también, pero vencida hace menos tiempo
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [b, a] }; // orden de entrada invertido a propósito
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-01' });
  assertEqual(entries[0].urgency, entries[1].urgency, 'ambas están en la misma etapa de urgencia');
  assertEqual(entries[0].chargeId, 'c-a', 'la más antigua primero, sin importar el orden de entrada');
});

// ---------------------------------------------------------------------------
// Sin duplicados
// ---------------------------------------------------------------------------

test('nunca duplica un cargo, aunque el array de entrada tenga un id repetido', () => {
  const c1 = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01' });
  const c1Duplicado = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c1, c1Duplicado] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15' });
  assertEqual(entries.length, 1, 'una sola entrada, nunca dos, para el mismo chargeId');
});

test('no mezcla obligaciones de distintos alumnos', () => {
  const c1 = charge({ id: 'c-s1', studentId: 's1', dueDate: '2026-07-01' });
  const c2 = charge({ id: 'c-s2', studentId: 's2', dueDate: '2026-07-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c1, c2] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15' });
  assertEqual(entries.length, 2, 'dos entradas, una por alumno');
  assert(entries.some((e) => e.studentId === 's1'), 'incluye a s1');
  assert(entries.some((e) => e.studentId === 's2'), 'incluye a s2');
});

// ---------------------------------------------------------------------------
// Pagos retroactivos: recalculan correctamente
// ---------------------------------------------------------------------------

test('un pago retroactivo que salda la obligación la saca del centro de cobros', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const before: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  // Evaluado el 25/07 (last_late) antes de cargar el pago: aparece, vencida.
  const entriesBefore = buildCollectionsCenterEntries({ state: before, evaluationDate: '2026-07-30' });
  assertEqual(entriesBefore.length, 1, 'antes del pago retroactivo: aparece vencida');
  assertEqual(entriesBefore[0].urgency, 'vencido', 'urgencia genérica antes de pagar, sin recargos automáticos');

  // Se carga hoy (25/07) un pago retroactivo con fecha real 05/07 (en término, cubre el total sin recargo).
  const retroPayment = recordPayment({
    id: 'payment-retro',
    studentId: 's1',
    amount: 10000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-30T12:00:00.000Z',
    todayDateKey: '2026-07-30',
  });
  const withPayment: PaymentsRepositoryState = { ...before, payments: [retroPayment] };
  const retroAllocation = allocatePayment({
    id: 'alloc-retro',
    paymentId: 'payment-retro',
    chargeId: 'c-1',
    amount: 10000,
    state: withPayment,
  });
  const after: PaymentsRepositoryState = { ...withPayment, allocations: [retroAllocation] };

  const entriesAfter = buildCollectionsCenterEntries({ state: after, evaluationDate: '2026-07-30' });
  assertEqual(entriesAfter.length, 0, 'después del pago retroactivo: ya no necesita atención, se saldó en término');
});

// ---------------------------------------------------------------------------
// No mutación
// ---------------------------------------------------------------------------

test('no muta el estado financiero recibido', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const snapshot = JSON.stringify(state);
  buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15' });
  assertEqual(JSON.stringify(state), snapshot, 'el estado original no cambia');
});

// ---------------------------------------------------------------------------
// summarizeCollectionsUrgency — Fase Pagos 4C.3: conteos para el aviso
// diario, nunca nombres ni importes.
// ---------------------------------------------------------------------------

test('summarizeCollectionsUrgency: sin entradas, todo en cero y worstUrgencyRank null', () => {
  const summary = summarizeCollectionsUrgency([]);
  assertEqual(summary.dueToday, 0, 'sin vencen hoy');
  assertEqual(summary.firstLate, 0, 'sin primer vencimiento');
  assertEqual(summary.secondLate, 0, 'sin segundo vencimiento');
  assertEqual(summary.lastLate, 0, 'sin último vencimiento');
  assertEqual(summary.totalWithDebt, 0, 'sin deuda');
  assertEqual(summary.worstUrgencyRank, null, 'nada que evaluar');
});

test('summarizeCollectionsUrgency: cuenta cada etapa por separado y calcula el total con deuda', () => {
  const hoy = charge({ id: 'c-hoy', studentId: 's1', dueDate: '2026-07-20' });
  const primero = charge({ id: 'c-primero', studentId: 's2', dueDate: '2026-07-05' });
  const segundo = charge({ id: 'c-segundo', studentId: 's3', dueDate: '2026-06-25' });
  const ultimo = charge({ id: 'c-ultimo', studentId: 's4', dueDate: '2026-06-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [hoy, primero, segundo, ultimo] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-20' });

  const summary = summarizeCollectionsUrgency(entries);
  assertEqual(summary.dueToday, 1, 'una vence hoy');
  // Sin recargos automáticos, las 3 etapas de mora comparten la urgencia
  // genérica 'vencido' — que cae en el mismo balde que 'ultimo_vencimiento'
  // (ver comentario de `summarizeCollectionsUrgency`). `firstLate`/
  // `secondLate` quedan permanentemente en 0: esas urgencias específicas ya
  // no pueden ocurrir.
  assertEqual(summary.firstLate, 0, 'sin recargos automáticos, "primer vencimiento" específico nunca vuelve a ocurrir');
  assertEqual(summary.secondLate, 0, 'sin recargos automáticos, "segundo vencimiento" específico nunca vuelve a ocurrir');
  assertEqual(summary.lastLate, 3, 'las 3 obligaciones vencidas caen en el mismo balde genérico ("vencido" + "último vencimiento")');
  assertEqual(summary.totalWithDebt, 3, 'el total con deuda excluye "vence hoy": sólo las tres etapas de mora');
});

test('summarizeCollectionsUrgency: "vence hoy" sola (sin ninguna deuda vencida) reporta totalWithDebt en cero pero worstUrgencyRank no nulo', () => {
  const hoy = charge({ id: 'c-hoy', studentId: 's1', dueDate: '2026-07-20' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [hoy] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-20' });
  const summary = summarizeCollectionsUrgency(entries);
  assertEqual(summary.dueToday, 1, 'una vence hoy');
  assertEqual(summary.totalWithDebt, 0, 'nada vencido todavía');
  assertEqual(summary.worstUrgencyRank, URGENCY_RANK.vence_hoy, 'igual hay algo que reportar: vence hoy');
});

test('summarizeCollectionsUrgency: worstUrgencyRank es el rango más severo presente, sin importar el orden', () => {
  const primero = charge({ id: 'c-primero', studentId: 's1', dueDate: '2026-07-05' });
  const ultimo = charge({ id: 'c-ultimo', studentId: 's2', dueDate: '2026-06-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [primero, ultimo] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-20' });
  const summary = summarizeCollectionsUrgency(entries);
  assertEqual(summary.worstUrgencyRank, URGENCY_RANK.ultimo_vencimiento, 'el más severo de los dos');
});

test('summarizeCollectionsUrgency no muta el array de entradas recibido', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-20' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-20' });
  const snapshot = JSON.stringify(entries);
  summarizeCollectionsUrgency(entries);
  assertEqual(JSON.stringify(entries), snapshot, 'las entradas no cambian');
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, tercera ronda (a pedido de Joaquín — HACER
// CORREGIBLE EL PRORRATEO HISTÓRICO MARCADO PARA REVISIÓN): la tarjeta de
// Centro de cobros marca `needsFirstMonthProrationReview` reutilizando
// `findFirstMonthProrationReviewNeeds` — nunca una segunda lógica acá.
// ---------------------------------------------------------------------------

test('needsFirstMonthProrationReview: un cargo mensual sin ninguna decisión asociada nunca la marca', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-08-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-08-20', firstMonthProrationDecisions: [] });
  assertEqual(entries[0].needsFirstMonthProrationReview, false, 'sin decisión: nada que revisar');
});

test('needsFirstMonthProrationReview: una decisión de origen AMBIGUO (sin source, criterion proportional) marca la tarjeta', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-08-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const decision = firstMonthDecision({ id: 'd1', studentId: 's1', billingPeriod: '2026-08', chargeId: 'c-1' });
  const entries = buildCollectionsCenterEntries({
    state,
    evaluationDate: '2026-08-20',
    firstMonthProrationDecisions: [decision],
  });
  assertEqual(entries[0].needsFirstMonthProrationReview, true, 'origen ambiguo: se ofrece la acción');
});

test('needsFirstMonthProrationReview: una decisión MANUAL válida nunca muestra revisión innecesaria', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-08-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const decision = firstMonthDecision({ id: 'd1', studentId: 's1', billingPeriod: '2026-08', chargeId: 'c-1', source: 'manual' });
  const entries = buildCollectionsCenterEntries({
    state,
    evaluationDate: '2026-08-20',
    firstMonthProrationDecisions: [decision],
  });
  assertEqual(entries[0].needsFirstMonthProrationReview, false, 'ya confirmada a mano: nunca se vuelve a ofrecer');
});

test('needsFirstMonthProrationReview: una decisión AUTOMÁTICA válida nunca muestra revisión', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-08-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const decision = firstMonthDecision({ id: 'd1', studentId: 's1', billingPeriod: '2026-08', chargeId: 'c-1', source: 'automatic' });
  const entries = buildCollectionsCenterEntries({
    state,
    evaluationDate: '2026-08-20',
    firstMonthProrationDecisions: [decision],
  });
  assertEqual(entries[0].needsFirstMonthProrationReview, false, 'origen automático confirmado: nunca se ofrece revisión');
});

test('needsFirstMonthProrationReview: la acción aparece aunque el período no sea el mes vigente (cargo histórico y vencido)', () => {
  // Evaluado en octubre, pero la decisión ambigua es de agosto — vencido
  // hace rato en Centro de cobros, exactamente el caso real reportado.
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-08-17', originalAmount: 80000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const decision = firstMonthDecision({
    id: 'd1',
    studentId: 's1',
    billingPeriod: '2026-08',
    chargeId: 'c-1',
    permanentMonthlyAmount: 80000,
    chargedAmount: 80000,
  });
  const entries = buildCollectionsCenterEntries({
    state,
    evaluationDate: '2026-10-05', // muy después del período de la decisión
    firstMonthProrationDecisions: [decision],
  });
  assert(entries.length === 1, 'el cargo histórico sigue apareciendo, ya vencido');
  assertEqual(entries[0].urgency, 'vencido', 'urgencia genérica, hace tanto que venció, sin recargos automáticos');
  assertEqual(entries[0].needsFirstMonthProrationReview, true, 'la acción se ofrece igual, sin importar cuánto tiempo pasó');
});

test('needsFirstMonthProrationReview: una mensualidad histórica que NO es el primer mes (sin decisión propia) nunca muestra la acción', () => {
  // Setiembre: mensualidad normal del mismo alumno, sin ninguna decisión de
  // primer mes asociada — nunca debe heredar la marca de la de agosto.
  const august = charge({ id: 'c-aug', studentId: 's1', dueDate: '2026-08-01' });
  const september = charge({ id: 'c-sep', studentId: 's1', dueDate: '2026-09-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [august, september] };
  const decision = firstMonthDecision({ id: 'd1', studentId: 's1', billingPeriod: '2026-08', chargeId: 'c-aug' });
  const entries = buildCollectionsCenterEntries({
    state,
    evaluationDate: '2026-10-05',
    firstMonthProrationDecisions: [decision],
  });
  const septemberEntry = entries.find((entry) => entry.chargeId === 'c-sep');
  assert(!!septemberEntry, 'setiembre también requiere atención (vencido)');
  assertEqual(septemberEntry!.needsFirstMonthProrationReview, false, 'setiembre nunca es "primer mes": nunca muestra la acción');
});

test('needsFirstMonthProrationReview: Centro de cobros se actualiza inmediatamente al confirmar (la marca desaparece apenas la decisión pasa a manual)', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-08-01', originalAmount: 40000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const ambiguousDecision = firstMonthDecision({ id: 'd1', studentId: 's1', billingPeriod: '2026-08', chargeId: 'c-1' });

  const before = buildCollectionsCenterEntries({ state, evaluationDate: '2026-08-20', firstMonthProrationDecisions: [ambiguousDecision] });
  assertEqual(before[0].needsFirstMonthProrationReview, true, 'antes de confirmar: se ofrece la acción');

  // La profesora confirma en el panel — se agrega una decisión NUEVA con
  // source: 'manual' (la anterior nunca se edita ni se borra).
  const manualDecision = firstMonthDecision({
    id: 'd2',
    studentId: 's1',
    billingPeriod: '2026-08',
    chargeId: 'c-1',
    source: 'manual',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  });
  const after = buildCollectionsCenterEntries({
    state,
    evaluationDate: '2026-08-20',
    firstMonthProrationDecisions: [ambiguousDecision, manualDecision],
  });
  assertEqual(after[0].needsFirstMonthProrationReview, false, 'después de confirmar: la marca desaparece de inmediato');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
// CIRCUITO DE COBROS): un alumno que no está `'activo'` nunca aparece en el
// Centro de cobros, sin importar el saldo/etapa de su cargo — la deuda real
// no se toca (nunca se anula ni se borra acá), sólo deja de proyectarse como
// situación operativa vigente. Identidad ficticia: `qa-inactivo-*`.
// ---------------------------------------------------------------------------

test('alumno activo con mensualidad vencida: aparece normalmente en el Centro de cobros', () => {
  const c = charge({ id: 'c-activo', studentId: 'qa-inactivo-activo', dueDate: '2026-07-01', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const studentStatusById = new Map<string, 'activo'>([['qa-inactivo-activo', 'activo']]);

  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15', studentStatusById });
  assertEqual(entries.length, 1, 'alumno activo: aparece con normalidad');
  assertEqual(entries[0].urgency, 'vencido', 'urgencia genérica real, sin recargos automáticos');
});

test('alumno inactivo con mensualidad vencida: NUNCA aparece en el Centro de cobros', () => {
  const c = charge({ id: 'c-inactivo', studentId: 'qa-inactivo-1', dueDate: '2026-07-01', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const studentStatusById = new Map<string, 'inactivo'>([['qa-inactivo-1', 'inactivo']]);

  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15', studentStatusById });
  assertEqual(entries.length, 0, 'un alumno inactivo nunca aparece, sin importar la etapa de mora de su cargo');
});

test('alumno inactivo con deuda legítima anterior a la baja: sigue sin aparecer en el Centro de cobros (se conserva sólo en el historial)', () => {
  // El cargo es deuda REAL (la baja pudo ocurrir después de generarse) —
  // esta prueba demuestra que aun así nunca se muestra como cobro
  // operativo mientras el alumno está inactivo; el cargo en sí no se toca.
  const c = charge({ id: 'c-deuda-legitima', studentId: 'qa-inactivo-2', dueDate: '2026-06-01', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const studentStatusById = new Map<string, 'inactivo'>([['qa-inactivo-2', 'inactivo']]);

  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15', studentStatusById });
  assertEqual(entries.length, 0, 'deuda legítima previa: no es un cobro operativo mientras el alumno esté inactivo');
  assertEqual(state.charges[0].voidedAt, null, 'el cargo real nunca se anula ni se borra acá: sólo es una proyección de lectura');
});

test('alumno pausado y alumno archivado: mismo criterio que inactivo, nunca aparecen', () => {
  const paused = charge({ id: 'c-pausado', studentId: 'qa-inactivo-pausado', dueDate: '2026-07-01', originalAmount: 10000 });
  const archived = charge({ id: 'c-archivado', studentId: 'qa-inactivo-archivado', dueDate: '2026-07-01', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [paused, archived] };
  const studentStatusById = new Map<string, 'pausado' | 'archivado'>([
    ['qa-inactivo-pausado', 'pausado'],
    ['qa-inactivo-archivado', 'archivado'],
  ]);

  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15', studentStatusById });
  assertEqual(entries.length, 0, 'pausado y archivado se tratan igual que inactivo: nunca aparecen');
});

test('sin studentStatusById (llamador que todavía no lo provee): comportamiento previo sin cambios', () => {
  const c = charge({ id: 'c-sin-mapa', studentId: 'qa-inactivo-sin-mapa', dueDate: '2026-07-01', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };

  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-15' });
  assertEqual(entries.length, 1, 'sin mapa de estados, cualquier alumno se trata como activo (compatibilidad hacia atrás)');
});
