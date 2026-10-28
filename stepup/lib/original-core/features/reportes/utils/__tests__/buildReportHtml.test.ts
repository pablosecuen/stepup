// Puerto VERBATIM del original (`src/features/reportes/utils/__tests__/buildReportHtml.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildReportHtml } from '../buildReportHtml.ts';
import type { StudentReportData } from '../../types/index.ts';

const DATA: StudentReportData = {
  studentId: 's1',
  studentName: 'Ana <Torres>',
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

test('buildReportHtml: escapa el nombre del alumno (nunca inyecta HTML crudo)', () => {
  const html = buildReportHtml(DATA, 'Un párrafo cualquiera.');
  assert(!html.includes('Ana <Torres>'), 'el nombre crudo con < no debe aparecer sin escapar');
  assert(html.includes('Ana &lt;Torres&gt;'), 'el nombre debe estar escapado');
});

test('buildReportHtml: cada párrafo separado por línea en blanco se convierte en su propio <p>', () => {
  const html = buildReportHtml(DATA, 'Primer párrafo.\n\nSegundo párrafo.');
  assertEqual((html.match(/<p>/g) ?? []).length, 2, 'dos párrafos de texto → dos <p>');
  assert(html.includes('<p>Primer párrafo.</p>'), 'primer párrafo íntegro');
  assert(html.includes('<p>Segundo párrafo.</p>'), 'segundo párrafo íntegro');
});

test('buildReportHtml: incluye el período visible', () => {
  const html = buildReportHtml(DATA, 'Texto.');
  assert(html.includes('Julio 2026'), 'el período debe aparecer en el PDF');
});

test('buildReportHtml: reporte vacío (sin clases) nunca lanza y genera un HTML válido', () => {
  const html = buildReportHtml(DATA, 'Sin clases registradas en el período.');
  assert(html.includes('<!doctype html>'), 'siempre produce un documento HTML completo');
  assert(html.includes('Ana'), 'incluye al alumno aunque no haya datos');
});

test('buildReportHtml: "Incluir detalle clase por clase" desactivado no muestra la tabla', () => {
  const data: StudentReportData = {
    ...DATA,
    lessonDetails: [{ lessonId: 'l1', date: '2026-07-05', present: true, topicsSeen: ['Tema'], generalGrade: 8, durationMinutes: 60 }],
  };
  const html = buildReportHtml(data, 'Texto.', { includeClassDetail: false, selectedEvidenceIds: [] });
  assert(!html.includes('Detalle clase por clase'), 'sin la opción activada, no debe aparecer la sección');
});

test('buildReportHtml: "Incluir detalle clase por clase" activado sí muestra la tabla', () => {
  const data: StudentReportData = {
    ...DATA,
    lessonDetails: [{ lessonId: 'l1', date: '2026-07-05', present: true, topicsSeen: ['Tema'], generalGrade: 8, durationMinutes: 60 }],
  };
  const html = buildReportHtml(data, 'Texto.', { includeClassDetail: true, selectedEvidenceIds: [] });
  assert(html.includes('Detalle clase por clase'), 'con la opción activada, debe aparecer la sección');
  assert(html.includes('05/07/2026'), 'la fecha se muestra en formato día/mes/año');
});

test('buildReportHtml: sólo incluye las evidencias seleccionadas a mano, nunca todas', () => {
  const data: StudentReportData = {
    ...DATA,
    evidenceCandidates: [
      { lessonId: 'l1', lessonDate: '2026-07-05', attachmentId: 'a1', kind: 'image', name: 'foto.jpg', uri: 'file://foto.jpg' },
      { lessonId: 'l1', lessonDate: '2026-07-05', attachmentId: 'a2', kind: 'pdf', name: 'guia.pdf', uri: 'file://guia.pdf' },
    ],
  };
  const htmlNone = buildReportHtml(data, 'Texto.', { includeClassDetail: false, selectedEvidenceIds: [] });
  assert(!htmlNone.includes('foto.jpg') && !htmlNone.includes('guia.pdf'), 'sin selección, ninguna evidencia aparece');

  const htmlOnlyPhoto = buildReportHtml(data, 'Texto.', { includeClassDetail: false, selectedEvidenceIds: ['a1'] });
  assert(htmlOnlyPhoto.includes('file://foto.jpg'), 'la foto seleccionada aparece como imagen');
  assert(!htmlOnlyPhoto.includes('guia.pdf'), 'el PDF no seleccionado no aparece');
});

test('buildReportHtml: un PDF adjunto muestra sólo nombre y fecha, nunca su contenido', () => {
  const data: StudentReportData = {
    ...DATA,
    evidenceCandidates: [
      { lessonId: 'l1', lessonDate: '2026-07-05', attachmentId: 'a2', kind: 'pdf', name: 'guia.pdf', uri: 'file://guia.pdf' },
    ],
  };
  const html = buildReportHtml(data, 'Texto.', { includeClassDetail: false, selectedEvidenceIds: ['a2'] });
  assert(html.includes('guia.pdf'), 'muestra el nombre del PDF');
  assert(html.includes('05/07/2026'), 'muestra la fecha de la clase');
  assert(!html.includes('file://guia.pdf'), 'nunca intenta embeber el PDF como imagen');
});

test('buildReportHtml: "Puntualidad y asistencia" con 0 clases evaluadas nunca muestra la tabla con ceros', () => {
  // Corrección 2026-07-18 (a pedido de Joaquín, cuarta ronda): si nunca se
  // usó el seguimiento en vivo, mostrar "Llegadas tarde: 0" se leería como
  // una afirmación falsa ("nunca llegó tarde") sin ningún dato real detrás.
  const data: StudentReportData = {
    ...DATA,
    punctualityAndAttendance: {
      evaluatedClasses: 0,
      onTimeOrGracePercent: null,
      averageLateMinutes: null,
      lateArrivalsCount: 0,
      absencesCount: 3,
    },
  };
  const html = buildReportHtml(data, 'Texto.', { includeClassDetail: false, selectedEvidenceIds: [], includePunctualitySummary: true });
  assert(html.includes('No hay registros suficientes de puntualidad.'), 'debe mostrar la frase exacta pedida');
  assert(!html.includes('Llegadas tarde'), 'nunca debe mostrar la tabla (ni sus ceros) sin datos reales');
  assert(!html.includes('Ausencias'), 'la fila de ausencias tampoco debe aparecer junto a ceros de puntualidad inventados');
});

test('buildReportHtml: "Puntualidad y asistencia" con clases evaluadas reales sí muestra la tabla completa', () => {
  const data: StudentReportData = {
    ...DATA,
    punctualityAndAttendance: {
      evaluatedClasses: 5,
      onTimeOrGracePercent: 80,
      averageLateMinutes: 4.5,
      lateArrivalsCount: 1,
      absencesCount: 0,
    },
  };
  const html = buildReportHtml(data, 'Texto.', { includeClassDetail: false, selectedEvidenceIds: [], includePunctualitySummary: true });
  assert(!html.includes('No hay registros suficientes de puntualidad.'), 'con datos reales no debe mostrar el mensaje de "sin registros"');
  assert(html.includes('Clases evaluadas'), 'con datos reales sí debe mostrar la tabla completa');
  assert(html.includes('80%'), 'porcentaje real dentro de tolerancia');
});

test('buildReportHtml: escapa el nombre de un adjunto con caracteres HTML', () => {
  const data: StudentReportData = {
    ...DATA,
    evidenceCandidates: [
      { lessonId: 'l1', lessonDate: '2026-07-05', attachmentId: 'a2', kind: 'pdf', name: '<script>guia</script>.pdf', uri: 'file://guia.pdf' },
    ],
  };
  const html = buildReportHtml(data, 'Texto.', { includeClassDetail: false, selectedEvidenceIds: ['a2'] });
  assert(!html.includes('<script>guia</script>'), 'nunca inyecta el nombre crudo');
  assert(html.includes('&lt;script&gt;'), 'el nombre debe estar escapado');
});
