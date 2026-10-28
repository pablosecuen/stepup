// Puerto VERBATIM del original (`src/features/reportes/utils/__tests__/buildReportPrompt.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildReportUserMessage, REPORT_SYSTEM_PROMPT } from '../buildReportPrompt.ts';
import type { StudentReportData, StudentReportNarrativeRequest } from '../../types/index.ts';

const EMPTY_DATA: StudentReportData = {
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
};

test('REPORT_SYSTEM_PROMPT prohíbe explícitamente inventar datos y prohíbe listas/markdown', () => {
  assert(REPORT_SYSTEM_PROMPT.includes('Nunca inventes'), 'debe prohibir explícitamente inventar información');
  assert(REPORT_SYSTEM_PROMPT.includes('EXCLUSIVAMENTE en la nota que escribió la profesora'), 'el comportamiento sólo puede basarse en la nota real de la profesora');
  assert(REPORT_SYSTEM_PROMPT.includes('nunca en viñetas ni listas'), 'debe pedir prosa, no listas');
});

test('buildReportUserMessage: sin datos, todo se marca explícitamente como "(sin datos)" — nunca queda vacío en silencio', () => {
  const request: StudentReportNarrativeRequest = { data: EMPTY_DATA, behaviorNote: { text: '' } };
  const message = buildReportUserMessage(request);
  assert(message.includes('(sin datos)'), 'los campos vacíos deben marcarse explícitamente');
  assert(
    message.includes('no menciones comportamiento'),
    'sin nota de comportamiento, el mensaje debe instruir a la IA a no mencionar el tema'
  );
});

test('buildReportUserMessage: con datos reales, todos aparecen tal cual (nunca resumidos ni alterados)', () => {
  const data: StudentReportData = {
    ...EMPTY_DATA,
    topicsSeen: ['Present perfect', 'Phrasal verbs'],
    skillNotes: [{ skill: 'grammar', label: 'Gramática', averageGrade: 7 }],
    generalAverageGrade: 8,
    strengths: ['Buena pronunciación'],
    areasToImprove: ['Escritura'],
    homeworkAssigned: ['Ejercicios unidad 5'],
    attendance: { classesHeld: 4, classesAttended: 3, classesAbsent: 1, ratePercent: 75 },
  };
  const request: StudentReportNarrativeRequest = { data, behaviorNote: { text: 'Muy participativo en clase.' } };
  const message = buildReportUserMessage(request);
  assertEqual(message.includes('Present perfect, Phrasal verbs'), true, 'temas vistos tal cual');
  assertEqual(message.includes('Gramática 7/10'), true, 'nota por área con formato x/10');
  assertEqual(message.includes('Nota general promedio: 8'), true, 'nota general');
  assertEqual(message.includes('Buena pronunciación'), true, 'fortalezas');
  assertEqual(message.includes('3 de 4 clases (75%)'), true, 'asistencia con formato x de y (z%)');
  assertEqual(message.includes('Muy participativo en clase.'), true, 'la nota real de comportamiento de la profesora');
});
