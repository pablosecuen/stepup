import "server-only";
import * as React from "react";
import { Document, Image, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { StudentReportData } from "./student-report-data.ts";
import { formatCivilDate } from "../format/date-format.ts";
import { formatGrade, formatHours, formatMinutes, formatPercent } from "../format/number-format.ts";
import { ATTENDANCE_STATUS_LABEL, type AttendanceStatus } from "../lessons/attendance.ts";
import type { PreparedEvidence } from "./evidence.ts";

/**
 * Puerto de `buildReportHtml.ts`/`generateReportPdf.ts` (móvil) — el móvil
 * arma HTML y lo convierte a PDF con `expo-print` (mecanismo nativo, sólo
 * disponible en el dispositivo). El servidor Next.js no tiene ese
 * mecanismo — acá se genera un PDF REAL (binario, no HTML con extensión
 * .pdf) con `@react-pdf/renderer`, que corre en Node puro sin necesitar un
 * navegador headless. Mismo contenido/estructura real que el móvil: nunca
 * incluye `individualObservation` (nota interna), teléfono, WhatsApp ni
 * ningún dato financiero — esos campos no forman parte de
 * `StudentReportData` (exclusión estructural, no un filtro que pueda
 * fallar).
 */
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#555555", marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 160, color: "#555555" },
  value: { flex: 1 },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  tableHeader: { flexDirection: "row", borderBottom: "1 solid #cccccc", paddingBottom: 4, marginBottom: 4, fontWeight: 700 },
  tableRow: { flexDirection: "row", paddingVertical: 2, borderBottom: "1 solid #eeeeee" },
  col1: { width: 68 },
  col2: { width: 78 },
  colTopics: { flex: 1, paddingRight: 6 },
  col3: { width: 38 },
  col4: { width: 62 },
  evidenceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  evidenceItem: { width: 150, marginBottom: 6 },
  evidenceImage: { width: 150, height: 150, objectFit: "cover", borderRadius: 4 },
  evidenceCaption: { fontSize: 9, marginTop: 3 },
  evidenceFile: { width: 150, border: "1 solid #cccccc", borderRadius: 4, padding: 6, fontSize: 9, marginBottom: 6 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: "#999999", textAlign: "center" },
});

export interface ReportPdfOptions {
  includeClassDetail: boolean;
  includePunctualitySummary: boolean;
}

export interface ReportPdfInput {
  studentName: string;
  title: string;
  monthsSummaryLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAtDateKey: string;
  data: StudentReportData;
  narrativeText: string;
  options: ReportPdfOptions;
  /** Fotos y PDF elegidos para el reporte (ya preparados). Sin evidencias, el reporte no tiene esa sección. */
  evidence?: PreparedEvidence;
}

function ReportDocument(input: ReportPdfInput): React.ReactElement {
  const { data } = input;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{input.title}</Text>
        <Text style={styles.subtitle}>
          {input.studentName} · {input.monthsSummaryLabel} · Generado el {formatCivilDate(input.generatedAtDateKey)}
        </Text>

        <View style={styles.sectionTitle}>
          <Text>Resumen del período</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Clases dictadas</Text>
          <Text style={styles.value}>{data.classesHeld}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Horas reales dictadas</Text>
          <Text style={styles.value}>{formatHours(data.hoursTaught)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Asistencia</Text>
          <Text style={styles.value}>{data.attendance.ratePercent !== null ? `${formatPercent(data.attendance.ratePercent)} (${data.attendance.classesAttended} de ${data.attendance.classesHeld})` : "Sin datos"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Promedio general</Text>
          <Text style={styles.value}>{data.generalAverageGrade !== null ? formatGrade(data.generalAverageGrade) : "Sin calificar"}</Text>
        </View>

        {data.skillNotes.some((s) => s.averageGrade !== null) && (
          <>
            <View style={styles.sectionTitle}>
              <Text>Habilidades</Text>
            </View>
            {data.skillNotes
              .filter((s) => s.averageGrade !== null)
              .map((s) => (
                <View style={styles.row} key={s.skill}>
                  <Text style={styles.label}>{s.label}</Text>
                  <Text style={styles.value}>{formatGrade(s.averageGrade)}</Text>
                </View>
              ))}
          </>
        )}

        {data.strengths.length > 0 && (
          <>
            <View style={styles.sectionTitle}>
              <Text>Fortalezas</Text>
            </View>
            <Text style={styles.paragraph}>{data.strengths.join(", ")}</Text>
          </>
        )}

        {data.areasToImprove.length > 0 && (
          <>
            <View style={styles.sectionTitle}>
              <Text>Aspectos a mejorar</Text>
            </View>
            <Text style={styles.paragraph}>{data.areasToImprove.join(", ")}</Text>
          </>
        )}

        {data.homeworkAssigned.length > 0 && (
          <>
            <View style={styles.sectionTitle}>
              <Text>Tareas asignadas</Text>
            </View>
            <Text style={styles.paragraph}>{data.homeworkAssigned.join("; ")}</Text>
          </>
        )}

        <View style={styles.sectionTitle}>
          <Text>Comentario</Text>
        </View>
        {input.narrativeText.split("\n\n").map((paragraph, index) => (
          <Text style={styles.paragraph} key={index}>
            {paragraph}
          </Text>
        ))}

        {input.options.includePunctualitySummary && (
          <>
            <View style={styles.sectionTitle}>
              <Text>Puntualidad y asistencia</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Clases a horario</Text>
              <Text style={styles.value}>{data.punctuality.onTimeCount}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Llegadas tarde</Text>
              <Text style={styles.value}>
                {data.punctuality.lateCount}
                {data.punctuality.averageLateMinutes !== null ? ` (promedio ${formatMinutes(data.punctuality.averageLateMinutes)})` : ""}
              </Text>
            </View>
          </>
        )}

        {input.options.includeClassDetail && data.lessonDetails.length > 0 && (
          <>
            <View style={styles.sectionTitle}>
              <Text>Detalle clase por clase</Text>
            </View>
            <View style={styles.tableHeader}>
              <Text style={styles.col1}>Fecha</Text>
              <Text style={styles.col2}>Asistencia</Text>
              <Text style={styles.colTopics}>Temas</Text>
              <Text style={styles.col3}>Nota</Text>
              <Text style={styles.col4}>Duración</Text>
            </View>
            {data.lessonDetails.map((lesson, index) => (
              <View style={styles.tableRow} key={`${lesson.dateKey}-${index}`}>
                <Text style={styles.col1}>{formatCivilDate(lesson.dateKey)}</Text>
                <Text style={styles.col2}>{lesson.attendanceStatus ? (ATTENDANCE_STATUS_LABEL[lesson.attendanceStatus as AttendanceStatus] ?? "—") : "—"}</Text>
                <Text style={styles.colTopics}>{(lesson.topicsSeen ?? []).length > 0 ? (lesson.topicsSeen ?? []).join(", ") : "—"}</Text>
                <Text style={styles.col3}>{formatGrade(lesson.generalGrade)}</Text>
                <Text style={styles.col4}>{lesson.durationMinutes > 0 ? formatMinutes(lesson.durationMinutes) : "—"}</Text>
              </View>
            ))}
          </>
        )}

        {input.evidence && (input.evidence.images.length > 0 || input.evidence.files.length > 0) && (
          <>
            {/* El título no queda solo al pie de una página con las fotos en la siguiente: pide lugar para la primera fila de fotos. */}
            <View style={styles.sectionTitle} minPresenceAhead={170}>
              <Text>Evidencias y materiales</Text>
            </View>
            <View style={styles.evidenceGrid}>
              {input.evidence.images.map((image) => (
                <View style={styles.evidenceItem} key={image.attachmentId} wrap={false}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- el <Image> de @react-pdf no es un <img> de HTML: el PDF no admite texto alternativo; la descripción va debajo. */}
                  <Image style={styles.evidenceImage} src={{ data: Buffer.from(image.jpeg), format: "jpg" }} />
                  {image.caption && <Text style={styles.evidenceCaption}>{image.caption}</Text>}
                </View>
              ))}
              {input.evidence.files.map((file, index) => (
                <View style={styles.evidenceFile} key={`${file.name}-${index}`} wrap={false}>
                  <Text>
                    {file.kind === "pdf" ? "" : "Foto no disponible: "}
                    {file.name} — {formatCivilDate(file.dateKey)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.footer} fixed>
          TeacherFlow — Reporte generado el {formatCivilDate(input.generatedAtDateKey)}. Uso pedagógico interno.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  return renderToBuffer(<ReportDocument {...input} />);
}
