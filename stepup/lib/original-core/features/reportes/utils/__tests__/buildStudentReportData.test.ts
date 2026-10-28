// Puerto VERBATIM del original (`src/features/reportes/utils/__tests__/buildStudentReportData.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildStudentReportData } from '../buildStudentReportData.ts';
import type { NewClassFormState, SavedLesson } from '../../../new-class/types/index.ts';
import { DEFAULT_FORM_STATE } from '../../../new-class/types/index.ts';

function form(overrides: Partial<NewClassFormState> & { studentIds: string[] }): NewClassFormState {
  return {
    ...DEFAULT_FORM_STATE,
    eventType: 'clase_dictada',
    date: '2026-07-11',
    time: '10:00',
    modality: 'presencial',
    ...overrides,
  };
}

function lesson(overrides: Partial<SavedLesson> & { id: string; form: NewClassFormState }): SavedLesson {
  return {
    createdAt: '2026-07-11T12:00:00.000Z',
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    ...overrides,
  };
}

const PERIOD = { startDate: '2026-07-01', endDate: '2026-07-31', label: 'Julio 2026' };

test('sólo incluye clases del alumno pedido, dentro del período pedido', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-10', topics: [{ id: 't1', text: 'Present perfect', status: 'visto' }] }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s2'], date: '2026-07-11', topics: [{ id: 't2', text: 'No debe aparecer (otro alumno)', status: 'visto' }] }) }),
    lesson({ id: 'l3', form: form({ studentIds: ['s1'], date: '2026-06-30', topics: [{ id: 't3', text: 'No debe aparecer (fuera del período)', status: 'visto' }] }) }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(data.topicsSeen.length, 1, 'sólo el tema de la clase correcta, del alumno correcto, dentro del período');
  assertEqual(data.topicsSeen[0], 'Present perfect', 'el tema real');
});

test('sólo cuenta temas con status "visto", nunca los "planificado"', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      form: form({
        studentIds: ['s1'],
        topics: [
          { id: 't1', text: 'Visto de verdad', status: 'visto' },
          { id: 't2', text: 'Sólo planificado', status: 'planificado' },
        ],
      }),
    }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(data.topicsSeen.length, 1, 'nunca reporta un tema que todavía no se dio de verdad');
  assertEqual(data.topicsSeen[0], 'Visto de verdad', 'el único tema real');
});

test('promedia las notas por área a lo largo de varias clases del período', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      form: form({
        studentIds: ['s1'],
        evaluations: [{ studentId: 's1', generalGrade: 8, skillGrades: { grammar: 6 }, strengths: [], areasToImprove: [] }],
      }),
    }),
    lesson({
      id: 'l2',
      form: form({
        studentIds: ['s1'],
        date: '2026-07-15',
        evaluations: [{ studentId: 's1', generalGrade: 8, skillGrades: { grammar: 8 }, strengths: [], areasToImprove: [] }],
      }),
    }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  const grammarNote = data.skillNotes.find((note) => note.skill === 'grammar');
  assert(grammarNote !== undefined, 'debe existir la nota promedio de gramática');
  assertEqual(grammarNote!.averageGrade, 7, 'promedio real de 6 y 8');
  assertEqual(data.generalAverageGrade, 8, 'promedio de la nota general');
});

// ===========================================================================
// 9) Corrección P0 2026-08-19 (a pedido de Joaquín — "NOTAS POR ÁREA ASIGNA 5
// ACCIDENTALMENTE"): 0 nunca es una nota real (ver SkillGradeChips.tsx) —
// el promedio debe ignorarlo igual que ausente/null, incluso si viene de
// datos heredados (un 0 que ya estaba persistido de antes).
// ===========================================================================

test('9) promedios ignoran un cero heredado en skillGrades — nunca lo cuenta como una nota real de 0', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      form: form({
        studentIds: ['s1'],
        // dato heredado/corrupto: un 0 literal en skillGrades, algo que la
        // UI actual ya no puede producir, pero que puede seguir existiendo
        // en registros guardados antes de esta corrección.
        evaluations: [{ studentId: 's1', generalGrade: 8, skillGrades: { grammar: 0 }, strengths: [], areasToImprove: [] }],
      }),
    }),
    lesson({
      id: 'l2',
      form: form({
        studentIds: ['s1'],
        date: '2026-07-15',
        evaluations: [{ studentId: 's1', generalGrade: 8, skillGrades: { grammar: 8 }, strengths: [], areasToImprove: [] }],
      }),
    }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  const grammarNote = data.skillNotes.find((note) => note.skill === 'grammar');
  assert(grammarNote !== undefined, 'debe existir la nota de gramática (la clase l2 sí tiene una nota real)');
  assertEqual(grammarNote!.averageGrade, 8, 'el 0 heredado de l1 se excluye por completo — el promedio es sólo el 8 real de l2, nunca (0+8)/2=4');
});

test('9b) un área sin ninguna nota real (todas 0 o ausentes) nunca aparece en skillNotes', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      form: form({
        studentIds: ['s1'],
        evaluations: [{ studentId: 's1', generalGrade: 8, skillGrades: { grammar: 0 }, strengths: [], areasToImprove: [] }],
      }),
    }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  const grammarNote = data.skillNotes.find((note) => note.skill === 'grammar');
  assert(grammarNote === undefined, 'un área sin ninguna nota real (sólo un 0 heredado) nunca aparece en el informe — ni con promedio 0');
});

test('asistencia: cuenta sólo clases que cuentan como clase (countsAsClass), nunca las canceladas', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', countsAsClass: true, form: form({ studentIds: ['s1'], attendance: [{ studentId: 's1', present: true }] }) }),
    lesson({ id: 'l2', countsAsClass: true, form: form({ studentIds: ['s1'], date: '2026-07-12', attendance: [{ studentId: 's1', present: false }] }) }),
    lesson({ id: 'l3', countsAsClass: false, form: form({ studentIds: ['s1'], date: '2026-07-13', eventType: 'cancelada_con_aviso', attendance: [] }) }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(data.attendance.classesHeld, 2, 'la clase cancelada no cuenta como clase dictada');
  assertEqual(data.attendance.classesAttended, 1, 'sólo una de las dos clases dictadas tuvo presencia real');
  assertEqual(data.attendance.ratePercent, 50, '1 de 2 es 50%');
});

test('sin ninguna clase en el período: todo vacío, nunca lanza', () => {
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: [] });
  assertEqual(data.topicsSeen.length, 0, 'sin temas');
  assertEqual(data.skillNotes.length, 0, 'sin notas por área');
  assertEqual(data.generalAverageGrade, null, 'sin nota general');
  assertEqual(data.attendance.classesHeld, 0, 'sin clases');
  assertEqual(data.attendance.ratePercent, null, 'nunca divide por cero');
});

// Corrección 2026-07-26 (a pedido de Joaquín — "75 min" como duración de
// clase): el reporte debe reflejar la duración real de 75 minutos sin
// redondearla a un valor de la lista vieja (60 o 90), y sumarla
// correctamente a las horas dictadas del período.
test('9. registro pedagógico y reporte: una clase de 75 minutos se refleja exacta en el detalle y suma bien a las horas dictadas', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      countsAsClass: true,
      form: form({
        studentIds: ['s1'],
        attendance: [{ studentId: 's1', present: true }],
        scheduledDurationMinutes: 75,
        actualDurationMinutes: null,
      }),
    }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(data.lessonDetails.length, 1, 'una clase en el detalle');
  assertEqual(data.lessonDetails[0].durationMinutes, 75, 'el detalle de la clase conserva los 75 minutos exactos');
  assertEqual(data.hoursTaught, 1.3, '75 minutos suman 1,3 horas dictadas (75/60 = 1,25, redondeado a un decimal)');
});

test('nunca muta la lista de clases recibida', () => {
  const lessons: SavedLesson[] = [lesson({ id: 'l1', form: form({ studentIds: ['s1'] }) })];
  const snapshot = JSON.stringify(lessons);
  buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(JSON.stringify(lessons), snapshot, 'allLessons no cambia');
});

test('clase grupal: cada alumno tiene su propia asistencia y evaluación, los temas son compartidos', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      form: form({
        studentIds: ['s1', 's2'],
        topics: [{ id: 't1', text: 'Present perfect', status: 'visto' }],
        attendance: [
          { studentId: 's1', present: true },
          { studentId: 's2', present: false },
        ],
        evaluations: [
          { studentId: 's1', generalGrade: 9, skillGrades: {}, strengths: [], areasToImprove: [] },
          { studentId: 's2', generalGrade: 5, skillGrades: {}, strengths: [], areasToImprove: [] },
        ],
      }),
    }),
  ];
  const dataS1 = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  const dataS2 = buildStudentReportData({ studentId: 's2', studentName: 'Beto', period: PERIOD, allLessons: lessons });
  assertEqual(dataS1.attendance.classesAttended, 1, 's1 asistió');
  assertEqual(dataS2.attendance.classesAttended, 0, 's2 no asistió, aunque sea la misma clase');
  assertEqual(dataS1.generalAverageGrade, 9, 'nota propia de s1');
  assertEqual(dataS2.generalAverageGrade, 5, 'nota propia de s2, nunca mezclada con la de s1');
  assertEqual(dataS1.topicsSeen[0], 'Present perfect', 'el tema de la clase grupal aplica a ambos');
  assertEqual(dataS2.topicsSeen[0], 'Present perfect', 'mismo tema también para el otro alumno');
});

test('ausencias: se calculan como clases dictadas menos asistidas', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', countsAsClass: true, form: form({ studentIds: ['s1'], attendance: [{ studentId: 's1', present: true }] }) }),
    lesson({ id: 'l2', countsAsClass: true, form: form({ studentIds: ['s1'], date: '2026-07-12', attendance: [{ studentId: 's1', present: false }] }) }),
    lesson({ id: 'l3', countsAsClass: true, form: form({ studentIds: ['s1'], date: '2026-07-13', attendance: [] }) }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(data.attendance.classesHeld, 3, 'tres clases dictadas');
  assertEqual(data.attendance.classesAttended, 1, 'una sola asistencia real');
  assertEqual(data.attendance.classesAbsent, 2, 'las otras dos cuentan como ausencia (explícita o sin registro)');
});

test('horas reales dictadas: usa la duración real cuando existe, la programada si no se registró', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], scheduledDurationMinutes: 60, actualDurationMinutes: 90 }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s1'], date: '2026-07-12', scheduledDurationMinutes: 45, actualDurationMinutes: null }) }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(data.hoursTaught, 2.3, '90 minutos reales + 45 programados (sin real) = 135 min = 2.25 h, redondeado a 2.3');
});

test('temas vistos y tareas asignadas nunca se duplican aunque se repitan en varias clases', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], topics: [{ id: 't1', text: 'Present perfect', status: 'visto' }], homeworkDescription: 'Ejercicios unidad 3' }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s1'], date: '2026-07-15', topics: [{ id: 't2', text: 'Present perfect', status: 'visto' }], homeworkDescription: 'Ejercicios unidad 3' }) }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(data.topicsSeen.length, 1, 'el mismo tema repetido cuenta una sola vez');
  assertEqual(data.homeworkAssigned.length, 1, 'la misma tarea repetida cuenta una sola vez');
});

test('lessonDetails: una fila por clase dictada, ordenada por fecha, nunca incluye internalNotes ni datos financieros', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      billedAmount: 5000,
      form: form({
        studentIds: ['s1'],
        date: '2026-07-20',
        internalNotes: 'Nota privada de la profesora',
        attendance: [{ studentId: 's1', present: true }],
      }),
    }),
    lesson({
      id: 'l2',
      form: form({ studentIds: ['s1'], date: '2026-07-05', attendance: [{ studentId: 's1', present: false }] }),
    }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(data.lessonDetails.length, 2, 'una fila por clase dictada');
  assertEqual(data.lessonDetails[0].date, '2026-07-05', 'ordenado por fecha ascendente');
  assertEqual(data.lessonDetails[1].date, '2026-07-20', 'la más reciente al final');
  assert(
    !JSON.stringify(data.lessonDetails).includes('Nota privada'),
    'lessonDetails nunca incluye internalNotes'
  );
  assert(!JSON.stringify(data).includes('5000'), 'buildStudentReportData nunca expone billedAmount');
});

test('evidenceCandidates: recopila los adjuntos de las clases del alumno en el período, con su tipo resuelto', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      form: form({
        studentIds: ['s1'],
        activityAttachments: [
          { id: 'a1', name: 'foto.jpg', uri: 'file://foto.jpg', addedAt: '2026-07-10T10:00:00.000Z', kind: 'image' },
          { id: 'a2', name: 'guia.pdf', uri: 'file://guia.pdf', addedAt: '2026-07-10T10:00:00.000Z' },
        ],
      }),
    }),
  ];
  const data = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  assertEqual(data.evidenceCandidates.length, 2, 'ambos adjuntos de la clase aparecen como candidatos');
  const photo = data.evidenceCandidates.find((item) => item.attachmentId === 'a1');
  const pdf = data.evidenceCandidates.find((item) => item.attachmentId === 'a2');
  assertEqual(photo?.kind, 'image', 'la foto se resuelve como image');
  assertEqual(pdf?.kind, 'pdf', 'un adjunto viejo sin kind se resuelve como pdf (compatibilidad)');
});

// ---------------------------------------------------------------------------
// Corrección 2026-07-21 (clase como contenedor, §19 del pedido): pruebas de
// privacidad explícitas entre alumnos de una misma clase compartida — un
// reporte individual nunca debe filtrar nombre, notas, fortalezas, áreas a
// mejorar, asistencia, pagos ni archivos no comunes de otro participante.
// ---------------------------------------------------------------------------

test('privacidad: fortalezas y áreas a mejorar de una clase compartida nunca se mezclan entre alumnos', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      form: form({
        studentIds: ['s1', 's2'],
        evaluations: [
          { studentId: 's1', generalGrade: 9, skillGrades: {}, strengths: ['Fortaleza de Ana'], areasToImprove: ['Mejora de Ana'] },
          { studentId: 's2', generalGrade: 5, skillGrades: {}, strengths: ['Fortaleza de Beto'], areasToImprove: ['Mejora de Beto'] },
        ],
      }),
    }),
  ];
  const dataS1 = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  const dataS2 = buildStudentReportData({ studentId: 's2', studentName: 'Beto', period: PERIOD, allLessons: lessons });
  assertEqual(dataS1.strengths.length, 1, 's1 sólo ve su propia fortaleza');
  assertEqual(dataS1.strengths[0], 'Fortaleza de Ana', 'nunca la de s2');
  assertEqual(dataS1.areasToImprove[0], 'Mejora de Ana', 'nunca la de s2');
  assertEqual(dataS2.strengths[0], 'Fortaleza de Beto', 'nunca la de s1');
  assertEqual(dataS2.areasToImprove[0], 'Mejora de Beto', 'nunca la de s1');
  assert(!JSON.stringify(dataS1).includes('Beto'), 'el reporte de s1 nunca menciona el nombre del otro alumno');
  assert(!JSON.stringify(dataS1).includes('de Beto'), 'el reporte de s1 nunca incluye texto propio de s2');
  assert(!JSON.stringify(dataS2).includes('de Ana'), 'el reporte de s2 nunca incluye texto propio de s1');
});

test('privacidad: notas por área de una clase compartida se calculan sólo con las evaluaciones propias', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      form: form({
        studentIds: ['s1', 's2'],
        evaluations: [
          { studentId: 's1', generalGrade: 10, skillGrades: { grammar: 10 }, strengths: [], areasToImprove: [] },
          { studentId: 's2', generalGrade: 2, skillGrades: { grammar: 2 }, strengths: [], areasToImprove: [] },
        ],
      }),
    }),
  ];
  const dataS1 = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  const grammarS1 = dataS1.skillNotes.find((note) => note.skill === 'grammar');
  assertEqual(grammarS1?.averageGrade, 10, 'la nota de gramática de s1 nunca se promedia con la de s2 (daría 6, no 10)');
});

test('privacidad: un adjunto asignado a un alumno puntual (studentId) nunca aparece en el reporte de otro participante de la misma clase', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      form: form({
        studentIds: ['s1', 's2'],
        activityAttachments: [
          { id: 'a_comun', name: 'guia_comun.pdf', uri: 'file://guia.pdf', addedAt: '2026-07-10T10:00:00.000Z' },
          { id: 'a_s1', name: 'tarea_ana.pdf', uri: 'file://tarea_ana.pdf', addedAt: '2026-07-10T10:00:00.000Z', studentId: 's1' },
          { id: 'a_s2', name: 'tarea_beto.pdf', uri: 'file://tarea_beto.pdf', addedAt: '2026-07-10T10:00:00.000Z', studentId: 's2' },
        ],
      }),
    }),
  ];
  const dataS1 = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  const dataS2 = buildStudentReportData({ studentId: 's2', studentName: 'Beto', period: PERIOD, allLessons: lessons });
  const idsS1 = dataS1.evidenceCandidates.map((item) => item.attachmentId);
  const idsS2 = dataS2.evidenceCandidates.map((item) => item.attachmentId);
  assert(idsS1.includes('a_comun'), 's1 ve el adjunto común');
  assert(idsS1.includes('a_s1'), 's1 ve su propio adjunto individual');
  assert(!idsS1.includes('a_s2'), 's1 nunca ve el adjunto individual de s2');
  assert(idsS2.includes('a_comun'), 's2 también ve el adjunto común');
  assert(idsS2.includes('a_s2'), 's2 ve su propio adjunto individual');
  assert(!idsS2.includes('a_s1'), 's2 nunca ve el adjunto individual de s1');
});

test('privacidad: buildStudentReportData nunca expone datos financieros ni notas internas en ningún campo (barrido completo del objeto)', () => {
  const lessons: SavedLesson[] = [
    lesson({
      id: 'l1',
      billedAmount: 12345,
      form: form({
        studentIds: ['s1', 's2'],
        internalNotes: 'Nota interna privada de la profesora, nunca comunicable',
        evaluations: [
          { studentId: 's1', generalGrade: 8, skillGrades: {}, strengths: [], areasToImprove: [] },
          { studentId: 's2', generalGrade: 4, skillGrades: {}, strengths: [], areasToImprove: [] },
        ],
        attendance: [
          { studentId: 's1', present: true },
          { studentId: 's2', present: false },
        ],
      }),
    }),
  ];
  const dataS1 = buildStudentReportData({ studentId: 's1', studentName: 'Ana', period: PERIOD, allLessons: lessons });
  const serialized = JSON.stringify(dataS1);
  assert(!serialized.includes('12345'), 'nunca expone billedAmount');
  assert(!serialized.includes('Nota interna'), 'nunca expone internalNotes');
  assert(!serialized.includes('"s2"'), 'nunca expone el id del otro participante');
});
