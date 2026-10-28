// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/collectionsCenterTrainingConcept.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS, punto 23 de la matriz pedida): Centro de cobros debe
 * mostrar el concepto correcto para una cuota de entrenamiento — nombre de
 * la serie + mes, origen 'entrenamiento' distinguible del de una
 * mensualidad de clases. Punto 24: una mensualidad de clases normal, ya
 * cubierta por `collectionsCenter.test.ts`, no cambia su comportamiento por
 * la sola existencia de este nuevo tipo (se confirma acá que ambas conviven
 * sin interferir en la misma corrida).
 */
import type { PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { buildCollectionsCenterEntries } from '../collectionsCenter.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(charges: PaymentCharge[]): PaymentsRepositoryState {
  return { charges, payments: [], allocations: [], adjustments: [] };
}

test('23a) Centro de cobros: una cuota de entrenamiento vencida muestra el nombre de la serie + el mes como concepto, tipo "entrenamiento"', () => {
  const charge: PaymentCharge = {
    id: 'charge_entrenamiento_qa_agreement_1_qa_alumno_1_2026-07',
    studentId: 'qa_alumno_1',
    type: 'entrenamiento',
    originalAmount: 15000,
    currency: 'ARS',
    dueDate: '2026-07-10',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    trainingBillingAgreementId: 'qa_agreement_1',
    trainingSeriesName: 'Entrenamiento funcional',
    voidedAt: null,
    voidReason: null,
  };
  const entries = buildCollectionsCenterEntries({ state: emptyState([charge]), evaluationDate: '2026-08-20' });
  assertEqual(entries.length, 1, 'una tarjeta real');
  assertEqual(entries[0].chargeType, 'entrenamiento', 'tipo/origen correcto');
  assert(entries[0].concept.includes('Entrenamiento funcional'), 'incluye el nombre real de la serie');
  assert(entries[0].concept.includes('julio'), 'incluye el mes real del cargo');
  assert(!entries[0].concept.startsWith('Clase del'), 'nunca el texto genérico de clase suelta — se distingue de un vistazo');
  assert(!entries[0].concept.startsWith('Mensualidad de'), 'nunca el texto de mensualidad de clases — conceptos distintos, nunca fusionados');
});

test('23b) Sin nombre de serie congelado (dato legado hipotético), usa "Entrenamiento" como respaldo — nunca revienta ni queda vacío', () => {
  const charge: PaymentCharge = {
    id: 'charge_entrenamiento_qa_agreement_1_qa_alumno_1_2026-07',
    studentId: 'qa_alumno_1',
    type: 'entrenamiento',
    originalAmount: 15000,
    currency: 'ARS',
    dueDate: '2026-07-10',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    trainingBillingAgreementId: 'qa_agreement_1',
    voidedAt: null,
    voidReason: null,
  };
  const entries = buildCollectionsCenterEntries({ state: emptyState([charge]), evaluationDate: '2026-08-20' });
  assert(entries[0].concept.includes('Entrenamiento'), 'respaldo genérico "Entrenamiento" nunca deja el concepto vacío');
});

test('24) Una mensualidad de clases normal convive con una cuota de entrenamiento en la misma corrida, cada una con su propio concepto — el comportamiento de la mensualidad no cambia', () => {
  const monthlyCharge: PaymentCharge = {
    id: 'charge_mensual_qa_alumno_1_2026-07',
    studentId: 'qa_alumno_1',
    type: 'mensual',
    originalAmount: 30000,
    currency: 'ARS',
    dueDate: '2026-07-10',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
  };
  const trainingCharge: PaymentCharge = {
    id: 'charge_entrenamiento_qa_agreement_1_qa_alumno_1_2026-07',
    studentId: 'qa_alumno_1',
    type: 'entrenamiento',
    originalAmount: 15000,
    currency: 'ARS',
    dueDate: '2026-07-10',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    trainingBillingAgreementId: 'qa_agreement_1',
    trainingSeriesName: 'Entrenamiento',
    voidedAt: null,
    voidReason: null,
  };
  const entries = buildCollectionsCenterEntries({ state: emptyState([monthlyCharge, trainingCharge]), evaluationDate: '2026-08-20' });
  assertEqual(entries.length, 2, 'dos tarjetas reales, una por cada obligación — nunca fusionadas en una sola');
  const monthlyEntry = entries.find((entry) => entry.chargeType === 'mensual');
  const trainingEntry = entries.find((entry) => entry.chargeType === 'entrenamiento');
  assert(monthlyEntry !== undefined, 'la mensualidad de clases sigue apareciendo igual que siempre');
  assert(trainingEntry !== undefined, 'la cuota de entrenamiento aparece aparte');
  assert(monthlyEntry!.concept.startsWith('Mensualidad de'), 'la mensualidad conserva exactamente su concepto de siempre, sin cambios');
});
