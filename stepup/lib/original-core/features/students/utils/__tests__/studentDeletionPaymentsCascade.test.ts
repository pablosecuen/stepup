// Puerto VERBATIM del original (`src/features/students/utils/__tests__/studentDeletionPaymentsCascade.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { NewClassFormState, SavedLesson } from '../../../new-class/types/index.ts';
import type {
  Payment,
  PaymentAdjustment,
  PaymentAllocation,
  PaymentCharge,
  PaymentsRepositoryState,
} from '../../../payments/types/index.ts';
import { emptyPaymentsState } from '../../../payments/hooks/paymentsStore.ts';
import { analyzeDataIntegrity } from '../../../../shared/backup/dataIntegrity.ts';
import type { StudentProfile } from '../../../student-profile/types/index.ts';
import type { StudentListItem } from '../../types/index.ts';
import { buildStudentDeletionCascade, type StudentDeletionSnapshots } from '../studentDeletionCascade.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function student(id: string): StudentListItem {
  return {
    id,
    name: `Alumno ${id}`,
    levels: ['B1'],
    modality: 'presencial',
    status: 'activo',
    nextClassAt: null,
    paymentStatus: 'verde',
    averageGrade: 8,
    classesThisMonth: 1,
    lastPaymentAt: null,
    isFeatured: false,
    isNew: false,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: false,
  };
}

function profile(id: string): StudentProfile {
  return { id } as StudentProfile;
}

function charge(overrides: Partial<PaymentCharge> & { id: string; studentId: string }): PaymentCharge {
  return {
    type: 'mensual',
    originalAmount: 10000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> & { id: string; studentId: string }): Payment {
  return {
    amount: 10000,
    currency: 'ARS',
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T12:00:00.000Z',
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

function adjustment(
  overrides: Partial<PaymentAdjustment> & { id: string; chargeId: string; studentId: string }
): PaymentAdjustment {
  return {
    reason: 'motivo de prueba',
    createdAt: '2026-07-05T00:00:00.000Z',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function baseForm(studentIds: string[]): NewClassFormState {
  return {
    eventType: 'clase_dictada',
    studentIds,
    date: '2026-07-11',
    time: '10:00',
    scheduledDurationMinutes: 60,
    actualDurationMinutes: 60,
    modality: 'presencial',
    attendance: [],
    topics: [],
    objectives: [],
    activities: [],
    activityNotes: '',
    activityAttachments: [],
    materialIds: [],
    evaluations: [],
    internalNotes: '',
    homeworkDescription: '',
    homeworkDueDate: null,
    isBillable: true,
    lateCancellationPolicy: null,
    lateCancellationPercentage: null,
    consumesMonthlyPackage: true,
    holidayException: false,
    rescheduledFromLessonId: null,
  };
}

function savedLesson(overrides: Partial<SavedLesson> & { id: string; form: NewClassFormState }): SavedLesson {
  return {
    createdAt: '2026-07-11T12:00:00.000Z',
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    ...overrides,
  };
}

function baseSnapshots(overrides: Partial<StudentDeletionSnapshots> = {}): StudentDeletionSnapshots {
  return {
    students: [],
    profiles: {},
    savedLessons: [],
    calendarLessons: [],
    recurrenceRules: [],
    recurrenceExceptions: [],
    payments: emptyPaymentsState(),
    reportHistory: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Eliminación individual con pagos
// ---------------------------------------------------------------------------

test('eliminación individual: quita las obligaciones, pagos, asignaciones y condonaciones del alumno', () => {
  const source = baseSnapshots({
    students: [student('delete-me')],
    profiles: { 'delete-me': profile('delete-me') },
    payments: {
      charges: [charge({ id: 'charge-1', studentId: 'delete-me' })],
      payments: [payment({ id: 'payment-1', studentId: 'delete-me' })],
      allocations: [allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', studentId: 'delete-me' })],
      adjustments: [adjustment({ id: 'adj-1', chargeId: 'charge-1', studentId: 'delete-me' })],
    },
  });

  const result = buildStudentDeletionCascade('delete-me', source);

  assertEqual(result.payments.charges.length, 0, 'sin obligaciones');
  assertEqual(result.payments.payments.length, 0, 'sin pagos');
  assertEqual(result.payments.allocations.length, 0, 'sin asignaciones');
  assertEqual(result.payments.adjustments.length, 0, 'sin condonaciones');
  assert(!JSON.stringify(result.payments).includes('delete-me'), 'no queda ninguna referencia al alumno eliminado');
});

// ---------------------------------------------------------------------------
// Clase grupal: conserva intactos los registros financieros del otro alumno
// ---------------------------------------------------------------------------

test('clase grupal: los pagos y obligaciones del alumno que se conserva quedan intactos', () => {
  const source = baseSnapshots({
    students: [student('delete-me'), student('keep-me')],
    profiles: { 'delete-me': profile('delete-me'), 'keep-me': profile('keep-me') },
    payments: {
      charges: [
        charge({ id: 'charge-delete', studentId: 'delete-me' }),
        charge({ id: 'charge-keep', studentId: 'keep-me' }),
      ],
      payments: [
        payment({ id: 'payment-delete', studentId: 'delete-me' }),
        payment({ id: 'payment-keep', studentId: 'keep-me' }),
      ],
      allocations: [
        allocation({ id: 'alloc-delete', paymentId: 'payment-delete', chargeId: 'charge-delete', studentId: 'delete-me' }),
        allocation({ id: 'alloc-keep', paymentId: 'payment-keep', chargeId: 'charge-keep', studentId: 'keep-me' }),
      ],
      adjustments: [adjustment({ id: 'adj-keep', chargeId: 'charge-keep', studentId: 'keep-me' })],
    },
  });

  const result = buildStudentDeletionCascade('delete-me', source);

  assertEqual(result.payments.charges.length, 1, 'sólo queda la obligación de keep-me');
  assertEqual(result.payments.charges[0].id, 'charge-keep', 'es la de keep-me');
  assertEqual(result.payments.payments.length, 1, 'sólo queda el pago de keep-me');
  assertEqual(result.payments.payments[0].id, 'payment-keep', 'es el de keep-me');
  assertEqual(result.payments.allocations.length, 1, 'sólo queda la asignación de keep-me');
  assertEqual(result.payments.adjustments.length, 1, 'la condonación de keep-me sigue intacta');
});

// ---------------------------------------------------------------------------
// Asignaciones y ajustes relacionados por cargo/pago, no sólo por studentId
// ---------------------------------------------------------------------------

test('quita asignaciones y condonaciones relacionadas con el cargo o el pago eliminados, aunque su propio studentId esté mal cargado', () => {
  const source = baseSnapshots({
    students: [student('delete-me'), student('keep-me')],
    profiles: { 'delete-me': profile('delete-me'), 'keep-me': profile('keep-me') },
    payments: {
      charges: [charge({ id: 'charge-delete', studentId: 'delete-me' })],
      payments: [payment({ id: 'payment-delete', studentId: 'delete-me' })],
      // Referencian el cargo/pago del alumno eliminado, aunque (por un
      // dato mal cargado) digan pertenecer a keep-me: igual deben quitarse,
      // porque el "relacionado" se evalúa por chargeId/paymentId, no sólo
      // por el campo studentId de la propia asignación/condonación.
      allocations: [
        allocation({ id: 'alloc-1', paymentId: 'payment-delete', chargeId: 'charge-delete', studentId: 'keep-me' }),
      ],
      adjustments: [adjustment({ id: 'adj-1', chargeId: 'charge-delete', studentId: 'keep-me' })],
    },
  });

  const result = buildStudentDeletionCascade('delete-me', source);

  assertEqual(result.payments.allocations.length, 0, 'la asignación relacionada con el cargo eliminado se quita igual');
  assertEqual(result.payments.adjustments.length, 0, 'la condonación relacionada con el cargo eliminado se quita igual');
});

// ---------------------------------------------------------------------------
// billedAmountByStudent limpio y billedAmount recalculado
// ---------------------------------------------------------------------------

test('clase pedagógica grupal sobreviviente: se quita la clave del alumno eliminado de billedAmountByStudent', () => {
  const source = baseSnapshots({
    students: [student('delete-me'), student('keep-me')],
    profiles: { 'delete-me': profile('delete-me'), 'keep-me': profile('keep-me') },
    savedLessons: [
      savedLesson({
        id: 'lesson-group',
        form: baseForm(['delete-me', 'keep-me']),
        billedAmount: 19000,
        billedAmountByStudent: { 'delete-me': 9500, 'keep-me': 9500 },
      }),
    ],
  });

  const result = buildStudentDeletionCascade('delete-me', source);
  const survivingLesson = result.savedLessons.find((lesson) => lesson.id === 'lesson-group')!;

  assert(survivingLesson.billedAmountByStudent !== undefined, 'conserva el desglose');
  assertEqual(
    survivingLesson.billedAmountByStudent!['delete-me'],
    undefined,
    'la clave del alumno eliminado ya no existe'
  );
  assertEqual(survivingLesson.billedAmountByStudent!['keep-me'], 9500, 'la clave de keep-me se conserva intacta');
});

test('billedAmount se recalcula como la suma de los alumnos restantes cuando existe desglose', () => {
  const source = baseSnapshots({
    students: [student('delete-me'), student('keep-me'), student('keep-me-2')],
    profiles: {
      'delete-me': profile('delete-me'),
      'keep-me': profile('keep-me'),
      'keep-me-2': profile('keep-me-2'),
    },
    savedLessons: [
      savedLesson({
        id: 'lesson-group',
        form: baseForm(['delete-me', 'keep-me', 'keep-me-2']),
        billedAmount: 28500,
        billedAmountByStudent: { 'delete-me': 9500, 'keep-me': 9500, 'keep-me-2': 9500 },
      }),
    ],
  });

  const result = buildStudentDeletionCascade('delete-me', source);
  const survivingLesson = result.savedLessons.find((lesson) => lesson.id === 'lesson-group')!;

  assertEqual(survivingLesson.billedAmount, 19000, 'suma exacta de los dos alumnos restantes (9500 + 9500)');
});

test('registro grupal antiguo sin desglose: billedAmount se mantiene en null, nunca se inventa una cifra', () => {
  const source = baseSnapshots({
    students: [student('delete-me'), student('keep-me')],
    profiles: { 'delete-me': profile('delete-me'), 'keep-me': profile('keep-me') },
    savedLessons: [
      savedLesson({
        id: 'lesson-legacy-group',
        form: baseForm(['delete-me', 'keep-me']),
        billedAmount: 19000, // total viejo, sin desglose por alumno
      }),
    ],
  });

  const result = buildStudentDeletionCascade('delete-me', source);
  const survivingLesson = result.savedLessons.find((lesson) => lesson.id === 'lesson-legacy-group')!;

  assertEqual(survivingLesson.billedAmount, null, 'sin desglose, no se puede recalcular con seguridad: queda en null');
  assertEqual(survivingLesson.billedAmountByStudent, undefined, 'sigue sin desglose');
});

// ---------------------------------------------------------------------------
// Análisis de integridad posterior: sin huérfanos del alumno eliminado
// ---------------------------------------------------------------------------

test('después de eliminar, el análisis de integridad no reporta ningún huérfano del alumno eliminado', () => {
  const source = baseSnapshots({
    students: [student('delete-me'), student('keep-me')],
    profiles: { 'delete-me': profile('delete-me'), 'keep-me': profile('keep-me') },
    payments: {
      charges: [
        charge({ id: 'charge-delete', studentId: 'delete-me' }),
        charge({ id: 'charge-keep', studentId: 'keep-me' }),
      ],
      payments: [
        payment({ id: 'payment-delete', studentId: 'delete-me' }),
        payment({ id: 'payment-keep', studentId: 'keep-me' }),
      ],
      allocations: [
        allocation({ id: 'alloc-delete', paymentId: 'payment-delete', chargeId: 'charge-delete', studentId: 'delete-me' }),
        allocation({ id: 'alloc-keep', paymentId: 'payment-keep', chargeId: 'charge-keep', studentId: 'keep-me' }),
      ],
      adjustments: [adjustment({ id: 'adj-delete', chargeId: 'charge-delete', studentId: 'delete-me' })],
    },
  });

  const result = buildStudentDeletionCascade('delete-me', source);

  const report = analyzeDataIntegrity({
    students: result.students,
    profiles: result.profiles,
    pedagogicalLessons: result.savedLessons,
    calendarLessons: result.calendarLessons,
    recurrenceRules: result.recurrenceRules,
    recurrenceExceptions: result.recurrenceExceptions,
    paymentCharges: result.payments.charges,
    payments: result.payments.payments,
    paymentAllocations: result.payments.allocations,
    paymentAdjustments: result.payments.adjustments,
  });

  assertEqual(report.totalIssues, 0, 'ninguna referencia rota: todo lo del alumno eliminado se quitó en conjunto');
});

// ---------------------------------------------------------------------------
// Fallo de persistencia: no deja cambios parciales en memoria
// ---------------------------------------------------------------------------

asyncTest(
  'si la persistencia combinada falla, ningún store en memoria se actualiza (ni el financiero ni el resto)',
  async () => {
    // Reproduce el mismo orden que usa `studentDeletionService.ts`: calcular
    // la cascada (pura) y recién DESPUÉS de que la escritura combinada
    // tenga éxito, reemplazar cada store en memoria. Con adaptadores falsos
    // acá, sin AsyncStorage real (que no funciona fuera de un runtime de
    // React Native).
    const source = baseSnapshots({
      students: [student('delete-me')],
      profiles: { 'delete-me': profile('delete-me') },
      payments: {
        charges: [charge({ id: 'charge-1', studentId: 'delete-me' })],
        payments: [],
        allocations: [],
        adjustments: [],
      },
    });

    const memory = {
      students: source.students,
      profiles: source.profiles,
      payments: source.payments,
      replaceCallCount: 0,
    };

    const next = buildStudentDeletionCascade('delete-me', source);

    async function persistCombined(): Promise<void> {
      throw new Error('fallo simulado de escritura combinada');
    }

    let rejected = false;
    try {
      await persistCombined();
      // Sólo si la escritura tuvo éxito se replican los stores en memoria —
      // exactamente el mismo orden que sigue el servicio real.
      memory.students = next.students;
      memory.profiles = next.profiles;
      memory.payments = next.payments;
      memory.replaceCallCount += 1;
    } catch {
      rejected = true;
    }

    assert(rejected, 'la escritura combinada falla');
    assertEqual(memory.replaceCallCount, 0, 'ningún store en memoria llegó a reemplazarse');
    assertEqual(memory.students.length, 1, 'el alumno sigue en memoria, sin eliminar a medias');
    assertEqual(memory.payments.charges.length, 1, 'el cargo financiero sigue en memoria, sin eliminar a medias');
  }
);

// ---------------------------------------------------------------------------
// No mutación de entradas
// ---------------------------------------------------------------------------

test('no muta el estado financiero de entrada', () => {
  const source = baseSnapshots({
    students: [student('delete-me')],
    profiles: { 'delete-me': profile('delete-me') },
    payments: {
      charges: [charge({ id: 'charge-1', studentId: 'delete-me' })],
      payments: [payment({ id: 'payment-1', studentId: 'delete-me' })],
      allocations: [allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', studentId: 'delete-me' })],
      adjustments: [],
    },
  });
  const snapshot = JSON.stringify(source.payments);
  buildStudentDeletionCascade('delete-me', source);
  assertEqual(JSON.stringify(source.payments), snapshot, 'el estado financiero de entrada no cambia');
});
