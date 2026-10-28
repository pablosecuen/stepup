// Puerto VERBATIM del original (`src/features/dashboard/utils/__tests__/programmedHourlyRateSummary.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-10 (a pedido de Joaquín — CORRECCIÓN DE DEFINICIONES:
 * RESUMEN FINANCIERO Y VALOR HORA): pruebas del nuevo motor
 * `buildProgrammedHourlyRateSummary`. El foco central (§12 del pedido) es
 * demostrar que el valor programado de la hora NUNCA cambia según el
 * estado de los pagos, y SÍ usa el calendario completo (registradas +
 * futuras + todavía sin registrar). Identidad ficticia aislada:
 * `qa_valorhora_*`. Nunca usa datos reales.
 */
import type { CalendarLesson, CalendarLessonParticipant } from '../../../calendar/types/index.ts';
import type { AvailabilityException } from '../../../calendar/types/teacherAvailability.ts';
import type { NewClassFormState, SavedLesson } from '../../../new-class/types/index.ts';
import type { StudentBillingPlan } from '../../../student-profile/types/index.ts';
import type { PaymentCharge, PaymentsRepositoryState } from '../../../payments/types/index.ts';
import { buildProgrammedHourlyRateSummary, type HourlyRateStudentInfo } from '../programmedHourlyRateSummary.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyPaymentsState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function participant(studentId: string, level = 'B1'): CalendarLessonParticipant {
  return { studentId, studentName: `Alumno ${studentId}`, level };
}

function makeLesson(overrides: {
  id: string;
  participants: CalendarLessonParticipant[];
  start: string; // ISO
  end: string; // ISO
  status?: CalendarLesson['status'];
}): CalendarLesson {
  return {
    id: overrides.id,
    studentId: overrides.participants[0]?.studentId ?? '',
    studentName: overrides.participants[0]?.studentName ?? '',
    level: overrides.participants[0]?.level ?? '',
    participants: overrides.participants,
    lessonType: overrides.participants.length > 1 ? 'group' : 'individual',
    start: overrides.start,
    end: overrides.end,
    modality: 'online',
    status: overrides.status ?? 'scheduled',
    color: '#000000',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
  };
}

function baseForm(overrides: Partial<NewClassFormState> & { studentIds: string[]; date: string; scheduledDurationMinutes: number }): NewClassFormState {
  return {
    eventType: 'clase_dictada',
    time: '10:00',
    actualDurationMinutes: null,
    modality: 'online',
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
    consumesMonthlyPackage: false,
    holidayException: false,
    rescheduledFromLessonId: null,
    ...overrides,
  };
}

function makeSavedLesson(overrides: {
  id: string;
  calendarReservationKey: string;
  form: NewClassFormState;
  billedAmount?: number | null;
  billedAmountByStudent?: Record<string, number>;
}): SavedLesson {
  return {
    id: overrides.id,
    createdAt: `${overrides.form.date}T09:00:00.000Z`,
    form: overrides.form,
    countsAsClass: overrides.form.eventType === 'clase_dictada',
    billedAmount: overrides.billedAmount ?? null,
    billedAmountByStudent: overrides.billedAmountByStudent,
    appliedPolicy: overrides.form.lateCancellationPolicy,
    calendarReservationKey: overrides.calendarReservationKey,
  };
}

function reservationKeyFor(lesson: CalendarLesson): string {
  return `lesson:${lesson.id}`;
}

const NOW_AUGUST = '2026-08-20T15:00:00.000Z'; // día 20 de agosto: el mes todavía no cerró.

function monthlyPlan(amount: number): StudentBillingPlan {
  return { type: 'monthly', amount, dueDay: 1 };
}
function perClassPlan(amount: number): StudentBillingPlan {
  return { type: 'per_class', amount };
}
function packagePlan(amount: number, includedClasses: number): StudentBillingPlan {
  return { type: 'class_package', amount, includedClasses, validFrom: '2026-01-01' };
}

function baseInput(overrides: {
  lessons: CalendarLesson[];
  savedLessons?: SavedLesson[];
  students: HourlyRateStudentInfo[];
  charges?: PaymentCharge[];
  availabilityExceptions?: AvailabilityException[];
  now?: string;
}) {
  const state: PaymentsRepositoryState = { ...emptyPaymentsState(), charges: overrides.charges ?? [] };
  return {
    lessons: overrides.lessons,
    savedLessons: overrides.savedLessons ?? [],
    paymentsState: state,
    students: overrides.students,
    availabilityExceptions: overrides.availabilityExceptions ?? [],
    rangeStart: '2026-08-01',
    rangeEnd: '2026-08-31',
    evaluationDate: '2026-08-05',
  };
}

// ---------------------------------------------------------------------------
// 1. Alumno mensual: reparto proporcional por duración entre sus clases del mes.
// ---------------------------------------------------------------------------
test('alumno mensual: cuota $120.000 con 4 clases de 60 minutos -> $30.000 por clase y por hora', () => {
  const studentId = 'qa_valorhora_mensual_1';
  const lessons: CalendarLesson[] = [1, 2, 3, 4].map((n) =>
    makeLesson({
      id: `l${n}`,
      participants: [participant(studentId)],
      start: `2026-08-0${n}T10:00:00.000Z`,
      end: `2026-08-0${n}T11:00:00.000Z`,
    })
  );
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: monthlyPlan(120000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students }));

  assertEqual(summary.totalRevenueAttributed, 120000, 'la cuota completa se reparte, nunca se multiplica ni se pierde');
  assertEqual(summary.totalProgrammedHours, 4, '4 horas programadas');
  assertEqual(summary.generalRatePerHour, 30000, '$120.000 / 4h = $30.000/h');
  assertEqual(summary.lessonCount, 4, 'cuatro ocurrencias, ninguna registrada todavía');
  assertEqual(summary.unregisteredCount, 4, 'ninguna de las 4 tiene SavedLesson: son proyección');
});

test('alumno mensual: clase de 90 minutos se distribuye proporcional a duración, no por cantidad de clases', () => {
  const studentId = 'qa_valorhora_mensual_2';
  const lessons: CalendarLesson[] = [
    makeLesson({ id: 'l1', participants: [participant(studentId)], start: '2026-08-01T10:00:00.000Z', end: '2026-08-01T11:00:00.000Z' }), // 60min
    makeLesson({ id: 'l2', participants: [participant(studentId)], start: '2026-08-08T10:00:00.000Z', end: '2026-08-08T11:30:00.000Z' }), // 90min
  ];
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: monthlyPlan(150000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students }));

  assertEqual(summary.totalProgrammedHours, 2.5, '60+90 minutos = 2.5 horas');
  // 150 minutos totales: la de 60min se lleva 60/150 = 40%, la de 90min 60%.
  assertEqual(summary.totalRevenueAttributed, 150000, 'la cuota completa se reparte igual');
  assertEqual(summary.generalRatePerHour, 60000, '$150.000 / 2.5h = $60.000/h');
});

// ---------------------------------------------------------------------------
// 2. Alumno por clase: distintas duraciones normalizadas a valor por hora (§5).
// ---------------------------------------------------------------------------
const PER_CLASS_DURATION_CASES: Array<{ minutes: number; price: number; expectedRate: number }> = [
  { minutes: 30, price: 30000, expectedRate: 60000 },
  { minutes: 45, price: 30000, expectedRate: 40000 },
  { minutes: 60, price: 30000, expectedRate: 30000 },
  { minutes: 75, price: 30000, expectedRate: 24000 },
  { minutes: 90, price: 30000, expectedRate: 20000 },
  { minutes: 120, price: 30000, expectedRate: 15000 },
];
PER_CLASS_DURATION_CASES.forEach(({ minutes, price, expectedRate }) => {
  test(`alumno por clase: $${price} por ${minutes} minutos -> $${expectedRate}/hora`, () => {
    const studentId = `qa_valorhora_perclase_${minutes}`;
    const endIso = new Date(new Date('2026-08-03T10:00:00.000Z').getTime() + minutes * 60_000).toISOString();
    const lessons = [makeLesson({ id: 'l1', participants: [participant(studentId)], start: '2026-08-03T10:00:00.000Z', end: endIso })];
    const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(price) }];
    const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students }));
    assertEqual(summary.generalRatePerHour, expectedRate, `duración ${minutes}min normalizada correctamente`);
  });
});

// ---------------------------------------------------------------------------
// 3. Clases grupales: se suma el aporte de cada integrante, la duración cuenta UNA vez (§6).
// ---------------------------------------------------------------------------
test('clase grupal: tres alumnos de $20.000 cada uno, clase de 60 minutos -> $60.000/hora, UNA hora docente', () => {
  const s1 = 'qa_valorhora_grupo_a';
  const s2 = 'qa_valorhora_grupo_b';
  const s3 = 'qa_valorhora_grupo_c';
  const lessons = [
    makeLesson({
      id: 'l1',
      participants: [participant(s1), participant(s2), participant(s3)],
      start: '2026-08-03T10:00:00.000Z',
      end: '2026-08-03T11:00:00.000Z',
    }),
  ];
  const students: HourlyRateStudentInfo[] = [s1, s2, s3].map((id) => ({ id, level: 'B1', billingPlan: perClassPlan(20000) }));
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students }));

  assertEqual(summary.totalProgrammedHours, 1, 'una clase de 60 minutos es UNA hora docente, nunca 3');
  assertEqual(summary.totalRevenueAttributed, 60000, 'se suman los tres aportes');
  assertEqual(summary.generalRatePerHour, 60000, '$60.000 / 1h');
  assertEqual(summary.lessonCount, 1, 'una sola ocurrencia, no tres');
});

// ---------------------------------------------------------------------------
// 4. Según nivel: mismo nivel -> ese bucket; nivel mixto -> "nivel_mixto" (§7).
// ---------------------------------------------------------------------------
test('según nivel: grupo con el mismo nivel en todos los participantes cae en ese nivel', () => {
  const s1 = 'qa_valorhora_nivel_a';
  const s2 = 'qa_valorhora_nivel_b';
  const lessons = [
    makeLesson({ id: 'l1', participants: [participant(s1, 'B2'), participant(s2, 'B2')], start: '2026-08-03T10:00:00.000Z', end: '2026-08-03T11:00:00.000Z' }),
  ];
  const students: HourlyRateStudentInfo[] = [s1, s2].map((id) => ({ id, level: 'B2', billingPlan: perClassPlan(15000) }));
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students }));
  assertEqual(summary.byLevel.length, 1, 'un único bucket');
  assertEqual(summary.byLevel[0].level, 'B2', 'nivel homogéneo real, no mixto');
});

test('según nivel: grupo con niveles distintos -> "nivel_mixto", nunca se atribuye al primer alumno', () => {
  const s1 = 'qa_valorhora_mixto_a';
  const s2 = 'qa_valorhora_mixto_b';
  const lessons = [
    makeLesson({ id: 'l1', participants: [participant(s1, 'A2'), participant(s2, 'C1')], start: '2026-08-03T10:00:00.000Z', end: '2026-08-03T11:00:00.000Z' }),
  ];
  const students: HourlyRateStudentInfo[] = [
    { id: s1, level: 'A2', billingPlan: perClassPlan(10000) },
    { id: s2, level: 'C1', billingPlan: perClassPlan(20000) },
  ];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students }));
  assertEqual(summary.byLevel.length, 1, 'un único bucket "nivel_mixto", no aparece bajo A2 ni C1');
  assertEqual(summary.byLevel[0].level, 'nivel_mixto', 'clasificado como mixto, nunca atribuido a un alumno puntual');
  assertEqual(summary.byLevel[0].revenue, 30000, 'la suma de ambos aportes sigue contando en el total mixto');
});

// ---------------------------------------------------------------------------
// 5. El calendario completo: clases futuras y sin registrar cuentan (§3, el corazón de la corrección).
// ---------------------------------------------------------------------------
test('una clase FUTURA (todavía no dictada) cuenta en el valor programado, no sólo las ya dictadas', () => {
  const studentId = 'qa_valorhora_futura';
  const lessons = [
    makeLesson({ id: 'l1', participants: [participant(studentId)], start: '2026-08-25T10:00:00.000Z', end: '2026-08-25T11:00:00.000Z' }),
  ];
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(25000) }];
  // evaluationDate=2026-08-05, la clase es del 25 -> todavía no pasó.
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students }));
  assertEqual(summary.totalProgrammedHours, 1, 'la clase futura SÍ cuenta como hora programada');
  assertEqual(summary.totalRevenueAttributed, 25000, 'con su importe estimado según el plan vigente');
  assertEqual(summary.isEstimate, true, 'el período no cerró: se marca como estimado');
});

test('una clase PASADA sin registrar pedagógicamente igual cuenta (proyección), nunca queda afuera', () => {
  const studentId = 'qa_valorhora_lapsada';
  const lessons = [
    makeLesson({ id: 'l1', participants: [participant(studentId)], start: '2026-08-02T10:00:00.000Z', end: '2026-08-02T11:00:00.000Z' }),
  ];
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(18000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students, savedLessons: [] }));
  assertEqual(summary.totalProgrammedHours, 1, 'ninguna clase se pierde por no estar registrada');
  assertEqual(summary.unregisteredCount, 1, 'se informa que es una proyección');
});

// ---------------------------------------------------------------------------
// 6. Exclusiones correctas (§8): cancelaciones, ausencias, feriados.
// ---------------------------------------------------------------------------
function registeredScenario(studentId: string, form: Partial<NewClassFormState>) {
  const lesson = makeLesson({ id: 'l1', participants: [participant(studentId)], start: '2026-08-03T10:00:00.000Z', end: '2026-08-03T11:00:00.000Z' });
  const savedForm = baseForm({ studentIds: [studentId], date: '2026-08-03', scheduledDurationMinutes: 60, ...form });
  const saved = makeSavedLesson({ id: 'saved1', calendarReservationKey: reservationKeyFor(lesson), form: savedForm, billedAmount: 20000 });
  return { lesson, saved };
}

test('registrada como "cancelada con aviso": excluida (ni horas ni ingreso)', () => {
  const studentId = 'qa_valorhora_cancel_aviso';
  const { lesson, saved } = registeredScenario(studentId, { eventType: 'cancelada_con_aviso' });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(20000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [lesson], savedLessons: [saved], students }));
  assertEqual(summary.totalProgrammedHours, 0, 'cancelada con aviso no cuenta como hora programada');
  assertEqual(summary.totalRevenueAttributed, 0, 'ni como ingreso');
});

test('registrada como "alumno ausente": excluida', () => {
  const studentId = 'qa_valorhora_ausente_alumno';
  const { lesson, saved } = registeredScenario(studentId, { eventType: 'alumno_ausente' });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(20000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [lesson], savedLessons: [saved], students }));
  assertEqual(summary.totalProgrammedHours, 0, 'alumno ausente no cuenta');
});

test('registrada como "profesora ausente": excluida', () => {
  const studentId = 'qa_valorhora_ausente_prof';
  const { lesson, saved } = registeredScenario(studentId, { eventType: 'profesora_ausente' });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(20000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [lesson], savedLessons: [saved], students }));
  assertEqual(summary.totalProgrammedHours, 0, 'profesora ausente no cuenta');
});

test('registrada como "feriado" SIN excepción: excluida', () => {
  const studentId = 'qa_valorhora_feriado_no';
  const { lesson, saved } = registeredScenario(studentId, { eventType: 'feriado', holidayException: false });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(20000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [lesson], savedLessons: [saved], students }));
  assertEqual(summary.totalProgrammedHours, 0, 'feriado no cobrable, excluido');
});

test('registrada como "feriado" CON excepción (se dictó igual): incluida', () => {
  const studentId = 'qa_valorhora_feriado_si';
  const { lesson, saved } = registeredScenario(studentId, { eventType: 'feriado', holidayException: true });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(20000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [lesson], savedLessons: [saved], students }));
  assertEqual(summary.totalProgrammedHours, 1, 'feriado cobrable cuenta igual que una clase dictada');
  assertEqual(summary.totalRevenueAttributed, 20000, 'con su importe real');
});

test('registrada como "cancelada tardía" pero COBRADA (política cobrar_100): excluida del valor-hora (es una penalidad, no una hora docente)', () => {
  const studentId = 'qa_valorhora_cancel_tarde';
  const { lesson, saved } = registeredScenario(studentId, {
    eventType: 'cancelada_tarde',
    lateCancellationPolicy: 'cobrar_100',
  });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(20000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [lesson], savedLessons: [saved], students }));
  assertEqual(summary.totalProgrammedHours, 0, 'una penalidad por cancelación tardía no es una hora de trabajo docente');
  assertEqual(summary.totalRevenueAttributed, 0, 'no distorsiona el valor-hora — sigue apareciendo en Facturación prevista, aparte');
});

test('registrada con isBillable=false: excluida aunque haya sido dictada', () => {
  const studentId = 'qa_valorhora_no_billable';
  const { lesson, saved } = registeredScenario(studentId, { eventType: 'clase_dictada', isBillable: false });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(20000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [lesson], savedLessons: [saved], students }));
  assertEqual(summary.totalProgrammedHours, 0, 'nunca cobrable, nunca cuenta');
});

test('ocurrencia sin registrar con status "cancelled": excluida', () => {
  const studentId = 'qa_valorhora_cal_cancelled';
  const lesson = makeLesson({
    id: 'l1',
    participants: [participant(studentId)],
    start: '2026-08-10T10:00:00.000Z',
    end: '2026-08-10T11:00:00.000Z',
    status: 'cancelled',
  });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(20000) }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [lesson], students }));
  assertEqual(summary.totalProgrammedHours, 0, 'cancelada a nivel calendario, sin registrar: excluida');
});

test('ocurrencia futura sin registrar, en una fecha declarada NO disponible ("Mi disponibilidad" — feriado): excluida', () => {
  const studentId = 'qa_valorhora_disponibilidad';
  const lesson = makeLesson({
    id: 'l1',
    participants: [participant(studentId)],
    start: '2026-08-17T10:00:00.000Z',
    end: '2026-08-17T11:00:00.000Z',
  });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(20000) }];
  const exceptions: AvailabilityException[] = [{ id: 'exc1', date: '2026-08-17', type: 'unavailable_full_day', reason: 'holiday' }];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [lesson], students, availabilityExceptions: exceptions }));
  assertEqual(summary.totalProgrammedHours, 0, 'día declarado no disponible: la clase proyectada se excluye');
});

// ---------------------------------------------------------------------------
// 7. Cargo real ya materializado tiene prioridad sobre la estimación del plan (correcciones de cuota a mitad de período).
// ---------------------------------------------------------------------------
test('con un cargo mensual real ya materializado, se usa su originalAmount — nunca el importe "actual" del plan si difiere', () => {
  const studentId = 'qa_valorhora_cargo_real';
  const lessons = [
    makeLesson({ id: 'l1', participants: [participant(studentId)], start: '2026-08-03T10:00:00.000Z', end: '2026-08-03T11:00:00.000Z' }),
    makeLesson({ id: 'l2', participants: [participant(studentId)], start: '2026-08-10T10:00:00.000Z', end: '2026-08-10T11:00:00.000Z' }),
  ];
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: monthlyPlan(999999) }]; // el plan "actual" NO debe usarse
  const charge: PaymentCharge = {
    id: 'charge1',
    studentId,
    type: 'mensual',
    originalAmount: 80000,
    currency: 'ARS',
    dueDate: '2026-08-01',
    createdAt: '2026-08-01T00:00:00.000Z',
    billingPeriod: '2026-08',
    calendarLessonId: null,
    voidedAt: null,
    voidReason: null,
  };
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students, charges: [charge] }));
  assertEqual(summary.totalRevenueAttributed, 80000, 'usa el cargo real materializado, nunca el importe del plan si ya hay un cargo con otro valor');
});

// ---------------------------------------------------------------------------
// §12 — INVARIANCIA DE PAGOS: el corazón de la corrección. El valor
// programado de la hora NUNCA debe cambiar según el estado de los pagos.
// ---------------------------------------------------------------------------
function paymentInvarianceScenario() {
  const studentId = 'qa_valorhora_invariancia';
  const lessons = [
    makeLesson({ id: 'l1', participants: [participant(studentId)], start: '2026-08-03T10:00:00.000Z', end: '2026-08-03T11:00:00.000Z' }),
    makeLesson({ id: 'l2', participants: [participant(studentId)], start: '2026-08-17T10:00:00.000Z', end: '2026-08-17T11:00:00.000Z' }),
  ];
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: monthlyPlan(90000) }];
  return { studentId, lessons, students };
}

test('§12.1-2: el valor hora es idéntico con el cargo del período sin pagos, con un pago en término y con un pago tardío', () => {
  const { studentId, lessons, students } = paymentInvarianceScenario();
  const charge: PaymentCharge = {
    id: 'c1', studentId, type: 'mensual', originalAmount: 90000, currency: 'ARS', dueDate: '2026-08-01',
    createdAt: '2026-08-01T00:00:00.000Z', billingPeriod: '2026-08', calendarLessonId: null, voidedAt: null, voidReason: null,
  };
  const noPayments = buildProgrammedHourlyRateSummary(baseInput({ lessons, students, charges: [charge] }));

  const withOnTimePayment = buildProgrammedHourlyRateSummary({
    ...baseInput({ lessons, students, charges: [charge] }),
    paymentsState: {
      charges: [charge],
      payments: [{ id: 'p1', studentId, amount: 90000, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-03', recordedAt: '2026-08-03T12:00:00.000Z', notes: undefined, voidedAt: null, voidReason: null, replacesPaymentId: null, source: undefined }],
      allocations: [{ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId, amount: 90000 }],
      adjustments: [],
    },
  });

  const withLatePayment = buildProgrammedHourlyRateSummary({
    ...baseInput({ lessons, students, charges: [charge] }),
    paymentsState: {
      charges: [charge],
      payments: [{ id: 'p2', studentId, amount: 90000, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-25', recordedAt: '2026-08-25T12:00:00.000Z', notes: undefined, voidedAt: null, voidReason: null, replacesPaymentId: null, source: undefined }],
      allocations: [{ id: 'a2', paymentId: 'p2', chargeId: 'c1', studentId, amount: 90000 }],
      adjustments: [],
    },
  });

  assertEqual(noPayments.generalRatePerHour, withOnTimePayment.generalRatePerHour, 'un pago en término no cambia el valor hora');
  assertEqual(noPayments.generalRatePerHour, withLatePayment.generalRatePerHour, 'un pago tardío tampoco lo cambia');
  assertEqual(noPayments.totalRevenueAttributed, withOnTimePayment.totalRevenueAttributed, 'el ingreso atribuido es el mismo');
  assertEqual(noPayments.totalRevenueAttributed, withLatePayment.totalRevenueAttributed, 'el ingreso atribuido es el mismo, pago tardío');
});

test('§12.3-4: un pago retroactivo (paidAt de un mes anterior, recordedAt hoy) y anular ese pago no cambian el valor hora', () => {
  const { studentId, lessons, students } = paymentInvarianceScenario();
  const charge: PaymentCharge = {
    id: 'c1', studentId, type: 'mensual', originalAmount: 90000, currency: 'ARS', dueDate: '2026-08-01',
    createdAt: '2026-08-01T00:00:00.000Z', billingPeriod: '2026-08', calendarLessonId: null, voidedAt: null, voidReason: null,
  };
  const noPayments = buildProgrammedHourlyRateSummary(baseInput({ lessons, students, charges: [charge] }));

  const retroactivePayment = { id: 'p3', studentId, amount: 90000, currency: 'ARS' as const, method: 'transferencia' as const, paidAt: '2026-08-03', recordedAt: '2026-08-19T12:00:00.000Z', notes: undefined, voidedAt: null, voidReason: null, replacesPaymentId: null, source: undefined };
  const withRetroactive = buildProgrammedHourlyRateSummary({
    ...baseInput({ lessons, students, charges: [charge] }),
    paymentsState: { charges: [charge], payments: [retroactivePayment], allocations: [{ id: 'a3', paymentId: 'p3', chargeId: 'c1', studentId, amount: 90000 }], adjustments: [] },
  });
  assertEqual(noPayments.generalRatePerHour, withRetroactive.generalRatePerHour, 'un pago retroactivo no cambia el valor hora');

  const withVoidedPayment = buildProgrammedHourlyRateSummary({
    ...baseInput({ lessons, students, charges: [charge] }),
    paymentsState: {
      charges: [charge],
      payments: [{ ...retroactivePayment, voidedAt: '2026-08-19T13:00:00.000Z', voidReason: 'error de carga' }],
      allocations: [{ id: 'a3', paymentId: 'p3', chargeId: 'c1', studentId, amount: 90000 }],
      adjustments: [],
    },
  });
  assertEqual(noPayments.generalRatePerHour, withVoidedPayment.generalRatePerHour, 'anular el pago tampoco cambia el valor hora — sigue basado en el cargo, nunca en el pago');
});

test('§12.5-6: dejar todos los pagos pendientes y marcar todos como cobrados dan exactamente el mismo valor hora', () => {
  const { studentId, lessons, students } = paymentInvarianceScenario();
  const charge: PaymentCharge = {
    id: 'c1', studentId, type: 'mensual', originalAmount: 90000, currency: 'ARS', dueDate: '2026-08-01',
    createdAt: '2026-08-01T00:00:00.000Z', billingPeriod: '2026-08', calendarLessonId: null, voidedAt: null, voidReason: null,
  };
  const allPending = buildProgrammedHourlyRateSummary(baseInput({ lessons, students, charges: [charge] }));
  const allPaid = buildProgrammedHourlyRateSummary({
    ...baseInput({ lessons, students, charges: [charge] }),
    paymentsState: {
      charges: [charge],
      payments: [{ id: 'p4', studentId, amount: 90000, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-02', recordedAt: '2026-08-02T12:00:00.000Z', notes: undefined, voidedAt: null, voidReason: null, replacesPaymentId: null, source: undefined }],
      allocations: [{ id: 'a4', paymentId: 'p4', chargeId: 'c1', studentId, amount: 90000 }],
      adjustments: [],
    },
  });
  assertEqual(allPending.generalRatePerHour, allPaid.generalRatePerHour, 'pendiente vs. cobrado: mismo valor hora');
  assertEqual(allPending.totalProgrammedHours, allPaid.totalProgrammedHours, 'mismas horas programadas');
});

test('§12.7: registrar pedagógicamente una clase que estaba proyectada no cambia el valor hora (mismo total del período, sólo cambia unregisteredCount)', () => {
  const studentId = 'qa_valorhora_registrar_pendiente';
  const lessons = [
    makeLesson({ id: 'l1', participants: [participant(studentId)], start: '2026-08-03T10:00:00.000Z', end: '2026-08-03T11:00:00.000Z' }),
  ];
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(22000) }];

  const beforeRegistering = buildProgrammedHourlyRateSummary(baseInput({ lessons, students }));
  assertEqual(beforeRegistering.unregisteredCount, 1, 'todavía no está registrada');

  const savedForm = baseForm({ studentIds: [studentId], date: '2026-08-03', scheduledDurationMinutes: 60, eventType: 'clase_dictada' });
  const saved = makeSavedLesson({ id: 'saved1', calendarReservationKey: reservationKeyFor(lessons[0]), form: savedForm, billedAmount: 22000 });
  const afterRegistering = buildProgrammedHourlyRateSummary(baseInput({ lessons, students, savedLessons: [saved] }));

  assertEqual(afterRegistering.unregisteredCount, 0, 'ahora ya está registrada');
  assertEqual(beforeRegistering.generalRatePerHour, afterRegistering.generalRatePerHour, 'registrar la clase pendiente no cambió el valor hora — ya estaba contada como proyección');
  assertEqual(beforeRegistering.totalRevenueAttributed, afterRegistering.totalRevenueAttributed, 'mismo ingreso atribuido antes y después de registrar');
});

// ---------------------------------------------------------------------------
// 8. Sin doble conteo entre alumnos combinados (mensual + por clase + paquete en el mismo período).
// ---------------------------------------------------------------------------
test('planes combinados en el mismo período: mensual, por clase y paquete se calculan cada uno con su propia lógica, sin mezclarse', () => {
  const monthlyStudent = 'qa_valorhora_combo_mensual';
  const perClassStudent = 'qa_valorhora_combo_perclase';
  const packageStudent = 'qa_valorhora_combo_paquete';

  const lessons = [
    makeLesson({ id: 'lm', participants: [participant(monthlyStudent)], start: '2026-08-03T10:00:00.000Z', end: '2026-08-03T11:00:00.000Z' }),
    makeLesson({ id: 'lp', participants: [participant(perClassStudent)], start: '2026-08-04T10:00:00.000Z', end: '2026-08-04T11:00:00.000Z' }),
    makeLesson({ id: 'lk', participants: [participant(packageStudent)], start: '2026-08-05T10:00:00.000Z', end: '2026-08-05T11:00:00.000Z' }),
  ];
  const students: HourlyRateStudentInfo[] = [
    { id: monthlyStudent, level: 'B1', billingPlan: monthlyPlan(40000) },
    { id: perClassStudent, level: 'B1', billingPlan: perClassPlan(15000) },
    { id: packageStudent, level: 'B1', billingPlan: packagePlan(50000, 5) }, // $10.000 por clase equivalente
  ];
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons, students }));

  assertEqual(summary.totalProgrammedHours, 3, 'tres horas programadas, una por alumno');
  assertEqual(summary.totalRevenueAttributed, 40000 + 15000 + 10000, 'cada plan aporta exactamente lo suyo, sin duplicar ni mezclar');
});

// ---------------------------------------------------------------------------
// 9. Cambio de mes/año: quincenal cruzando diciembre -> enero.
// ---------------------------------------------------------------------------
test('cambio de año: una clase de diciembre y otra de enero (mismo alumno mensual) se calculan cada una contra SU propio período', () => {
  const studentId = 'qa_valorhora_cambio_anio';
  const decLesson = makeLesson({ id: 'ldec', participants: [participant(studentId)], start: '2026-12-15T10:00:00.000Z', end: '2026-12-15T11:00:00.000Z' });
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: monthlyPlan(70000) }];

  const decSummary = buildProgrammedHourlyRateSummary({
    ...baseInput({ lessons: [decLesson], students }),
    rangeStart: '2026-12-01',
    rangeEnd: '2026-12-31',
    evaluationDate: '2026-12-05',
  });
  assertEqual(decSummary.totalRevenueAttributed, 70000, 'diciembre usa la cuota vigente de diciembre');

  const janLesson = makeLesson({ id: 'ljan', participants: [participant(studentId)], start: '2027-01-15T10:00:00.000Z', end: '2027-01-15T11:00:00.000Z' });
  const janSummary = buildProgrammedHourlyRateSummary({
    ...baseInput({ lessons: [janLesson], students }),
    rangeStart: '2027-01-01',
    rangeEnd: '2027-01-31',
    evaluationDate: '2027-01-05',
  });
  assertEqual(janSummary.totalRevenueAttributed, 70000, 'enero se calcula sobre su propio período, cruzando el año sin romper nada');
});

// ---------------------------------------------------------------------------
// 10. `isEstimate`: período cerrado vs. todavía abierto.
// ---------------------------------------------------------------------------
test('isEstimate es false cuando el período ya cerró respecto de evaluationDate', () => {
  const studentId = 'qa_valorhora_cerrado';
  const lessons = [makeLesson({ id: 'l1', participants: [participant(studentId)], start: '2026-07-05T10:00:00.000Z', end: '2026-07-05T11:00:00.000Z' })];
  const students: HourlyRateStudentInfo[] = [{ id: studentId, level: 'B1', billingPlan: perClassPlan(10000) }];
  const summary = buildProgrammedHourlyRateSummary({
    ...baseInput({ lessons, students }),
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-08-05', // ya pasó julio completo
  });
  assertEqual(summary.isEstimate, false, 'julio ya cerró: valor definitivo');
});

// ---------------------------------------------------------------------------
// 11. Sin datos: nunca divide por cero.
// ---------------------------------------------------------------------------
test('sin ninguna clase en el período: generalRatePerHour es null, nunca NaN ni Infinity', () => {
  const summary = buildProgrammedHourlyRateSummary(baseInput({ lessons: [], students: [] }));
  assertEqual(summary.generalRatePerHour, null, 'sin horas, sin tasa — nunca división por cero');
  assertEqual(summary.totalProgrammedHours, 0, 'cero horas');
  assert(summary.byLevel.length === 0, 'sin niveles para mostrar');
});
