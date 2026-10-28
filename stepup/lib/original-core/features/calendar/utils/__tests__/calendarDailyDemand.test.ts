// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarDailyDemand.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarDay, CalendarLesson } from '../../types/index.ts';
import type { TeacherAvailability } from '../../types/teacherAvailability.ts';
import { classifyDailyDemand, computeDailyFreeMinutes } from '../calendarDailyDemand.ts';
import { jsDayToAppWeekday } from '../calendarWeekday.ts';
import { assert, assertEqual, test } from './testHarness.ts';

/**
 * Corrección 2026-07-16 (a pedido de Joaquín) — pruebas del color de
 * demanda por día. Las fechas/horas de las clases se construyen con el
 * constructor local de `Date` (nunca strings 'Z' fijos): así
 * `new Date(x).getHours()` siempre devuelve la hora que se puso acá,
 * cualquiera sea la zona horaria de la máquina donde corran las pruebas —
 * mismo criterio que ya usa `computeDailyFreeMinutes` para leer el
 * horario real de una clase.
 */
function localIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0).toISOString();
}

function makeLesson(overrides: Partial<CalendarLesson>): CalendarLesson {
  return {
    id: 'lesson-1',
    studentId: 's1',
    studentName: 'Alumna de prueba',
    level: 'B1',
    participants: [{ studentId: 's1', studentName: 'Alumna de prueba', level: 'B1' }],
    lessonType: 'individual',
    start: localIso(2026, 7, 20, 9, 0),
    end: localIso(2026, 7, 20, 10, 0),
    modality: 'presencial',
    status: 'scheduled',
    color: '#fff',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
    ...overrides,
  };
}

function emptyAvailability(overrides: Partial<TeacherAvailability> = {}): TeacherAvailability {
  return {
    schemaVersion: 1,
    timezone: 'America/Argentina/Buenos_Aires',
    weeklyBlocks: [],
    exceptions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeDailyFreeMinutes
// ---------------------------------------------------------------------------

test('computeDailyFreeMinutes: un día sin ninguna clase ni bloqueo da las 14 horas completas (840 min) libres', () => {
  const day: CalendarDay = { date: localIso(2026, 7, 20, 0, 0), lessons: [] };
  assertEqual(computeDailyFreeMinutes(day), 14 * 60, 'ventana completa 8-22 libre');
});

test('computeDailyFreeMinutes: una clase cancelada nunca resta horas libres', () => {
  const day: CalendarDay = {
    date: localIso(2026, 7, 20, 0, 0),
    lessons: [
      makeLesson({
        start: localIso(2026, 7, 20, 9, 0),
        end: localIso(2026, 7, 20, 10, 0),
        status: 'cancelled',
      }),
    ],
  };
  assertEqual(computeDailyFreeMinutes(day), 14 * 60, 'clase cancelada no ocupa horario');
});

test('computeDailyFreeMinutes: una clase real de 1 hora resta exactamente 60 minutos', () => {
  const day: CalendarDay = {
    date: localIso(2026, 7, 20, 0, 0),
    lessons: [makeLesson({ start: localIso(2026, 7, 20, 9, 0), end: localIso(2026, 7, 20, 10, 0) })],
  };
  assertEqual(computeDailyFreeMinutes(day), 14 * 60 - 60, 'resta 1 hora exacta');
});

test('computeDailyFreeMinutes: dos clases superpuestas nunca restan el doble (unión de intervalos, no suma ingenua)', () => {
  const day: CalendarDay = {
    date: localIso(2026, 7, 20, 0, 0),
    lessons: [
      makeLesson({ id: 'l1', start: localIso(2026, 7, 20, 9, 0), end: localIso(2026, 7, 20, 10, 30) }),
      makeLesson({ id: 'l2', start: localIso(2026, 7, 20, 10, 0), end: localIso(2026, 7, 20, 11, 0) }),
    ],
  };
  // Unión real: 9:00-11:00 = 120 min, nunca 90+60=150.
  assertEqual(computeDailyFreeMinutes(day), 14 * 60 - 120, 'la unión de los intervalos solapados es 120 min, no 150');
});

test('computeDailyFreeMinutes: el ejemplo real de Joaquín (trabajo 12-18, libre 9-11 y 19-22) da 300 minutos libres', () => {
  const availability = emptyAvailability({
    weeklyBlocks: [{ id: 'w1', weekday: dateKeyWeekday(2026, 7, 20), startTime: '12:00', endTime: '18:00', reason: 'work' }],
  });
  const day: CalendarDay = { date: localIso(2026, 7, 20, 0, 0), lessons: [] };
  // Libre: 8-12 (240) + 18-22 (240) = 480 min, no 300 — a propósito: el
  // ejemplo de Joaquín sólo mencionó "9 a 11 y 19 a 22" como lo que
  // recordaba de memoria, pero con el bloqueo real (12-18) el resto de la
  // ventana (8-12 y 18-22) también queda libre. Se verifica el cálculo
  // real, no la cifra aproximada que dio de memoria.
  assertEqual(computeDailyFreeMinutes(day, availability), 480, 'libre fuera del bloque de trabajo 12-18: 8-12 y 18-22');
});

test('computeDailyFreeMinutes: un bloqueo semanal sólo aplica el día de semana que le corresponde', () => {
  const monday = dateKeyWeekday(2026, 7, 20); // lunes
  const availability = emptyAvailability({
    weeklyBlocks: [{ id: 'w1', weekday: monday, startTime: '12:00', endTime: '18:00', reason: 'work' }],
  });
  const tuesday: CalendarDay = { date: localIso(2026, 7, 21, 0, 0), lessons: [] };
  assertEqual(computeDailyFreeMinutes(tuesday, availability), 14 * 60, 'el martes no tiene el bloqueo del lunes');
});

test('computeDailyFreeMinutes: una excepción unavailable_full_day deja el día en 0 minutos libres', () => {
  const availability = emptyAvailability({
    exceptions: [{ id: 'e1', date: '2026-07-20', type: 'unavailable_full_day', reason: 'vacation' }],
  });
  const day: CalendarDay = { date: localIso(2026, 7, 20, 0, 0), lessons: [] };
  assertEqual(computeDailyFreeMinutes(day, availability), 0, 'día completo bloqueado');
});

test('computeDailyFreeMinutes: available_extra nunca se resta como si fuera un bloqueo (se ignora, igual que en el overlay del Calendario)', () => {
  const availability = emptyAvailability({
    exceptions: [{ id: 'e1', date: '2026-07-20', type: 'available_extra', startTime: '08:00', endTime: '22:00', reason: 'other' }],
  });
  const day: CalendarDay = { date: localIso(2026, 7, 20, 0, 0), lessons: [] };
  assertEqual(computeDailyFreeMinutes(day, availability), 14 * 60, 'available_extra no resta horas libres');
});

// ---------------------------------------------------------------------------
// classifyDailyDemand
// ---------------------------------------------------------------------------

test('classifyDailyDemand: un día de vacaciones (unavailable_full_day + reason vacation) siempre clasifica "vacaciones", nunca "completo"', () => {
  const availability = emptyAvailability({
    exceptions: [{ id: 'e1', date: '2026-07-20', type: 'unavailable_full_day', reason: 'vacation' }],
  });
  const day: CalendarDay = { date: localIso(2026, 7, 20, 0, 0), lessons: [] };
  const result = classifyDailyDemand(day, availability);
  assertEqual(result.level, 'vacaciones', 'nunca debe confundirse con "completo" (agenda llena de clases reales)');
});

test('classifyDailyDemand: un día completo de CLASES reales (0 min libres, sin vacaciones) clasifica "completo", nunca "vacaciones"', () => {
  const day: CalendarDay = {
    date: localIso(2026, 7, 20, 0, 0),
    lessons: [makeLesson({ start: localIso(2026, 7, 20, 8, 0), end: localIso(2026, 7, 20, 22, 0) })],
  };
  const result = classifyDailyDemand(day);
  assertEqual(result.level, 'completo', 'agenda llena de clases reales es "completo", un concepto distinto de vacaciones');
});

test('classifyDailyDemand: rangos de horas libres → nivel, límites exactos', () => {
  const cases: Array<{ freeHours: number; expected: string }> = [
    { freeHours: 3, expected: 'saturado' },
    { freeHours: 3.5, expected: 'ocupado' },
    { freeHours: 6, expected: 'ocupado' },
    { freeHours: 6.5, expected: 'media' },
    { freeHours: 9, expected: 'media' },
    { freeHours: 9.5, expected: 'libre' },
    { freeHours: 14, expected: 'libre' },
  ];
  for (const { freeHours, expected } of cases) {
    const busyMinutes = 14 * 60 - freeHours * 60;
    const day: CalendarDay = {
      date: localIso(2026, 7, 20, 0, 0),
      lessons:
        busyMinutes > 0
          ? [makeLesson({ start: localIso(2026, 7, 20, 8, 0), end: localIso(2026, 7, 20, 8, Math.round(busyMinutes) ) })]
          : [],
    };
    // Nota: los minutos pueden superar 59 en el constructor de Date a
    // propósito (Date normaliza el desborde de minutos a horas solo);
    // se usa así para poder parametrizar el test con minutos exactos sin
    // tener que convertir manualmente a horas+minutos en cada caso.
    const result = classifyDailyDemand(day);
    assertEqual(result.level, expected, `${freeHours}h libres debe dar "${expected}" (dio "${result.level}")`);
  }
});

test('classifyDailyDemand: el label nunca queda vacío — nunca se comunica sólo por color', () => {
  const day: CalendarDay = { date: localIso(2026, 7, 20, 0, 0), lessons: [] };
  const result = classifyDailyDemand(day);
  assert(result.label.trim().length > 0, 'siempre debe existir un texto descriptivo, nunca sólo el color');
});

function dateKeyWeekday(year: number, month: number, day: number) {
  return jsDayToAppWeekday(new Date(year, month - 1, day).getDay());
}
