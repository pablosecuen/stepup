import React, { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/typography';
import { createPhoneExtractionDeps, createPhoneReadDeps } from './phoneExtractionDeps';
import { inspectPhoneFiles, runPhoneExtraction, type ExtractionSummary, type InspectionSummary } from './phoneExtraction/runner';

/**
 * Interruptor de la COPIA. En la primera prueba física está en `false`: la pantalla sólo ofrece «Revisar sin copiar» (lee el teléfono y cuenta; no habla con la cuenta ni sube nada).
 * Se pasa a `true` recién cuando la web ya tiene las migraciones del traslado y la importación confirmada (ver docs/TRASLADO_EXPO_GO_A_WEB.md §17).
 */
const COPY_ENABLED = false;

/**
 * Gancho de SÓLO LECTURA para lanzar la revisión desde la computadora con el depurador de Expo (sin tocar la pantalla): lee el teléfono y devuelve cantidades.
 * No habla con la cuenta ni con la red, no sube, no borra ni cambia nada. La copia no tiene gancho: sigue apagada.
 */
(globalThis as { __tfReview?: () => Promise<InspectionSummary> }).__tfReview = () => inspectPhoneFiles(createPhoneReadDeps());

const MB = 1024 * 1024;
const mb = (bytes: number) => (bytes / MB).toFixed(1);

/**
 * Entrada «Traslado a la web» (se agrega al final de la pantalla de protección de datos). Pantalla TEMPORAL: sólo existe para el traslado.
 * Copia a la cuenta los archivos que viven únicamente en este teléfono (adjuntos de clases, materiales y PDF de reportes). No borra, no mueve y no
 * modifica nada del teléfono. Muestra sólo cantidades: nunca nombres, rutas ni contenido.
 *
 * Siempre se renderiza el <Modal> (con `visible` en falso cuando corresponde): sólo cambia lo de adentro.
 */
export function PhoneTransferEntry() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<ExtractionSummary | null>(null);
  const [inspection, setInspection] = useState<InspectionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review() {
    setBusy(true);
    setError(null);
    setSummary(null);
    setInspection(null);
    setProgress(null);
    try {
      // Sólo lectura del teléfono: no usa la cuenta ni la red; nada se sube, nada se registra, nada se borra ni se cambia.
      setInspection(await inspectPhoneFiles(createPhoneReadDeps()));
    } catch {
      setError('No se pudo completar la revisión. No se cambió nada: podés volver a intentarla.');
    } finally {
      setBusy(false);
    }
  }

  async function run(maxItems?: number, prefer?: string) {
    setBusy(true);
    setError(null);
    setSummary(null);
    setInspection(null);
    setProgress(null);
    try {
      const deps = createPhoneExtractionDeps((done, total) => setProgress({ done, total }));
      if (!deps) {
        setError('La cuenta no está conectada en este teléfono.');
        return;
      }
      setSummary(await runPhoneExtraction(deps, maxItems === undefined ? {} : { maxItems, prefer }));
    } catch {
      setError('No se pudo completar la copia. Podés volver a intentarla: lo que ya se copió no se repite.');
    } finally {
      setBusy(false);
    }
  }

  const total = (k: 'lesson_attachment' | 'material' | 'report_pdf') => summary?.counts[k];

  return (
    <>
      <TouchableOpacity style={styles.entry} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Traslado a la web">
        <Text style={styles.entryText}>Traslado a la web</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.screen}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>Traslado a la web</Text>
            <Text style={styles.body}>
              Esta pantalla copia a tu cuenta los archivos que sólo están en este teléfono: adjuntos de clases, materiales y PDF de reportes. No borra ni cambia nada de lo que tenés acá.
              Mantené la app abierta hasta que termine.
            </Text>
            <TouchableOpacity style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={review} accessibilityRole="button">
              <Text style={styles.buttonText}>0. Revisar sin copiar</Text>
            </TouchableOpacity>
            {COPY_ENABLED && (
              <>
                <TouchableOpacity style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={() => run(1, 'image/heic')} accessibilityRole="button">
                  <Text style={styles.buttonText}>1. Probar con un solo archivo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={() => run()} accessibilityRole="button">
                  <Text style={styles.buttonText}>2. Copiar todo</Text>
                </TouchableOpacity>
              </>
            )}
            {busy && (
              <View style={styles.row}>
                <ActivityIndicator color={colors.brandBlue} />
                <Text style={styles.body}>{progress ? `Copiando ${progress.done} de ${progress.total}…` : 'Preparando…'}</Text>
              </View>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
            {inspection && (
              <View style={styles.result} accessibilityLiveRegion="polite">
                <Text style={styles.resultTitle}>Revisión terminada (no se copió ni se cambió nada)</Text>
                {(['lesson_attachment', 'material', 'report_pdf'] as const).map((k) => {
                  const c = inspection.counts[k];
                  return (
                    <Text key={k} style={styles.body}>
                      {k === 'lesson_attachment' ? 'Adjuntos de clases' : k === 'material' ? 'Materiales con archivo' : 'PDF de reportes'}: {c.total} en total, {c.found} encontrados, {c.notFound} no encontrados en esta revisión. Tamaño medido: {mb(c.actualBytes)} MB (declarado: {mb(c.declaredBytes)} MB); el más grande: {mb(c.largestBytes)} MB.{' '}
                      {c.overLimit} superan el tope de {mb(k === 'report_pdf' ? inspection.limits.reportPdfBytes : inspection.limits.lessonFilesBytes)} MB, {c.sizeMismatch} con tamaño distinto al declarado, {c.unreadable} sin poder leerse.
                    </Text>
                  );
                })}
                <Text style={styles.body}>Formato real de lo encontrado: {Object.entries(inspection.formats).map(([kind, n]) => `${kind} ${n}`).join(', ') || 'ninguno'}.</Text>
                <Text style={styles.body}>
                  Declarados como HEIC: {inspection.declaredHeicActuallyJpeg} son en realidad JPEG y {inspection.actuallyHeic} siguen siendo HEIC. Con formato distinto al declarado: {inspection.labelDiffersFromContent}.
                </Text>
                <Text style={styles.body}>Biblioteca de materiales: {inspection.materialsInLibrary} · Reportes: {inspection.reports}.</Text>
                {inspection.gates.pendingOperations > 0 && <Text style={styles.body}>Hay {inspection.gates.pendingOperations} operación(es) pendiente(s) de facturación.</Text>}
                {inspection.gates.activeClassSession && <Text style={styles.body}>Hay una clase en curso.</Text>}
                {inspection.unreadable.length > 0 && <Text style={styles.body}>{inspection.unreadable.length} dato(s) del teléfono no se pudieron leer como datos válidos.</Text>}
              </View>
            )}
            {summary && (
              <View style={styles.result} accessibilityLiveRegion="polite">
                <Text style={styles.resultTitle}>{summary.trial ? 'Prueba terminada' : summary.complete && summary.missingAtOrigin.length === 0 ? 'Copia completa' : summary.complete ? 'Copia terminada: hay archivos que ya no estaban en el teléfono' : 'Copia terminada con errores'}</Text>
                {(['lesson_attachment', 'material', 'report_pdf'] as const).map((k) => (
                  <Text key={k} style={styles.body}>
                    {k === 'lesson_attachment' ? 'Adjuntos de clases' : k === 'material' ? 'Materiales' : 'PDF de reportes'}: {total(k)?.uploaded ?? 0} copiados, {total(k)?.alreadyThere ?? 0} ya estaban,{' '}
                    {total(k)?.missingAtOrigin ?? 0} ya no estaban en el teléfono (NO se copiaron), {total(k)?.failed ?? 0} con error (sin copiar).
                  </Text>
                ))}
                <Text style={styles.body}>Biblioteca de materiales: {summary.materialsReceived} (nuevos: {summary.materialsInserted}).</Text>
                {summary.gates.pendingOperations > 0 && <Text style={styles.body}>Hay {summary.gates.pendingOperations} operación(es) pendiente(s) de facturación: avisá antes del traslado final.</Text>}
                {summary.gates.activeClassSession && <Text style={styles.body}>Hay una clase en curso: terminala antes del traslado final.</Text>}
                {summary.failed.length > 0 && <Text style={styles.error}>Hay archivos sin copiar: no es una copia completa. Tocá «Copiar todo» otra vez (lo ya copiado no se repite); si siguen con error, avisá.</Text>}
                {summary.missingAtOrigin.length > 0 && <Text style={styles.error}>{summary.missingAtOrigin.length} archivo(s) ya no estaban en el teléfono: quedan declarados como ausentes y NO se trasladaron.</Text>}
              </View>
            )}
            <TouchableOpacity style={styles.close} onPress={() => setOpen(false)} accessibilityRole="button">
              <Text style={styles.closeText}>Cerrar</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  entry: { alignSelf: 'flex-start', paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  entryText: { ...typography.body, color: colors.brandBlue, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.title },
  body: { ...typography.body },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  button: { backgroundColor: colors.brandBlue, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  buttonText: { ...typography.body, color: '#FFFFFF', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  result: { gap: spacing.sm, paddingTop: spacing.md },
  resultTitle: { ...typography.body, fontWeight: '700' },
  error: { ...typography.body, fontWeight: '600' },
  close: { paddingVertical: spacing.md, alignItems: 'center' },
  closeText: { ...typography.body, color: colors.brandBlue, fontWeight: '600' },
});
