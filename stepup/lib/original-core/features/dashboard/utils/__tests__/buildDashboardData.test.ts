// Puerto VERBATIM del original (`src/features/dashboard/utils/__tests__/buildDashboardData.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../../../calendar/types/index.ts';
import type { SavedLesson } from '../../../new-class/types/index.ts';
import type { StudentListItem } from '../../../students/types/index.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildDashboardData } from '../buildDashboardData.ts';

const activeStudent: StudentListItem = {
  id: 'student-1',
  name: 'Ana',
  levels: ['B1'],
  modality: 'online',
  status: 'activo',
  nextClassAt: null,
  paymentStatus: 'verde',
  averageGrade: 0,
  classesThisMonth: 0,
  lastPaymentAt: null,
  isFeatured: false,
  isNew: false,
  hasOverduePayment: false,
  hasPendingReport: false,
  hasPendingHomework: false,
};

function calendarLesson(id: string, start: string, status: CalendarLesson['status']): CalendarLesson {
  return {
    id,
    studentId: activeStudent.id,
    studentName: activeStudent.name,
    level: activeStudent.levels.join(', '),
    participants: [
      { studentId: activeStudent.id, studentName: activeStudent.name, level: activeStudent.levels.join(', ') },
    ],
    lessonType: 'individual',
    start,
    end: new Date(new Date(start).getTime() + 60 * 60_000).toISOString(),
    modality: 'online',
    status,
    color: '#DDEBFF',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
  };
}

function savedLesson(date: string, minutes: number, grade: number | null): SavedLesson {
  return {
    id: `saved-${date}-${minutes}`,
    createdAt: `${date}T00:00:00.000Z`,
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    form: {
      eventType: 'clase_dictada',
      studentIds: [activeStudent.id],
      date,
      time: '10:00',
      scheduledDurationMinutes: minutes,
      actualDurationMinutes: minutes,
      modality: 'online',
      attendance: [{ studentId: activeStudent.id, present: true }],
      topics: [],
      objectives: [],
      activities: [],
      activityNotes: '',
      activityAttachments: [],
      materialIds: [],
      evaluations: [
        { studentId: activeStudent.id, generalGrade: grade, skillGrades: {}, strengths: [], areasToImprove: [] },
      ],
      internalNotes: '',
      homeworkDescription: '',
      homeworkDueDate: null,
      isBillable: false,
      lateCancellationPolicy: null,
      lateCancellationPercentage: null,
      consumesMonthlyPackage: false,
      holidayException: false,
      rescheduledFromLessonId: null,
    },
  };
}

test('usa agenda y registros reales para las métricas', () => {
  const now = new Date(2026, 6, 13, 12, 0, 0, 0);
  const future = new Date(2026, 6, 13, 14, 0, 0, 0).toISOString();
  const cancelled = new Date(2026, 6, 14, 10, 0, 0, 0).toISOString();
  const data = buildDashboardData({
    now,
    students: [activeStudent, { ...activeStudent, id: 'student-2', status: 'inactivo' }],
    lessons: [calendarLesson('future', future, 'scheduled'), calendarLesson('cancelled', cancelled, 'cancelled')],
    recurrenceRules: [],
    recurrenceExceptions: [],
    savedLessons: [savedLesson('2026-07-02', 60, 8), savedLesson('2026-07-09', 90, 10)],
  });

  assertEqual(data.nextClass?.id, 'future', 'elige la próxima clase de hoy');
  assertEqual(data.todayLessons.length, 1, 'muestra la agenda real de hoy');
  assertEqual(data.stats.activeStudents, 1, 'cuenta únicamente alumnos activos');
  assertEqual(data.stats.lessonsThisWeek, 1, 'no cuenta clases canceladas');
  assertEqual(data.stats.hoursTaughtThisMonth, 2.5, 'suma la duración real registrada');
  assertEqual(data.stats.averageGrade, 9, 'promedia evaluaciones guardadas');
});

test('muestra promedio sin datos cuando no hay evaluaciones', () => {
  const data = buildDashboardData({
    now: new Date(2026, 6, 13, 12, 0, 0, 0),
    students: [],
    lessons: [],
    recurrenceRules: [],
    recurrenceExceptions: [],
    savedLessons: [],
  });

  assertEqual(data.nextClass, null, 'no inventa una próxima clase');
  assertEqual(data.stats.averageGrade, null, 'conserva el estado sin datos');
  assertEqual(data.stats.hoursTaughtThisMonth, 0, 'no inventa horas dictadas');
});

// ============================================================================
// P0) "PRÓXIMA CLASE" CAMBIA ANTES DE QUE TERMINE LA CLASE EN CURSO
// Corrección P0 (a pedido de Joaquín): antes, `nextClass` exigía
// `start >= now` — en el instante exacto en que una clase empezaba, dejaba
// de cumplir esa condición y `todayLessons.find(...)` saltaba de inmediato a
// la clase siguiente de hoy, aunque la actual siguiera en curso. Ahora usa
// `selectCurrentOrNextOccurrence` (misma función real que perfil/lista de
// alumnos) — pruebas de integración acá; la matriz completa de duraciones,
// reprogramación, recurrencia, etc. ya está cubierta a nivel de la función
// central (`calendarNextClassAt.test.ts`), nunca reimplementada acá.
// ============================================================================

test('P0) nextClass: una clase que ya empezó (dentro de su horario) sigue siendo LA MISMA — nunca salta a la siguiente de hoy', () => {
  const now = new Date(2026, 6, 13, 15, 30, 0, 0); // 15:30, a mitad de una clase de 15:00 a 16:00
  const current = calendarLesson('current', new Date(2026, 6, 13, 15, 0, 0, 0).toISOString(), 'scheduled');
  const later = calendarLesson('later', new Date(2026, 6, 13, 18, 0, 0, 0).toISOString(), 'scheduled');
  const data = buildDashboardData({
    now,
    students: [activeStudent],
    lessons: [current, later],
    recurrenceRules: [],
    recurrenceExceptions: [],
    savedLessons: [],
  });

  assertEqual(data.nextClass?.id, 'current', 'sigue siendo la clase que ya empezó, nunca la de las 18:00');
  assertEqual(data.nextClass?.timing, 'in_progress', 'reconocida como en curso');
});

test('P0) nextClass: en el instante EXACTO del inicio, ya se reconoce como en curso (nunca "próxima" un instante de más)', () => {
  const start = new Date(2026, 6, 13, 15, 0, 0, 0);
  const current = calendarLesson('current', start.toISOString(), 'scheduled');
  const data = buildDashboardData({
    now: new Date(start), // instante exacto del inicio
    students: [activeStudent],
    lessons: [current],
    recurrenceRules: [],
    recurrenceExceptions: [],
    savedLessons: [],
  });
  assertEqual(data.nextClass?.timing, 'in_progress', 'el instante exacto del inicio ya es "en curso"');
});

test('P0) nextClass: en el instante EXACTO del final, avanza a la siguiente clase de hoy', () => {
  const start = new Date(2026, 6, 13, 15, 0, 0, 0);
  const end = new Date(2026, 6, 13, 16, 0, 0, 0); // calendarLesson: 60 minutos fijos
  const current = calendarLesson('current', start.toISOString(), 'scheduled');
  const next = calendarLesson('next', new Date(2026, 6, 13, 18, 0, 0, 0).toISOString(), 'scheduled');
  const data = buildDashboardData({
    now: end,
    students: [activeStudent],
    lessons: [current, next],
    recurrenceRules: [],
    recurrenceExceptions: [],
    savedLessons: [],
  });
  assertEqual(data.nextClass?.id, 'next', 'en el instante exacto del final ya puede mostrarse la siguiente');
  assertEqual(data.nextClass?.timing, 'upcoming', 'la siguiente todavía no empezó');
});

test('P0) nextClass: una clase cancelada durante su propio horario nunca queda como "en curso" — el hueco simplemente no tiene próxima clase', () => {
  const now = new Date(2026, 6, 13, 15, 30, 0, 0);
  const cancelled = calendarLesson('cancelled-mid', new Date(2026, 6, 13, 15, 0, 0, 0).toISOString(), 'cancelled');
  const data = buildDashboardData({
    now,
    students: [activeStudent],
    lessons: [cancelled],
    recurrenceRules: [],
    recurrenceExceptions: [],
    savedLessons: [],
  });
  assertEqual(data.nextClass, null, 'una clase cancelada nunca cuenta como en curso, ni durante su propio horario original');
});

test('P0) nextClass: clase grupal en curso — mismo criterio exacto que individual, no un camino aparte', () => {
  const now = new Date(2026, 6, 13, 15, 30, 0, 0);
  const group = calendarLesson('group-current', new Date(2026, 6, 13, 15, 0, 0, 0).toISOString(), 'scheduled');
  group.lessonType = 'group';
  group.participants = [
    { studentId: activeStudent.id, studentName: activeStudent.name, level: 'B1' },
    { studentId: 'student-2', studentName: 'Beto', level: 'B1' },
  ];
  const data = buildDashboardData({
    now,
    students: [activeStudent],
    lessons: [group],
    recurrenceRules: [],
    recurrenceExceptions: [],
    savedLessons: [],
  });
  assertEqual(data.nextClass?.id, 'group-current', 'clase grupal reconocida en curso, mismo criterio que individual');
  assertEqual(data.nextClass?.timing, 'in_progress', 'en curso');
});

test('P0) nextClass: nunca muta las clases de entrada (sources.lessons intacto tras el cálculo)', () => {
  const now = new Date(2026, 6, 13, 15, 30, 0, 0);
  const current = calendarLesson('current', new Date(2026, 6, 13, 15, 0, 0, 0).toISOString(), 'scheduled');
  const lessons = [current];
  const snapshot = JSON.stringify(lessons);
  buildDashboardData({ now, students: [activeStudent], lessons, recurrenceRules: [], recurrenceExceptions: [], savedLessons: [] });
  assertEqual(JSON.stringify(lessons), snapshot, 'sources.lessons no se modifica al calcular nextClass');
});
