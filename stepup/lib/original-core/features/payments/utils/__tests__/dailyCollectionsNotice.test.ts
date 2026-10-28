// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/dailyCollectionsNotice.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { buildCollectionsCenterEntries, summarizeCollectionsUrgency, URGENCY_RANK } from '../collectionsCenter.ts';
import { buildDismissedNoticeState, shouldShowDailyCollectionsNotice, type DailyCollectionsNoticeState } from '../dailyCollectionsNotice.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../paymentDates.ts';
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

/** Atajo: de un estado financiero al veredicto de "¿se muestra el aviso hoy?", pasando por el pipeline completo. */
function shouldShowFor(state: PaymentsRepositoryState, evaluationDate: string, persisted: DailyCollectionsNoticeState | null) {
  const entries = buildCollectionsCenterEntries({ state, evaluationDate });
  const summary = summarizeCollectionsUrgency(entries);
  return shouldShowDailyCollectionsNotice({ today: evaluationDate, worstUrgencyRank: summary.worstUrgencyRank, persisted });
}

// ---------------------------------------------------------------------------
// Primera apertura del día
// ---------------------------------------------------------------------------

test('primera apertura del día: sin estado persistido, con deuda pendiente, se muestra', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  assert(shouldShowFor(state, '2026-07-20', null), 'primera vez: se muestra');
});

test('sin ninguna obligación pendiente: nunca se muestra, incluso sin estado persistido', () => {
  assert(!shouldShowFor(emptyState(), '2026-07-20', null), 'nada pendiente: no hay nada que avisar');
});

// ---------------------------------------------------------------------------
// Descarte durante el mismo día
// ---------------------------------------------------------------------------

test('descartado hoy: no se vuelve a mostrar el mismo día si la situación no empeoró', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-20' });
  const summary = summarizeCollectionsUrgency(entries);
  const persisted = buildDismissedNoticeState({ today: '2026-07-20', worstUrgencyRank: summary.worstUrgencyRank! });

  assert(!shouldShowFor(state, '2026-07-20', persisted), 'descartado hoy, sin cambios: se mantiene oculto');
});

// ---------------------------------------------------------------------------
// Reaparición al día siguiente
// ---------------------------------------------------------------------------

test('reaparece al día siguiente aunque se haya descartado ayer con la misma situación', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const persisted = buildDismissedNoticeState({ today: '2026-07-20', worstUrgencyRank: URGENCY_RANK.segundo_vencimiento });

  assert(shouldShowFor(state, '2026-07-21', persisted), 'un día distinto: vuelve a mostrarse');
});

// ---------------------------------------------------------------------------
// Aumento de urgencia el mismo día
// ---------------------------------------------------------------------------

test('reaparece el mismo día si la situación empeora (nueva obligación en una etapa más grave)', () => {
  // Al descartar, sólo había una obligación en primer vencimiento.
  const persisted = buildDismissedNoticeState({ today: '2026-07-20', worstUrgencyRank: URGENCY_RANK.primer_vencimiento });

  // Después, ese mismo día, aparece una obligación en último vencimiento (más grave).
  const peor = charge({ id: 'c-peor', studentId: 's2', dueDate: '2026-06-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [peor] };

  assert(shouldShowFor(state, '2026-07-20', persisted), 'empeoró: reaparece aunque sea el mismo día');
});

test('NO reaparece el mismo día si sólo aumenta la cantidad, sin empeorar la urgencia', () => {
  // Sin recargos automáticos, cualquier mora real cae en la urgencia
  // genérica 'vencido' (mismo rango que 'ultimo_vencimiento') — la línea de
  // base persistida debe reflejar eso para que "misma urgencia, más
  // cantidad" siga siendo una comparación real.
  const persisted = buildDismissedNoticeState({ today: '2026-07-20', worstUrgencyRank: URGENCY_RANK.vencido });

  // Dos obligaciones más en la MISMA urgencia genérica — no es "más urgente", es "más de lo mismo".
  const a = charge({ id: 'c-a', studentId: 's1', dueDate: '2026-07-05' });
  const b = charge({ id: 'c-b', studentId: 's2', dueDate: '2026-07-05' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [a, b] };

  assert(!shouldShowFor(state, '2026-07-20', persisted), 'misma urgencia, más cantidad: sigue oculto');
});

// ---------------------------------------------------------------------------
// Un pago que resuelve toda la deuda: se oculta de inmediato
// ---------------------------------------------------------------------------

test('un pago que salda todas las obligaciones oculta el aviso de inmediato, incluso sin haberlo descartado', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const p = payment({ id: 'payment-1', studentId: 's1', amount: 12000, paidAt: '2026-07-20' }); // cubre el total con recargo
  const a = allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'c-1', studentId: 's1', amount: 12000 });

  const before: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  assert(shouldShowFor(before, '2026-07-20', null), 'antes de pagar: se muestra');

  const after: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };
  assert(!shouldShowFor(after, '2026-07-20', null), 'después de saldar todo: se oculta de inmediato');
});

// ---------------------------------------------------------------------------
// Pagos parciales
// ---------------------------------------------------------------------------

test('un pago parcial no oculta el aviso: sigue habiendo saldo pendiente', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const p = payment({ id: 'payment-1', studentId: 's1', amount: 4000, paidAt: '2026-07-05' });
  const a = allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'c-1', studentId: 's1', amount: 4000 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };

  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-20' });
  assertEqual(entries.length, 1, 'sigue pendiente');
  assertEqual(entries[0].hasPartialPayment, true, 'con pago parcial');
  assert(shouldShowFor(state, '2026-07-20', null), 'el aviso se muestra igual: queda saldo');
});

// ---------------------------------------------------------------------------
// Anulaciones
// ---------------------------------------------------------------------------

test('un cargo anulado no genera aviso', () => {
  const c = charge({
    id: 'c-1',
    studentId: 's1',
    dueDate: '2026-07-01',
    voidedAt: '2026-07-02T00:00:00.000Z',
    voidReason: 'clase cancelada',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  assert(!shouldShowFor(state, '2026-07-20', null), 'sin cargos vigentes: sin aviso');
});

test('un pago anulado no cuenta como saldado: el aviso se sigue mostrando', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 });
  const p = payment({
    id: 'payment-1',
    studentId: 's1',
    amount: 12000,
    paidAt: '2026-07-20',
    voidedAt: '2026-07-21T00:00:00.000Z',
    voidReason: 'error de carga',
  });
  const a = allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'c-1', studentId: 's1', amount: 12000 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };
  assert(shouldShowFor(state, '2026-07-20', null), 'el pago anulado no salda nada: sigue pendiente');
});

// ---------------------------------------------------------------------------
// Zona horaria de Buenos Aires
// ---------------------------------------------------------------------------

test('usa la fecha de Buenos Aires, no la fecha UTC cruda, para decidir si sigue siendo "hoy"', () => {
  // 02:59 UTC del 14/07 todavía es 13/07 en Buenos Aires (UTC-3).
  const stillJuly13 = localDateKeyInTimeZone(new Date('2026-07-14T02:59:00.000Z'), ARGENTINA_TIME_ZONE);
  // 03:00 UTC del 14/07 ya es 14/07 en Buenos Aires.
  const alreadyJuly14 = localDateKeyInTimeZone(new Date('2026-07-14T03:00:00.000Z'), ARGENTINA_TIME_ZONE);
  assertEqual(stillJuly13, '2026-07-13', 'todavía 13/07 en AR');
  assertEqual(alreadyJuly14, '2026-07-14', 'ya 14/07 en AR');

  const persisted = buildDismissedNoticeState({ today: stillJuly13, worstUrgencyRank: URGENCY_RANK.primer_vencimiento });
  // Mismo "worstUrgencyRank", pero el date key de Buenos Aires ya cambió de día.
  assert(
    shouldShowDailyCollectionsNotice({ today: alreadyJuly14, worstUrgencyRank: URGENCY_RANK.primer_vencimiento, persisted }),
    'aunque falten pocos minutos en UTC, en Buenos Aires ya es "otro día": reaparece'
  );
  assert(
    !shouldShowDailyCollectionsNotice({ today: stillJuly13, worstUrgencyRank: URGENCY_RANK.primer_vencimiento, persisted }),
    'mismo día calendario de Buenos Aires: se mantiene oculto'
  );
});

// ---------------------------------------------------------------------------
// Ausencia de duplicados
// ---------------------------------------------------------------------------

test('el resumen no duplica: la suma de las cuatro categorías coincide con la cantidad de entradas del centro de cobros', () => {
  const a = charge({ id: 'c-a', studentId: 's1', dueDate: '2026-07-20' });
  const b = charge({ id: 'c-b', studentId: 's2', dueDate: '2026-07-05' });
  const c = charge({ id: 'c-c', studentId: 's3', dueDate: '2026-06-25' });
  const d = charge({ id: 'c-d', studentId: 's4', dueDate: '2026-06-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [a, b, c, d] };
  const entries = buildCollectionsCenterEntries({ state, evaluationDate: '2026-07-20' });
  const summary = summarizeCollectionsUrgency(entries);
  const sum = summary.dueToday + summary.firstLate + summary.secondLate + summary.lastLate;
  assertEqual(sum, entries.length, 'la suma de las categorías es exactamente la cantidad de entradas, sin duplicar ni perder ninguna');
});

// ---------------------------------------------------------------------------
// No mutación
// ---------------------------------------------------------------------------

test('shouldShowDailyCollectionsNotice no muta el estado persistido recibido', () => {
  const persisted = buildDismissedNoticeState({ today: '2026-07-20', worstUrgencyRank: URGENCY_RANK.primer_vencimiento });
  const snapshot = JSON.stringify(persisted);
  shouldShowDailyCollectionsNotice({ today: '2026-07-20', worstUrgencyRank: URGENCY_RANK.ultimo_vencimiento, persisted });
  assertEqual(JSON.stringify(persisted), snapshot, 'el estado persistido de entrada no cambia');
});
