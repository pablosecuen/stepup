import "server-only";
import * as React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { StudentReportData } from "./student-report-data.ts";

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
  col1: { width: 90 },
  col2: { width: 110 },
  col3: { width: 60 },
  col4: { flex: 1 },
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
}

function ReportDocument(input: ReportPdfInput): React.ReactElement {
  const { data } = input;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{input.title}</Text>
        <Text style={styles.subtitle}>
          {input.studentName} · {input.monthsSummaryLabel} · Generado el {input.generatedAtDateKey}
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
          <Text style={styles.value}>{data.hoursTaught}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Asistencia</Text>
          <Text style={styles.value}>{data.attendance.ratePercent !== null ? `${data.attendance.ratePercent}% (${data.attendance.classesAttended} de ${data.attendance.classesHeld})` : "Sin datos"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Promedio general</Text>
          <Text style={styles.value}>{data.generalAverageGrade ?? "Sin calificar"}</Text>
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
                  <Text style={styles.value}>{s.averageGrade}</Text>
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
                {data.punctuality.averageLateMinutes !== null ? ` (promedio ${data.punctuality.averageLateMinutes} min)` : ""}
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
              <Text style={styles.col3}>Nota</Text>
              <Text style={styles.col4}>Duración</Text>
            </View>
            {data.lessonDetails.map((lesson) => (
              <View style={styles.tableRow} key={lesson.dateKey}>
                <Text style={styles.col1}>{lesson.dateKey}</Text>
                <Text style={styles.col2}>{lesson.attendanceStatus ?? "—"}</Text>
                <Text style={styles.col3}>{lesson.generalGrade ?? "—"}</Text>
                <Text style={styles.col4}>{lesson.durationMinutes} min</Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.footer} fixed>
          TeacherFlow — Reporte generado el {input.generatedAtDateKey}. Uso pedagógico interno.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  return renderToBuffer(<ReportDocument {...input} />);
}
