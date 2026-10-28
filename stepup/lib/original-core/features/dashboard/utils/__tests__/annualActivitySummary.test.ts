// Puerto VERBATIM del original (`src/features/dashboard/utils/__tests__/annualActivitySummary.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { NewClassFormState, SavedLesson } from '../../../new-class/types/index.ts';
import { DEFAULT_FORM_STATE } from '../../../new-class/types/index.ts';
import { buildAnnualActivitySummary, buildModalitySummary } from '../annualActivitySummary.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function lesson(
  overrides: Partial<Omit<SavedLesson, 'form'>> & { id: string; form: Partial<NewClassFormState> }
): SavedLesson {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    ...overrides,
    form: {
      ...DEFAULT_FORM_STATE,
      studentIds: ['s1'],
      date: '2026-03-10',
      time: '10:00',
      modality: 'online',
      eventType: 'clase_dictada',
      // Sin duración real por defecto: si no, el actualDurationMinutes:60 de
      // DEFAULT_FORM_STATE pisaría en silencio cualquier scheduledDurationMinutes
      // distinto que se pase en el override, sin que el test lo note.
      actualDurationMinutes: null,
      ...overrides.form,
    },
  };
}

const YEAR_RANGE = { rangeStart: '2026-01-01', rangeEnd: '2026-12-31' };

// ---------------------------------------------------------------------------
// Horas dictadas
// ---------------------------------------------------------------------------

test('horas dictadas: usa duración real cuando existe', () => {
  const lessons = [
    lesson({ id: 'l1', form: { eventType: 'clase_dictada', scheduledDurationMinutes: 60, actualDurationMinutes: 45 } }),
  ];
  const summary = buildAnnualActivitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(summary.heldHours, 45 / 60, 'usa la duración real, no la programada');
});

test('horas dictadas: cae a duración programada si no hay real', () => {
  const lessons = [
    lesson({ id: 'l1', form: { eventType: 'clase_dictada', scheduledDurationMinutes: 60, actualDurationMinutes: null } }),
  ];
  const summary = buildAnnualActivitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(summary.heldHours, 1, 'sin duración real, usa la programada');
});

test('horas dictadas: sólo clases con eventType clase_dictada (o feriado con excepción)', () => {
  const lessons = [
    lesson({ id: 'l1', form: { eventType: 'clase_dictada', scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l2', form: { eventType: 'feriado', holidayException: true, scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l3', form: { eventType: 'feriado', holidayException: false, scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l4', form: { eventType: 'alumno_ausente', scheduledDurationMinutes: 60 } }),
  ];
  const summary = buildAnnualActivitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(summary.heldHours, 2, 'clase_dictada + feriado con excepción = 2 horas; feriado real y ausencia no cuentan');
  assertEqual(summary.heldLessonCount, 2, 'dos clases dictadas');
});

test('clase compartida cuenta como una sola hora dictada, no una por alumno', () => {
  const lessons = [
    lesson({ id: 'l1', form: { eventType: 'clase_dictada', studentIds: ['s1', 's2', 's3'], scheduledDurationMinutes: 60 } }),
  ];
  const summary = buildAnnualActivitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(summary.heldHours, 1, 'un registro = 1 hora, sin importar cuántos participantes tenga');
});

// ---------------------------------------------------------------------------
// Reprogramaciones
// ---------------------------------------------------------------------------

test('reprogramación única: cuenta la duración de la ocurrencia reprogramada una sola vez', () => {
  const lessons = [
    lesson({ id: 'l-original', calendarReservationKey: 'res-1', form: { eventType: 'reprogramada', scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l-nueva', form: { eventType: 'clase_dictada', scheduledDurationMinutes: 60 } }),
  ];
  const summary = buildAnnualActivitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(summary.rescheduledHours, 1, 'la reprogramación cuenta 1 hora');
  assertEqual(summary.heldHours, 1, 'la clase nueva cuenta 1 hora dictada — nunca se suman ambas como si fueran 2 clases distintas de reprogramación');
  assertEqual(summary.rescheduledChangeCount, 1, 'un único evento de reprogramación');
});

test('reprogramaciones múltiples de la misma reserva: las horas cuentan UNA sola vez, pero la cantidad de cambios sí se acumula', () => {
  const lessons = [
    lesson({ id: 'l1', calendarReservationKey: 'res-1', form: { eventType: 'reprogramada', scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l2', calendarReservationKey: 'res-1', form: { eventType: 'reprogramada', scheduledDurationMinutes: 60 } }),
  ];
  const summary = buildAnnualActivitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(summary.rescheduledHours, 1, 'la misma reserva reprogramada dos veces sigue siendo 1 hora afectada, nunca 2');
  assertEqual(summary.rescheduledChangeCount, 2, 'pero la cantidad de cambios sí refleja los dos eventos');
});

// ---------------------------------------------------------------------------
// Cancelaciones
// ---------------------------------------------------------------------------

test('cancelaciones: desglosa por categoría y nunca las mezcla con horas dictadas', () => {
  const lessons = [
    lesson({ id: 'l1', form: { eventType: 'cancelada_con_aviso', scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l2', form: { eventType: 'cancelada_tarde', scheduledDurationMinutes: 30 } }),
    lesson({ id: 'l3', form: { eventType: 'profesora_ausente', scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l4', form: { eventType: 'feriado', holidayException: false, scheduledDurationMinutes: 60 } }),
  ];
  const summary = buildAnnualActivitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(summary.heldHours, 0, 'ninguna de estas cuenta como dictada');
  assertEqual(summary.cancelledByCategory.con_aviso.hours, 1, 'cancelada con aviso');
  assertEqual(summary.cancelledByCategory.cancelacion_tardia.hours, 0.5, 'cancelación tardía de 30 minutos');
  assertEqual(summary.cancelledByCategory.profesora_ausente.hours, 1, 'profesora ausente');
  assertEqual(summary.cancelledByCategory.feriado.hours, 1, 'feriado real, sin excepción');
  assertEqual(summary.cancelledHours, 3.5, 'suma total de todas las categorías');
});

test('feriado con excepción (se dictó igual) nunca cuenta como cancelado', () => {
  const lessons = [lesson({ id: 'l1', form: { eventType: 'feriado', holidayException: true, scheduledDurationMinutes: 60 } })];
  const summary = buildAnnualActivitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(summary.cancelledByCategory.feriado.hours, 0, 'con excepción, se dictó y ya cuenta como held');
  assertEqual(summary.heldHours, 1, 'se contó como dictada');
});

// ---------------------------------------------------------------------------
// Cambio de año
// ---------------------------------------------------------------------------

test('cambio de año: sólo cuenta clases dentro del rango del año pedido', () => {
  const lessons = [
    lesson({ id: 'l-2025', form: { eventType: 'clase_dictada', date: '2025-12-31', scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l-2026', form: { eventType: 'clase_dictada', date: '2026-01-01', scheduledDurationMinutes: 60 } }),
  ];
  const summary = buildAnnualActivitySummary({ lessons, rangeStart: '2026-01-01', rangeEnd: '2026-12-31' });
  assertEqual(summary.heldHours, 1, 'sólo la clase de 2026 cuenta');
});

// ---------------------------------------------------------------------------
// Modalidad más utilizada
// ---------------------------------------------------------------------------

test('modalidad: agrupa horas por modalidad, no sólo cantidad de tarjetas', () => {
  const lessons = [
    lesson({ id: 'l1', form: { eventType: 'clase_dictada', modality: 'online', scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l2', form: { eventType: 'clase_dictada', modality: 'online', scheduledDurationMinutes: 90 } }),
    lesson({ id: 'l3', form: { eventType: 'clase_dictada', modality: 'presencial', scheduledDurationMinutes: 30 } }),
  ];
  const summary = buildModalitySummary({ lessons, ...YEAR_RANGE });
  const online = summary.breakdown.find((entry) => entry.modality === 'online');
  const presencial = summary.breakdown.find((entry) => entry.modality === 'presencial');
  assertEqual(online!.hours, 2.5, '60+90 minutos online = 2.5 horas');
  assertEqual(presencial!.hours, 0.5, '30 minutos presencial');
  assertEqual(summary.mostUsed.length, 1, 'una única modalidad más usada');
  assertEqual(summary.mostUsed[0], 'online', 'online es la más usada por horas');
});

test('modalidad: empate muestra ambas como más utilizadas', () => {
  const lessons = [
    lesson({ id: 'l1', form: { eventType: 'clase_dictada', modality: 'online', scheduledDurationMinutes: 60 } }),
    lesson({ id: 'l2', form: { eventType: 'clase_dictada', modality: 'presencial', scheduledDurationMinutes: 60 } }),
  ];
  const summary = buildModalitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(summary.mostUsed.length, 2, 'ambas modalidades empatadas aparecen');
});

test('modalidad: canceladas nunca cuentan', () => {
  const lessons = [
    lesson({ id: 'l1', form: { eventType: 'cancelada_con_aviso', modality: 'online', scheduledDurationMinutes: 60 } }),
  ];
  const summary = buildModalitySummary({ lessons, ...YEAR_RANGE });
  const total = summary.breakdown.reduce((sum, entry) => sum + entry.hours, 0);
  assertEqual(total, 0, 'una clase cancelada no aporta a ninguna modalidad');
});

// ---------------------------------------------------------------------------
// Seguridad
// ---------------------------------------------------------------------------

test('sin clases: todo en cero, porcentajes nunca NaN/Infinity', () => {
  const summary = buildModalitySummary({ lessons: [], ...YEAR_RANGE });
  summary.breakdown.forEach((entry) => {
    assertEqual(entry.percent, 0, 'sin horas totales, porcentaje 0, nunca división por cero');
    assert(Number.isFinite(entry.percent), 'siempre finito');
  });
  assertEqual(summary.mostUsed.length, 0, 'sin datos, ninguna modalidad "más usada"');
});

test('no muta la lista de clases recibida', () => {
  const lessons = [lesson({ id: 'l1', form: { eventType: 'clase_dictada', scheduledDurationMinutes: 60 } })];
  const snapshot = JSON.stringify(lessons);
  buildAnnualActivitySummary({ lessons, ...YEAR_RANGE });
  buildModalitySummary({ lessons, ...YEAR_RANGE });
  assertEqual(JSON.stringify(lessons), snapshot, 'la lista original no cambia');
});
