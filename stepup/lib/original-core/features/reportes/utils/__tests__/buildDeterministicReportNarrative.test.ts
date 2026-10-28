// Puerto VERBATIM del original (`src/features/reportes/utils/__tests__/buildDeterministicReportNarrative.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildDeterministicReportNarrative } from '../buildDeterministicReportNarrative.ts';
import type { StudentReportData, StudentReportTeacherNotes } from '../../types/index.ts';

const EMPTY_NOTES: StudentReportTeacherNotes = {
  generalComment: '',
  behaviorAndParticipation: '',
  nextObjectives: '',
  recommendations: '',
};

function baseData(overrides: Partial<StudentReportData> = {}): StudentReportData {
  return {
    studentId: 's1',
    studentName: 'Ana',
    period: { startDate: '2026-07-01', endDate: '2026-07-31', label: 'Julio 2026' },
    topicsSeen: [],
    skillNotes: [],
    generalAverageGrade: null,
    strengths: [],
    areasToImprove: [],
    homeworkAssigned: [],
    attendance: { classesHeld: 0, classesAttended: 0, classesAbsent: 0, ratePercent: null },
    hoursTaught: 0,
    lessonDetails: [],
    evidenceCandidates: [],
    ...overrides,
  };
}

test('buildDeterministicReportNarrative: nunca llama IA externa — es puro y determinístico (mismo input, mismo output)', () => {
  const data = baseData({ attendance: { classesHeld: 4, classesAttended: 3, classesAbsent: 1, ratePercent: 75 }, hoursTaught: 4 });
  const first = buildDeterministicReportNarrative(data, EMPTY_NOTES);
  const second = buildDeterministicReportNarrative(data, EMPTY_NOTES);
  assertEqual(first, second, 'la misma entrada siempre da el mismo texto');
});

test('buildDeterministicReportNarrative: reporte vacío nunca lanza y da un texto coherente', () => {
  const data = baseData();
  const text = buildDeterministicReportNarrative(data, EMPTY_NOTES);
  assert(text.includes('Ana'), 'menciona al alumno aunque no haya clases');
  assert(text.length > 0, 'nunca queda vacío');
});

test('buildDeterministicReportNarrative: incluye asistencia, ausencias y horas reales cuando hay clases', () => {
  const data = baseData({
    attendance: { classesHeld: 4, classesAttended: 3, classesAbsent: 1, ratePercent: 75 },
    hoursTaught: 4.5,
  });
  const text = buildDeterministicReportNarrative(data, EMPTY_NOTES);
  assert(text.includes('4'), 'clases dictadas');
  assert(text.includes('3'), 'asistencias');
  assert(text.includes('1') , 'ausencias');
  assert(text.includes('75%'), 'porcentaje de asistencia');
  assert(text.includes('4.5'), 'horas reales dictadas');
});

test('buildDeterministicReportNarrative: incorpora las cuatro notas de la profesora tal cual las escribió', () => {
  const data = baseData();
  const notes: StudentReportTeacherNotes = {
    generalComment: 'Excelente período.',
    behaviorAndParticipation: 'Muy participativo.',
    nextObjectives: 'Reforzar tiempos verbales.',
    recommendations: 'Practicar lectura en casa.',
  };
  const text = buildDeterministicReportNarrative(data, notes);
  assert(text.includes('Excelente período.'), 'comentario general');
  assert(text.includes('Muy participativo.'), 'comportamiento y participación');
  assert(text.includes('Reforzar tiempos verbales.'), 'próximos objetivos');
  assert(text.includes('Practicar lectura en casa.'), 'recomendaciones');
});

test('buildDeterministicReportNarrative: notas vacías no agregan párrafos en blanco', () => {
  const data = baseData();
  const text = buildDeterministicReportNarrative(data, EMPTY_NOTES);
  assert(!text.includes('Comportamiento y participación:'), 'sin nota, no aparece la etiqueta');
  assert(!text.includes('Próximos objetivos:'), 'sin nota, no aparece la etiqueta');
  assert(!text.includes('Recomendaciones:'), 'sin nota, no aparece la etiqueta');
});

test('buildDeterministicReportNarrative: nunca menciona datos financieros ni observaciones internas', () => {
  const data = baseData({ topicsSeen: ['Present perfect'] });
  const text = buildDeterministicReportNarrative(data, EMPTY_NOTES);
  assert(!/deuda|pago|factura|scoring|recargo/i.test(text), 'nunca incluye vocabulario financiero');
});
