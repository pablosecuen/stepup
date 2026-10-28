// Puerto VERBATIM del original (`src/features/reportes/types/index.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-17: estructura completa del reporte en PDF para
 * padres/alumnos, dejada lista de antemano vía la función de Supabase
 * `generate-student-report` (IA con costo real).
 *
 * Corrección 2026-07-18 (a pedido de Joaquín): esa vía de IA externa NUNCA
 * se conectó a ninguna pantalla — `generateReportNarrative`/
 * `services/generateReportNarrative.ts` siguen existiendo tal cual, sin
 * usarse, para el día que Joaquín decida activarlos. La pestaña Reportes
 * real usa en cambio un borrador DETERMINÍSTICO (`buildDeterministicReportNarrative.ts`,
 * nunca llama a ningún servicio externo, sin costo, funciona sin conexión),
 * que la profesora puede editar libremente antes de generar el PDF. Ver
 * `docs/AI_CONTEXT/06_ROADMAP.md`/`CHANGELOG.md` para el detalle.
 */
export interface StudentReportPeriod {
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string; // YYYY-MM-DD, inclusive
  label: string; // ej. "Julio 2026"
}

export interface StudentReportSkillNote {
  skill: string;
  label: string;
  averageGrade: number;
}

/** Una fila del detalle clase por clase (opcional, activable en la UI). Nunca incluye internalNotes ni datos financieros. */
export interface StudentReportLessonDetail {
  lessonId: string;
  date: string; // YYYY-MM-DD
  present: boolean;
  topicsSeen: string[];
  generalGrade: number | null;
  durationMinutes: number;
}

/** Una foto o PDF adjuntado a una clase del período, candidato a incluirse en el reporte — nunca preseleccionado. */
export interface StudentReportEvidenceCandidate {
  lessonId: string;
  lessonDate: string; // YYYY-MM-DD
  attachmentId: string;
  kind: 'pdf' | 'image';
  name: string;
  uri: string;
  caption?: string;
}

/** Datos objetivos del alumno en el período — todo sale de lo ya cargado en la app, nunca inventado. */
export interface StudentReportData {
  studentId: string;
  studentName: string;
  period: StudentReportPeriod;
  topicsSeen: string[];
  skillNotes: StudentReportSkillNote[];
  generalAverageGrade: number | null;
  strengths: string[];
  areasToImprove: string[];
  homeworkAssigned: string[];
  attendance: {
    classesHeld: number;
    classesAttended: number;
    classesAbsent: number;
    ratePercent: number | null;
  };
  /** Horas reales dictadas (suma de duración real, o programada si no se registró real, de las clases que cuentan). */
  hoursTaught: number;
  lessonDetails: StudentReportLessonDetail[];
  evidenceCandidates: StudentReportEvidenceCandidate[];
  /**
   * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real
   * de clase y puntualidad): siempre se calcula (barato, sin I/O), pero
   * sólo aparece en el PDF si la profesora activa "Puntualidad y
   * asistencia" (`StudentReportBuildOptions.includePunctualitySummary`).
   * Nunca incluye información financiera ni el puntaje de pagos. Opcional
   * para que un snapshot guardado antes de esta fase siga siendo válido.
   */
  punctualityAndAttendance?: StudentReportPunctualitySummary;
}

/** Sólo comportamiento de puntualidad y asistencia — nunca datos financieros. */
export interface StudentReportPunctualitySummary {
  evaluatedClasses: number;
  onTimeOrGracePercent: number | null;
  averageLateMinutes: number | null;
  lateArrivalsCount: number;
  absencesCount: number;
}

/**
 * Las cuatro entradas de texto que la profesora escribe a mano al generar el
 * reporte — nunca inventadas por ningún motor, nunca sacadas de
 * `internalNotes` (privadas, jamás viajan a un reporte para terceros).
 */
export interface StudentReportTeacherNotes {
  generalComment: string;
  behaviorAndParticipation: string;
  nextObjectives: string;
  recommendations: string;
}

/** @deprecated Sólo usado por la vía de IA externa, nunca conectada. Ver comentario de arriba. */
export interface StudentReportBehaviorNote {
  text: string;
}

/** @deprecated Sólo usado por la vía de IA externa, nunca conectada. */
export interface StudentReportNarrativeRequest {
  data: StudentReportData;
  behaviorNote: StudentReportBehaviorNote;
}

/** @deprecated Sólo usado por la vía de IA externa, nunca conectada. */
export interface StudentReportNarrativeResult {
  narrativeText: string;
}

/** Opciones de armado del PDF que la profesora controla desde la vista previa. */
export interface StudentReportBuildOptions {
  includeClassDetail: boolean;
  selectedEvidenceIds: string[];
  /** "Puntualidad y asistencia" — opcional y desactivable, nunca datos financieros. Default: false. */
  includePunctualitySummary?: boolean;
}

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, segunda ronda): reemplaza a
 * `ReportHistoryEntry` — selección de PERÍODO POR MESES (nunca fechas
 * sueltas), título automático, y un snapshot completo para poder
 * regenerar el PDF exactamente igual si el archivo físico desaparece
 * (nunca con datos posteriores).
 */
export const REPORT_RECORD_SCHEMA_VERSION = 1;

export interface ReportRecordSnapshot {
  data: StudentReportData;
  narrativeText: string;
  includeClassDetail: boolean;
  selectedEvidenceIds: string[];
  /** Opcional — un reporte generado antes de esta fase no lo tiene. Default: false. */
  includePunctualitySummary?: boolean;
}

/** Un reporte ya generado, guardado en el historial local y persistente del alumno. */
export interface ReportRecord {
  id: string;
  studentId: string;
  /** Ej. "Informe — julio 2026" / "Informe — mayo a julio 2026" / "Informe — marzo y junio 2026". */
  title: string;
  /** Meses YYYY-MM elegidos, orden ascendente — nunca se infiere del rango de fechas. */
  selectedMonths: string[];
  /** YYYY-MM-DD de la primera clase incluida. */
  periodStart: string;
  /** YYYY-MM-DD de la última clase incluida. */
  periodEnd: string;
  generatedAt: string; // ISO
  /** Ruta en almacenamiento permanente del dispositivo — nunca caché. */
  permanentPdfUri: string;
  /** Todo lo necesario para reconstruir el PDF exacto sin usar datos posteriores. */
  snapshot: ReportRecordSnapshot;
  schemaVersion: number;
}
