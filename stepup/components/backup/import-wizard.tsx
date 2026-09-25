"use client";

import { useMemo, useState, useTransition } from "react";
import { analyzeLatestCloudBackupAction, applyImportPreviewAction, previewUndoImportAction, applyUndoImportAction, discardImportUndoAction } from "@/lib/actions/backup";
import type { FieldOverride, DuplicateDecision, PreviewUndoResult, ApplyRunSummary } from "@/lib/repositories/backup-import";
import {
  computeConfirmationSummary,
  STRONG_CONFIRMATION_PHRASE,
  type ImportPreviewDto,
  type FieldDiffMap,
  type AggregateItem,
  type FinancialComponent,
  type SingletonState,
} from "@/lib/backup/import-preview-mapping";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";

// Fase 9 — asistente de importación. Manual, opcional: nada corre solo.
// Cancelar en cualquier paso antes de "Confirmar" = cero escrituras de
// negocio — el único registro que persiste es el preview técnico
// (`import_previews`), que expira solo (30 min) sin tocar nunca datos de
// negocio.

type Stage = "idle" | "analyzing" | "preview" | "applying" | "result";

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length === 0 ? "—" : JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function overrideKey(tableName: string, rowId: string): string {
  return `${tableName}:${rowId}`;
}

// ---------------------------------------------------------------------------
// Sub-componentes de detalle — cada uno muestra TODO lo necesario para
// decidir, nunca obliga a inspeccionar JSON crudo salvo valores de campo
// individuales sin formato propio (fechas/listas), que se listan con `fmt`.
// ---------------------------------------------------------------------------

function FieldDiffEditor({
  tableName,
  rowId,
  fields,
  selected,
  onToggle,
}: {
  tableName: string;
  rowId: string;
  fields: FieldDiffMap;
  selected: Set<string>;
  onToggle: (tableName: string, rowId: string, field: string) => void;
}) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {entries.map(([field, diff]) => (
        <li key={field} className="flex flex-wrap items-center gap-2 text-xs">
          <input type="checkbox" checked={selected.has(field)} onChange={() => onToggle(tableName, rowId, field)} />
          <span className="font-medium">{field}:</span>
          <span className="text-textMuted">web: {fmt(diff.web)}</span>
          <span>→</span>
          <span className="text-textMuted">backup: {fmt(diff.backup)}</span>
        </li>
      ))}
    </ul>
  );
}

function SingletonCard({
  label,
  tableName,
  state,
  selected,
  onToggle,
}: {
  label: string;
  tableName: string;
  state: SingletonState;
  selected: Set<string>;
  onToggle: (tableName: string, rowId: string, field: string) => void;
}) {
  if (!state.presentInBackup) {
    return (
      <p className="text-xs text-textMuted">
        {label}: no viene en este backup.
      </p>
    );
  }
  if (state.status === "insert") {
    return <p className="text-xs text-textMuted">{label}: se creará (no existía en la web todavía).</p>;
  }
  if (state.status === "equal") {
    return <p className="text-xs text-textMuted">{label}: sin cambios (idéntico a la web).</p>;
  }
  return (
    <div className="rounded-md border border-border bg-background p-2.5">
      <p className="text-xs font-medium text-textSecondary">{label}: en conflicto — elegí qué recuperar del backup.</p>
      <FieldDiffEditor tableName={tableName} rowId={state.rowId} fields={Object.fromEntries(
        Object.keys(state.web).map((k) => [k, { web: state.web[k], backup: state.backup[k] }])
      )} selected={selected} onToggle={onToggle} />
    </div>
  );
}

const AGGREGATE_STATUS_LABEL: Record<AggregateItem["status"], string> = {
  insertable: "Se recuperará",
  preserved: "Ya existe en la web — se conserva tal cual",
  omitted_broken_reference: "Omitido — referencia rota",
};

function AggregateList({ title, items }: { title: string; items: AggregateItem[] }) {
  if (items.length === 0) return <p className="text-xs text-textMuted">{title}: ninguno en este backup.</p>;
  const insertable = items.filter((i) => i.status === "insertable").length;
  const preserved = items.filter((i) => i.status === "preserved").length;
  const omitted = items.filter((i) => i.status === "omitted_broken_reference").length;
  return (
    <div>
      <p className="text-xs text-textMuted">
        {title}: {insertable} recuperable(s), {preserved} ya existente(s), {omitted} omitido(s) por referencia rota.
      </p>
      {items.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.legacyMobileId} className="text-xs">
              <span className="font-mono text-textMuted">{item.legacyMobileId}</span> — {AGGREGATE_STATUS_LABEL[item.status]}
              {item.status !== "insertable" && <span className="text-textMuted"> ({item.reason})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TABLE_LABEL: Record<string, string> = {
  payments: "pago",
  payment_charges: "cargo",
  payment_allocations: "asignación",
  payment_adjustments: "ajuste",
  initial_paid_surcharge_corrections: "corrección de recargo inicial",
  first_month_proration_decisions: "prorrateo de primer mes",
  package_purchases: "compra de paquete",
  package_credit_movements: "movimiento de paquete",
};

function FinancialComponentsList({ components }: { components: FinancialComponent[] }) {
  if (components.length === 0) return <p className="text-xs text-textMuted">Cobros: sin componentes financieras en este backup.</p>;
  const insertable = components.filter((c) => c.status === "insertable");
  const omitted = components.filter((c) => c.status === "omitted");
  return (
    <div>
      <p className="text-xs text-textMuted">
        {insertable.length} componente(s) recuperable(s) ({insertable.reduce((s, c) => s + c.members.length, 0)} fila(s) real(es)),{" "}
        {omitted.length} componente(s) omitida(s) completa(s).
      </p>
      {omitted.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-2">
          {omitted.map((c) => (
            <li key={c.componentId} className="rounded-md border border-statusRojo/20 bg-statusRojo/5 p-2 text-xs">
              <p className="font-medium text-statusRojo">Componente omitida — {c.reason}</p>
              <p className="mt-1 text-textMuted">
                Filas involucradas: {c.members.map((m) => `${TABLE_LABEL[m.tableName] ?? m.tableName} ${m.legacyMobileId}`).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {insertable.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs font-medium text-textSecondary">Ver las {insertable.length} componente(s) recuperable(s)</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {insertable.map((c) => (
              <li key={c.componentId} className="text-xs text-textMuted">
                {c.members.map((m) => `${TABLE_LABEL[m.tableName] ?? m.tableName} ${m.legacyMobileId}`).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function BackupImportWizard() {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [selectedFields, setSelectedFields] = useState<Record<string, Set<string>>>({});
  const [duplicateDecisions, setDuplicateDecisions] = useState<Record<string, DuplicateDecision["decision"]>>({});
  const [strongConfirmInput, setStrongConfirmInput] = useState("");
  const [applyResult, setApplyResult] = useState<{ importRunId: string; summary: ApplyRunSummary } | null>(null);
  const [undoState, setUndoState] = useState<PreviewUndoResult | null>(null);
  const [undoDone, setUndoDone] = useState(false);

  const confirmationSummary = useMemo(() => {
    if (!preview) return null;
    const fieldOverridesByRow: Record<string, string[]> = {};
    for (const [key, set] of Object.entries(selectedFields)) {
      if (set.size > 0) fieldOverridesByRow[key] = Array.from(set);
    }
    return computeConfirmationSummary(preview, { fieldOverridesByRow, duplicateDecisions });
  }, [preview, selectedFields, duplicateDecisions]);

  function handleAnalyze() {
    setError(null);
    setStage("analyzing");
    startTransition(async () => {
      const result = await analyzeLatestCloudBackupAction();
      if (result.error || !result.data) {
        setError(result.error ?? "Ocurrió un error inesperado. Intentá de nuevo.");
        setStage("idle");
        return;
      }
      setPreview(result.data.preview);
      setStage("preview");
    });
  }

  function toggleField(tableName: string, rowId: string, field: string) {
    const key = overrideKey(tableName, rowId);
    setSelectedFields((prev) => {
      const next = { ...prev };
      const set = new Set(next[key] ?? []);
      if (set.has(field)) set.delete(field);
      else set.add(field);
      next[key] = set;
      return next;
    });
  }

  function setDuplicateDecision(backupLegacyMobileId: string, decision: DuplicateDecision["decision"]) {
    setDuplicateDecisions((prev) => ({ ...prev, [backupLegacyMobileId]: decision }));
  }

  function handleConfirm() {
    if (!preview || !confirmationSummary) return;
    if (confirmationSummary.requiresStrongConfirmation && strongConfirmInput.trim().toUpperCase() !== STRONG_CONFIRMATION_PHRASE) {
      return;
    }
    setError(null);
    setStage("applying");

    const fieldOverrides: FieldOverride[] = Object.entries(selectedFields)
      .filter(([, fields]) => fields.size > 0)
      .map(([key, fields]) => {
        const separatorIndex = key.indexOf(":");
        return { tableName: key.slice(0, separatorIndex), rowId: key.slice(separatorIndex + 1), fields: Array.from(fields) };
      });

    const duplicates: DuplicateDecision[] = preview.students.duplicates.map((d) => {
      const decision = duplicateDecisions[d.backupLegacyMobileId] ?? "skip";
      return {
        backupLegacyMobileId: d.backupLegacyMobileId,
        decision,
        candidateStudentId: decision === "link" ? d.candidateStudentId : undefined,
      };
    });

    startTransition(async () => {
      const result = await applyImportPreviewAction(preview.previewId, fieldOverrides, duplicates);
      if (result.error || !result.data) {
        setError(result.error ?? "Ocurrió un error inesperado. Intentá de nuevo.");
        setStage("preview");
        return;
      }
      setApplyResult(result.data);
      setStage("result");
    });
  }

  function handlePreviewUndo() {
    if (!applyResult) return;
    setError(null);
    startTransition(async () => {
      const result = await previewUndoImportAction(applyResult.importRunId);
      if (result.error || !result.data) {
        setError(result.error ?? "No pudimos revisar si se puede deshacer. Intentá de nuevo.");
        return;
      }
      setUndoState(result.data);
    });
  }

  function handleApplyUndo() {
    if (!undoState) return;
    setError(null);
    startTransition(async () => {
      const result = await applyUndoImportAction(undoState.undoPreviewId);
      // Sólo se marca deshecho después de una confirmación REAL del
      // servidor — nunca porque la promesa haya terminado sin error.
      if (result.error || !result.data) {
        setError(result.error ?? "No pudimos deshacer la importación. Nada se tocó — intentá de nuevo.");
        return;
      }
      setUndoDone(true);
    });
  }

  function handleDiscardUndo() {
    if (!applyResult) return;
    setError(null);
    startTransition(async () => {
      const result = await discardImportUndoAction(applyResult.importRunId);
      // Corrección real (el descarte antes ignoraba el error y limpiaba el
      // estado igual): si falla, se muestra el error y el undo SIGUE
      // disponible — nunca se oculta la opción de deshacer por un error.
      if (result.error || !result.data) {
        setError(result.error ?? "No pudimos descartar la posibilidad de deshacer. Seguí pudiendo deshacer esta importación.");
        return;
      }
      setUndoState(null);
    });
  }

  function reset() {
    setStage("idle");
    setError(null);
    setPreview(null);
    setSelectedFields({});
    setDuplicateDecisions({});
    setStrongConfirmInput("");
    setApplyResult(null);
    setUndoState(null);
    setUndoDone(false);
  }

  if (stage === "idle") {
    return (
      <div className="flex flex-col gap-3">
        <FormInfoBox>
          Analiza el último respaldo de la nube (subido automáticamente por la app móvil) y te muestra qué se podría
          recuperar — nada se importa hasta que lo confirmes explícitamente.
        </FormInfoBox>
        {error && <FormErrorBox message={error} />}
        <button
          type="button"
          disabled={pending}
          onClick={handleAnalyze}
          className="self-start rounded-md bg-brandBlue px-4 py-2 text-sm font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark disabled:opacity-60"
        >
          Analizar último respaldo
        </button>
      </div>
    );
  }

  if (stage === "analyzing") {
    return <p className="text-sm text-textSecondary">Analizando el respaldo…</p>;
  }

  if (stage === "preview" && preview && confirmationSummary) {
    return (
      <div className="flex flex-col gap-5">
        {error && <FormErrorBox message={error} />}

        <section>
          <h3 className="text-sm font-semibold text-textPrimary">Alumnos</h3>
          <p className="text-xs text-textMuted">
            {preview.students.inserts.length} nuevo(s), {preview.students.equal.length} sin cambios, {preview.students.conflicts.length} en
            conflicto, {preview.students.duplicates.length} posible(s) duplicado(s).
          </p>

          {preview.students.conflicts.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {preview.students.conflicts.map((c) => (
                <div key={c.rowId} className="rounded-md border border-border bg-background p-2.5">
                  <p className="text-xs font-medium text-textSecondary">Alumno existente — elegí qué campos recuperar del backup:</p>
                  <FieldDiffEditor
                    tableName="students"
                    rowId={c.rowId}
                    fields={c.fields}
                    selected={selectedFields[overrideKey("students", c.rowId)] ?? new Set()}
                    onToggle={toggleField}
                  />
                </div>
              ))}
            </div>
          )}

          {preview.students.duplicates.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {preview.students.duplicates.map((d) => (
                <div key={d.backupLegacyMobileId} className="rounded-md border border-statusAmarillo/40 bg-statusAmarillo/5 p-2.5">
                  <p className="text-xs font-medium text-textSecondary">
                    Posible duplicado (coincide por: {d.matchSignals.join(", ")}) — ¿es la misma persona?
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
                    {(["link", "create_separate", "skip"] as const).map((opt) => (
                      <label key={opt} className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name={`dup-${d.backupLegacyMobileId}`}
                          checked={(duplicateDecisions[d.backupLegacyMobileId] ?? "skip") === opt}
                          onChange={() => setDuplicateDecision(d.backupLegacyMobileId, opt)}
                        />
                        {opt === "link" ? "Es la misma persona: vincular" : opt === "create_separate" ? "Es otra persona: crear aparte" : "Omitir por ahora"}
                      </label>
                    ))}
                  </div>
                  {duplicateDecisions[d.backupLegacyMobileId] === "link" && Object.keys(d.fieldDiff).length > 0 && (
                    <div className="mt-1.5 border-t border-border pt-1.5">
                      <FieldDiffEditor
                        tableName="students"
                        rowId={d.candidateStudentId}
                        fields={d.fieldDiff}
                        selected={selectedFields[overrideKey("students", d.candidateStudentId)] ?? new Set()}
                        onToggle={toggleField}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-textPrimary">Niveles personalizados</h3>
          <p className="text-xs text-textMuted">
            {preview.customLevels.inserts.length} nuevo(s), {preview.customLevels.equal.length} sin cambios, {preview.customLevels.conflicts.length} en
            conflicto.
          </p>
          {preview.customLevels.conflicts.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {preview.customLevels.conflicts.map((c) => (
                <div key={c.rowId} className="rounded-md border border-border bg-background p-2.5">
                  <FieldDiffEditor
                    tableName="custom_levels"
                    rowId={c.rowId}
                    fields={c.fields}
                    selected={selectedFields[overrideKey("custom_levels", c.rowId)] ?? new Set()}
                    onToggle={toggleField}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-textPrimary">Configuración de cuenta</h3>
          <div className="mt-1 flex flex-col gap-1.5">
            <SingletonCard
              label="Perfil de profesora"
              tableName="teacher_profiles"
              state={preview.singletons.teacherProfile}
              selected={
                preview.singletons.teacherProfile.presentInBackup && preview.singletons.teacherProfile.status === "conflict"
                  ? (selectedFields[overrideKey("teacher_profiles", preview.singletons.teacherProfile.rowId)] ?? new Set())
                  : new Set()
              }
              onToggle={toggleField}
            />
            <SingletonCard
              label="Distribución 50/30/20"
              tableName="budget_distribution_settings"
              state={preview.singletons.budgetDistribution}
              selected={
                preview.singletons.budgetDistribution.presentInBackup && preview.singletons.budgetDistribution.status === "conflict"
                  ? (selectedFields[overrideKey("budget_distribution_settings", preview.singletons.budgetDistribution.rowId)] ?? new Set())
                  : new Set()
              }
              onToggle={toggleField}
            />
            <p className="text-xs text-textMuted">
              Recargos por atraso: {!preview.insertOnly.surchargeSettings.presentInBackup
                ? "no vienen en este backup."
                : preview.insertOnly.surchargeSettings.status === "insert"
                  ? "se crearán (desactivados por defecto, decisión de producto vigente)."
                  : "ya existen en la web — se conservan tal cual, nunca se sobrescriben."}
            </p>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-textPrimary">Disponibilidad</h3>
          <SingletonCard
            label="Disponibilidad semanal"
            tableName="teacher_availability"
            state={preview.singletons.teacherAvailability}
            selected={
              preview.singletons.teacherAvailability.presentInBackup && preview.singletons.teacherAvailability.status === "conflict"
                ? (selectedFields[overrideKey("teacher_availability", preview.singletons.teacherAvailability.rowId)] ?? new Set())
                : new Set()
            }
            onToggle={toggleField}
          />
        </section>

        <section>
          <h3 className="text-sm font-semibold text-textPrimary">Acuerdos de entrenamiento e historial de nivel</h3>
          <p className="text-xs text-textMuted">
            Acuerdos: {preview.insertOnly.trainingBillingAgreements.inserts.length} nuevo(s), {preview.insertOnly.trainingBillingAgreements.preserved.length} ya
            existente(s) (se conservan tal cual). Historial de nivel: {preview.insertOnly.studentLevelHistory.inserts.length} entrada(s) nueva(s),{" "}
            {preview.insertOnly.studentLevelHistory.preserved.length} ya existente(s).
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-textPrimary">Series, clases y registros</h3>
          <div className="mt-1 flex flex-col gap-1.5">
            <AggregateList title="Series de recurrencia" items={preview.aggregates.recurrenceRules} />
            <AggregateList title="Clases de calendario" items={preview.aggregates.calendarLessons} />
            <AggregateList title="Registros pedagógicos" items={preview.aggregates.lessonRegistrations} />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-textPrimary">Cobros</h3>
          <FinancialComponentsList components={preview.aggregates.financialComponents} />
        </section>

        <section>
          <h3 className="text-sm font-semibold text-textPrimary">Fuera de esta versión</h3>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-textMuted">
            <li>Historial de estados: {preview.excludedCollections.studentStatusHistory.count} entrada(s) — {preview.excludedCollections.studentStatusHistory.reason}</li>
            <li>Historial de precios: {preview.excludedCollections.studentPriceHistory.count} entrada(s) — {preview.excludedCollections.studentPriceHistory.reason}</li>
            <li>
              Historial de edición de registros: {preview.excludedCollections.lessonRegistrationEditHistory.count} entrada(s) —{" "}
              {preview.excludedCollections.lessonRegistrationEditHistory.reason}
            </li>
            <li>Reportes generados: no forman parte del formato de respaldo que se importa — no aplica en esta versión.</li>
          </ul>
        </section>

        <section className="rounded-md border border-border bg-background p-3">
          <h3 className="text-sm font-semibold text-textPrimary">Antes de confirmar</h3>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-textSecondary">
            <li>
              Filas nuevas que se crearán: <strong>{confirmationSummary.rowsToCreate}</strong>
              {confirmationSummary.rowsToCreateIsApproximate ? " (elementos principales — algunas series/clases pueden traer más filas internas no contadas acá)" : ""}
            </li>
            <li>Campos web que se van a reemplazar por el backup: <strong>{confirmationSummary.fieldsToOverride}</strong></li>
            <li>Alumnos que se vincularán a un alumno existente: <strong>{confirmationSummary.studentsToLink}</strong></li>
            <li>Posibles duplicados que se crearán como alumnos separados: <strong>{confirmationSummary.duplicatesToCreateSeparately}</strong></li>
            <li>Agregados omitidos por referencia rota: <strong>{confirmationSummary.aggregatesOmitted}</strong></li>
            <li>Colecciones fuera de esta versión con datos reales: <strong>{confirmationSummary.excludedCollectionsWithData}</strong></li>
          </ul>
          <p className="mt-2 text-xs text-textMuted">
            Por defecto se conserva siempre lo que ya está en la web — nada de lo de arriba se aplica salvo que lo hayas marcado explícitamente.
          </p>

          {confirmationSummary.requiresStrongConfirmation && (
            <div className="mt-3 rounded-md border border-statusAmarillo/40 bg-statusAmarillo/5 p-2.5">
              <label className="flex flex-col gap-1 text-xs font-medium text-textSecondary">
                Elegiste reemplazar datos existentes o crear un alumno pese a una posible coincidencia — escribí{" "}
                <span className="font-mono font-semibold">{STRONG_CONFIRMATION_PHRASE}</span> para confirmar:
                <input
                  type="text"
                  value={strongConfirmInput}
                  onChange={(e) => setStrongConfirmInput(e.target.value)}
                  className="mt-1 rounded-md border border-border px-2 py-1.5 text-sm"
                  placeholder={STRONG_CONFIRMATION_PHRASE}
                />
              </label>
            </div>
          )}
        </section>

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <button
            type="button"
            disabled={
              pending ||
              (confirmationSummary.requiresStrongConfirmation && strongConfirmInput.trim().toUpperCase() !== STRONG_CONFIRMATION_PHRASE)
            }
            onClick={handleConfirm}
            className="rounded-md bg-brandBlue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Confirmar importación
          </button>
          <button type="button" onClick={reset} className="rounded-md border border-border px-4 py-2 text-sm text-textSecondary">
            Cancelar — no se importarán datos
          </button>
          <p className="w-full text-xs text-textMuted">
            Cancelar no escribe ningún dato de negocio. El preview técnico temporal que se generó para mostrarte esta pantalla expira solo en
            30 minutos, sin que tengas que hacer nada más.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "applying") {
    return <p className="text-sm text-textSecondary">Aplicando…</p>;
  }

  if (stage === "result" && applyResult) {
    return (
      <div className="flex flex-col gap-3">
        <FormInfoBox>
          Importación aplicada — {applyResult.summary.totalRowsWritten} fila(s) escrita(s). Podés deshacerla mientras esté disponible; también
          queda en el historial de abajo.
        </FormInfoBox>
        {error && <FormErrorBox message={error} />}

        {!undoState && !undoDone && (
          <button type="button" disabled={pending} onClick={handlePreviewUndo} className="self-start text-xs font-semibold text-statusRojo hover:underline">
            Deshacer esta importación
          </button>
        )}

        {undoState && !undoDone && (
          <div className="rounded-md border border-border bg-background p-2.5">
            {undoState.isSafe ? (
              <>
                <p className="text-xs text-textSecondary">Se puede deshacer de forma segura — nada se editó desde la importación.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={pending} onClick={handleApplyUndo} className="rounded-md bg-statusRojo px-3 py-1.5 text-xs font-semibold text-white">
                    Confirmar deshacer
                  </button>
                  <button type="button" onClick={() => setUndoState(null)} className="rounded-md border border-border px-3 py-1.5 text-xs text-textSecondary">
                    Cancelar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-statusRojo">
                  No se puede deshacer automáticamente: hay datos creados después de la importación que dependen de ella. Nada se tocó.
                </p>
                <ul className="mt-1 flex flex-col gap-1 text-xs text-textMuted">
                  {undoState.unsafeRows.map((r, i) => (
                    <li key={i}>
                      {TABLE_LABEL[r.tableName] ?? r.tableName} {r.rowId ?? ""} — {r.reason}
                      {r.blockingChildren && r.blockingChildren.length > 0 && (
                        <ul className="ml-3 mt-0.5 list-disc">
                          {r.blockingChildren.map((b, j) => (
                            <li key={j}>
                              {TABLE_LABEL[b.tableName] ?? b.tableName} {b.rowId ?? ""}
                              {b.reason ? ` — ${b.reason}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {undoDone && <FormInfoBox>Importación deshecha — tus datos volvieron al estado anterior.</FormInfoBox>}

        {!undoDone && (
          <button type="button" onClick={handleDiscardUndo} className="self-start text-xs font-medium text-textMuted hover:underline">
            Ya revisé los resultados, no necesito poder deshacer esto
          </button>
        )}

        <button type="button" onClick={reset} className="self-start text-xs font-semibold text-brandBlue hover:underline">
          Volver
        </button>
      </div>
    );
  }

  return null;
}
