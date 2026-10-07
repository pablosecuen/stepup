"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { analyzeLatestCloudBackupAction, applyImportPreviewAction, previewUndoImportAction, applyUndoImportAction, discardImportUndoAction } from "@/lib/actions/backup";
import { guardNetwork } from "@/lib/actions/network-guard";
import type { FieldOverride, DuplicateDecision, ApplyRunSummary } from "@/lib/repositories/backup-import";
import type { UndoBlockedPreview } from "@/lib/backup/undo-blocked-mapping";
import {
  computeConfirmationSummary,
  STRONG_CONFIRMATION_PHRASE,
  type ConfirmationSummary,
  type ImportPreviewDto,
  type FieldDiffMap,
  type AggregateItem,
  type FinancialComponent,
  type SingletonState,
} from "@/lib/backup/import-preview-mapping";
import {
  EXCLUDED_COLLECTION_LABELS,
  EXCLUDED_COLLECTION_REASON,
  IMPORT_SIZE_LIMIT_NOTICE,
  PREVIEW_VALIDITY_MINUTES,
  translateImportError,
  type ImportErrorContext,
  countOf,
  describeCustomLevelDuplicate,
  describeFinancialMembers,
  describeMatchSignals,
  fieldLabel,
  formatFieldValue,
  translateOmissionReason,
} from "@/lib/backup/import-copy";
import { formatImportCounts } from "@/lib/backup/import-count-labels";
import { BUDGET_DISTRIBUTION_FIELD, BUDGET_TABLE, groupBudgetFields, groupedSelection, toggleDistribution } from "@/lib/backup/budget-distribution-fields";
import { formatInstantTime } from "@/lib/format/date-format";
import { LoadingState } from "@/components/ui/states";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "@/components/account/settings-ui";
import { DiscardUndoControl, Glossary, ImportErrorBox, Notice, StepIndicator, UndoReviewPanel } from "@/components/backup/import-ui";

// Asistente de importación (Fase 9, textos simplificados en B10). Manual, opcional: nada corre solo.
// Cancelar en cualquier paso antes de «Confirmar e importar» = cero escrituras de negocio — el único registro que persiste es
// el análisis técnico temporal, que vence solo sin tocar nunca datos de negocio.
// Los pasos son: Analizar → Revisar y decidir → Resultado. La lógica (qué se envía, cuándo, con qué decisiones) es la de siempre;
// acá cambian los textos, el orden visual y la accesibilidad. Ningún nombre de tabla, columna, id ni mensaje interno se muestra.

type Stage = "idle" | "analyzing" | "preview" | "applying" | "result";

export interface BackupSourceInfo {
  createdAtLabel: string;
  appVersion: string | null;
}

function overrideKey(tableName: string, rowId: string): string {
  return `${tableName}:${rowId}`;
}

/** Título del paso: recibe el foco al aparecer (los botones del paso anterior desaparecen) para que el teclado no se pierda. */
function StageHeading({ children, focusOnMount = true }: { children: ReactNode; focusOnMount?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <h3 ref={ref} tabIndex={-1} className="text-base font-semibold text-textPrimary focus:outline-none">
      {children}
    </h3>
  );
}

/** Contenedor que recibe el foco al aparecer: se usa cuando el botón que tenía el foco desaparece (p. ej. al terminar de deshacer). */
function FocusBox({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="focus:outline-none">
      {children}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-titulo`} className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <h4 id={`${id}-titulo`} className="text-sm font-semibold text-textPrimary">
        {title}
      </h4>
      <div className="mt-2 flex flex-col gap-2.5 text-sm text-textSecondary">{children}</div>
    </section>
  );
}

function joinParts(parts: Array<string | null | false>, empty: string): string {
  const shown = parts.filter((p): p is string => Boolean(p));
  return shown.length > 0 ? shown.join(" · ") : empty;
}

// ---------------------------------------------------------------------------
// Sub-componentes de detalle
// ---------------------------------------------------------------------------

/** Datos que se pueden reemplazar: cada uno es una casilla con su nombre y los dos valores; sin marcar = se conserva la web. */
function FieldChoices({
  tableName,
  rowId,
  fields,
  selected,
  onToggle,
  legend,
  hint,
}: {
  tableName: string;
  rowId: string;
  fields: FieldDiffMap;
  selected: Set<string>;
  onToggle: (tableName: string, rowId: string, field: string) => void;
  legend: string;
  hint?: string;
}) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <fieldset className="rounded-md border border-border bg-background p-3.5">
      <legend className="px-1 text-sm font-semibold text-textPrimary">{legend}</legend>
      <p className="mb-1 text-sm text-textMuted">{hint ?? "Marcá solo lo que quieras reemplazar por el dato de la copia. Lo que dejes sin marcar se conserva como está en la web."}</p>
      <ul className="flex flex-col">
        {entries.map(([field, diff]) => (
          <li key={field}>
            <label className="flex items-start gap-3 py-1">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={selected.has(field)} onChange={() => onToggle(tableName, rowId, field)} />
              <span className="min-w-0">
                <span className="block font-medium text-textPrimary">Reemplazar «{fieldLabel(tableName, field)}»</span>
                <span className="block break-words text-textMuted">
                  En la web: {formatFieldValue(field, diff.web)} → En la copia: {formatFieldValue(field, diff.backup)}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function SingletonBlock({
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
  if (!state.presentInBackup) return <p>{label}: no viene en la copia.</p>;
  if (state.status === "insert") return <p>{label}: se agregará (todavía no lo tenés en la web).</p>;
  if (state.status === "equal") return <p>{label}: sin cambios (ya es igual en la web).</p>;
  // Los tres porcentajes del 50/30/20 se muestran (y se reemplazan) como UNA decisión: tienen que sumar 100 juntos.
  const isBudget = tableName === BUDGET_TABLE;
  const fields: FieldDiffMap = isBudget
    ? groupBudgetFields(state.web, state.backup)
    : Object.fromEntries(Object.keys(state.web).map((k) => [k, { web: state.web[k], backup: state.backup[k] }]));
  return (
    <FieldChoices
      tableName={tableName}
      rowId={state.rowId}
      fields={fields}
      selected={isBudget ? groupedSelection(selected) : selected}
      onToggle={onToggle}
      legend={`${label}: tiene diferencias con la web`}
    />
  );
}

function AggregateBlock({ title, items }: { title: string; items: AggregateItem[] }) {
  if (items.length === 0) return <p>{title}: no hay en la copia.</p>;
  const insertable = items.filter((i) => i.status === "insertable").length;
  const preserved = items.filter((i) => i.status === "preserved").length;
  const omitted = items.filter((i) => i.status === "omitted_broken_reference");
  const byReason = new Map<string, number>();
  for (const item of omitted) {
    const reason = translateOmissionReason("reason" in item ? item.reason : null);
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p>
        <span className="font-medium text-textPrimary">{title}:</span>{" "}
        {joinParts(
          [
            insertable > 0 && `${insertable} para agregar`,
            preserved > 0 && `${preserved} ya existe${preserved === 1 ? "" : "n"} (se conserva${preserved === 1 ? "" : "n"})`,
            omitted.length > 0 && `${omitted.length} no se importará${omitted.length === 1 ? "" : "n"}`,
          ],
          "nada para importar",
        )}
      </p>
      {byReason.size > 0 && (
        <Notice tone="warning" title="No se importarán">
          <ul className="list-disc pl-4">
            {[...byReason.entries()].map(([reason, n]) => (
              <li key={reason}>
                {countOf(n, "elemento", "elementos")}: {reason}.
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}

function FinancialBlock({ components }: { components: FinancialComponent[] }) {
  if (components.length === 0) return <p>No hay cobros ni pagos en la copia.</p>;
  const insertable = components.filter((c) => c.status === "insertable");
  const omitted = components.filter((c) => c.status === "omitted");
  const insertableMembers = insertable.flatMap((c) => c.members);
  return (
    <div className="flex flex-col gap-2">
      <p>
        Los cobros, los pagos y sus asignaciones se importan en grupos completos: o entra todo el grupo o no entra ninguna de sus partes.
      </p>
      <p>
        <span className="font-medium text-textPrimary">Para agregar:</span>{" "}
        {insertable.length === 0 ? "ningún grupo" : `${countOf(insertable.length, "grupo", "grupos")} (${describeFinancialMembers(insertableMembers)})`}.
      </p>
      {omitted.length > 0 && (
        <Notice tone="danger" title={`${countOf(omitted.length, "grupo no se importará", "grupos no se importarán")}`}>
          <ul className="list-disc pl-4">
            {omitted.map((c) => (
              <li key={c.componentId}>
                {describeFinancialMembers(c.members) || "Datos de cobros"}: {translateOmissionReason(c.reason)}.
              </li>
            ))}
          </ul>
          <p>Estos cobros y pagos quedan afuera: tendrás que cargarlos a mano si hacen falta.</p>
        </Notice>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paso 1: analizar
// ---------------------------------------------------------------------------

/** Pasos en curso (analizando / importando): el título recibe el foco y el aviso de carga se anuncia como estado. */
export function ProgressStage({ step, title, label }: { step: 1 | 2; title: string; label: string }) {
  return (
    <div className="flex flex-col gap-3">
      <StepIndicator current={step} />
      <StageHeading>{title}</StageHeading>
      <LoadingState label={label} />
    </div>
  );
}

export function IdleStage({ error, errorCode, pending, focusHeading, onAnalyze }: { error: string | null; errorCode: string | null; pending: boolean; focusHeading: boolean; onAnalyze: () => void }) {
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, errorCode]);

  return (
    <div className="flex flex-col gap-4">
      <StepIndicator current={1} />
      <StageHeading focusOnMount={focusHeading}>Qué va a pasar</StageHeading>
      <ul className="flex flex-col gap-2.5 text-sm text-textSecondary">
        <li>
          <strong className="text-textPrimary">No elegís ningún archivo.</strong> Usamos la última copia de seguridad que tu app móvil subió sola a la nube.
        </li>
        <li>
          <strong className="text-textPrimary">Primero solo se analiza.</strong> Analizar no cambia nada: te muestra qué se agregaría, qué ya existe y qué tiene diferencias.
        </li>
        <li>
          <strong className="text-textPrimary">Después decidís vos.</strong> Se importa recién cuando confirmás al final. Lo que ya tenés en la web se conserva, salvo que marques que querés reemplazarlo.
        </li>
        <li>
          <strong className="text-textPrimary">Se puede deshacer, con límites.</strong> Por un tiempo limitado y solo si no cambiaste ni usaste después lo que se importó.
        </li>
        <li>
          <strong className="text-textPrimary">{IMPORT_SIZE_LIMIT_NOTICE.lead}</strong> {IMPORT_SIZE_LIMIT_NOTICE.body}
        </li>
      </ul>
      {error && <ImportErrorBox message={error} code={errorCode} boxRef={errorRef} />}
      <button type="button" disabled={pending} aria-busy={pending} onClick={onAnalyze} className={`self-start ${BUTTON_PRIMARY}`}>
        Analizar la última copia
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paso 2: revisar y decidir
// ---------------------------------------------------------------------------

export interface PreviewStageProps {
  preview: ImportPreviewDto;
  backup: BackupSourceInfo | null;
  summary: ConfirmationSummary;
  selectedFields: Record<string, Set<string>>;
  duplicateDecisions: Record<string, DuplicateDecision["decision"]>;
  strongConfirmInput: string;
  pending: boolean;
  error: string | null;
  errorCode: string | null;
  onToggleField: (tableName: string, rowId: string, field: string) => void;
  onDuplicateDecision: (backupLegacyMobileId: string, decision: DuplicateDecision["decision"]) => void;
  onStrongConfirmChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const DUPLICATE_OPTIONS: ReadonlyArray<{ value: DuplicateDecision["decision"]; label: string; hint: string }> = [
  { value: "skip", label: "No importar a este alumno por ahora", hint: "No se agrega ni se cambia nada. Es la opción por defecto." },
  { value: "link", label: "Es la misma persona: unirlos", hint: "No se crea otro alumno. Podés traer datos de la copia al alumno que ya tenés." },
  { value: "create_separate", label: "Es otra persona: crear un alumno aparte", hint: "Se agrega como un alumno nuevo, aunque se parezca a otro." },
];

function PersonSummary({ heading, person }: { heading: string; person: { name: string; level?: string; status?: string; contactMasked?: string } }) {
  const extra = [person.level, person.status, person.contactMasked].filter(Boolean).join(" · ");
  return (
    <div>
      <dt className="font-semibold text-textPrimary">{heading}</dt>
      <dd className="text-textSecondary">
        {person.name}
        {extra && <span className="block text-textMuted">{extra}</span>}
      </dd>
    </div>
  );
}

export function PreviewStage(props: PreviewStageProps) {
  const { preview, backup, summary, selectedFields, duplicateDecisions, strongConfirmInput, pending, error, errorCode } = props;
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, errorCode]);

  const selectedFor = (tableName: string, rowId: string) => selectedFields[overrideKey(tableName, rowId)] ?? new Set<string>();
  const singletonSelected = (tableName: string, state: SingletonState) =>
    state.presentInBackup && state.status === "conflict" ? selectedFor(tableName, state.rowId) : new Set<string>();

  const phraseOk = !summary.requiresStrongConfirmation || strongConfirmInput.trim().toUpperCase() === STRONG_CONFIRMATION_PHRASE;
  const toDecide =
    preview.students.conflicts.length +
    preview.students.duplicates.length +
    preview.customLevels.conflicts.length +
    [preview.singletons.teacherProfile, preview.singletons.budgetDistribution, preview.singletons.teacherAvailability].filter(
      (s) => s.presentInBackup && s.status === "conflict",
    ).length;
  const sourceLabel = backup ? "Analizamos tu copia del " + backup.createdAtLabel + (backup.appVersion ? " (app móvil " + backup.appVersion + ")" : "") + ". " : "";
  const excluded = Object.entries(EXCLUDED_COLLECTION_LABELS) as Array<[keyof typeof EXCLUDED_COLLECTION_LABELS, string]>;

  return (
    <div className="flex flex-col gap-5">
      <StepIndicator current={2} />

      <div className="flex flex-col gap-2">
        <StageHeading>Revisá lo que se importaría</StageHeading>
        <p className="text-sm text-textSecondary">
          {sourceLabel}Todavía no se cambió nada en la web.
        </p>
        <p className="text-sm text-textMuted">
          Esta revisión vale {PREVIEW_VALIDITY_MINUTES} minutos (hasta las {formatInstantTime(preview.expiresAt, "—")}). Si vence, hay que analizar de nuevo.
        </p>
      </div>

      <Notice tone="info" title="Cómo leer esta pantalla">
        <Glossary />
        <p>
          {toDecide > 0
            ? `Hay ${countOf(toDecide, "cosa", "cosas")} para decidir. Si no tocás nada, se conserva todo lo que ya tenés en la web.`
            : "No hay diferencias para decidir: si no tocás nada, se conserva todo lo que ya tenés en la web."}
        </p>
      </Notice>

      <Section id="alumnos" title="Alumnos">
        <p>
          {joinParts(
            [
              preview.students.inserts.length > 0 && countOf(preview.students.inserts.length, "alumno nuevo para agregar", "alumnos nuevos para agregar"),
              preview.students.equal.length > 0 && countOf(preview.students.equal.length, "ya está igual en la web (se conserva)", "ya están iguales en la web (se conservan)"),
              preview.students.conflicts.length > 0 && countOf(preview.students.conflicts.length, "con diferencias (decidís vos)", "con diferencias (decidís vos)"),
              preview.students.duplicates.length > 0 && countOf(preview.students.duplicates.length, "posible duplicado (decidís vos)", "posibles duplicados (decidís vos)"),
            ],
            "No hay alumnos en la copia.",
          )}
        </p>

        {preview.students.conflicts.map((c) => (
          <FieldChoices
            key={c.rowId}
            tableName="students"
            rowId={c.rowId}
            fields={c.fields}
            selected={selectedFor("students", c.rowId)}
            onToggle={props.onToggleField}
            legend={c.studentName ? `Alumno: ${c.studentName}` : "Alumno que ya tenés en la web"}
            hint="La copia tiene datos distintos a los de la web. Marcá solo lo que quieras reemplazar; lo que dejes sin marcar se conserva como está."
          />
        ))}

        {preview.students.duplicates.map((d) => {
          const decision = duplicateDecisions[d.backupLegacyMobileId] ?? "skip";
          return (
            <fieldset key={d.backupLegacyMobileId} className="rounded-md border border-statusAmarillo/40 bg-statusAmarillo/5 p-3.5">
              <legend className="px-1 text-sm font-semibold text-textPrimary">¿Es la misma persona? {d.backupStudent.name}</legend>
              <p className="mb-2 text-textMuted">En la copia hay un alumno que se parece a uno que ya tenés: coincide {describeMatchSignals(d.matchSignals)}.</p>
              <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <PersonSummary heading="En la copia" person={d.backupStudent} />
                <PersonSummary heading="Ya en la web" person={d.candidateStudent} />
              </dl>
              <div className="mt-3 flex flex-col">
                {DUPLICATE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-start gap-3 py-1">
                    <input
                      type="radio"
                      className="mt-0.5 shrink-0"
                      name={`dup-${d.backupLegacyMobileId}`}
                      checked={decision === opt.value}
                      onChange={() => props.onDuplicateDecision(d.backupLegacyMobileId, opt.value)}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-textPrimary">{opt.label}</span>
                      <span className="block text-textMuted">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {decision === "link" && Object.keys(d.fieldDiff).length > 0 && (
                <div className="mt-2 border-t border-border pt-2">
                  <FieldChoices
                    tableName="students"
                    rowId={d.candidateStudentId}
                    fields={d.fieldDiff}
                    selected={selectedFor("students", d.candidateStudentId)}
                    onToggle={props.onToggleField}
                    legend="Datos que podés traer de la copia al alumno que ya tenés"
                  />
                </div>
              )}
            </fieldset>
          );
        })}
      </Section>

      <Section id="niveles" title="Niveles personalizados">
        <p>
          {joinParts(
            [
              preview.customLevels.inserts.length > 0 && countOf(preview.customLevels.inserts.length, "nivel nuevo para agregar", "niveles nuevos para agregar"),
              preview.customLevels.equal.length > 0 && countOf(preview.customLevels.equal.length, "ya está igual en la web (se conserva)", "ya están iguales en la web (se conservan)"),
              preview.customLevels.conflicts.length > 0 && countOf(preview.customLevels.conflicts.length, "con diferencias (decidís vos)", "con diferencias (decidís vos)"),
              preview.customLevels.duplicates.length > 0 && countOf(preview.customLevels.duplicates.length, "repetido (no se agrega)", "repetidos (no se agregan)"),
            ],
            "No hay niveles personalizados en la copia.",
          )}
        </p>
        {preview.customLevels.duplicates.length > 0 && (
          <Notice tone="info" title="Niveles que no se agregan">
            <ul className="list-disc pl-4">
              {preview.customLevels.duplicates.map((d) => (
                <li key={d.legacyMobileId}>{describeCustomLevelDuplicate(d)}</li>
              ))}
            </ul>
            <p>No hace falta que decidas nada: el nivel que ya tenés se conserva y no se crea otro igual.</p>
          </Notice>
        )}
        {preview.customLevels.conflicts.map((c) => (
          <FieldChoices
            key={c.rowId}
            tableName="custom_levels"
            rowId={c.rowId}
            fields={c.fields}
            selected={selectedFor("custom_levels", c.rowId)}
            onToggle={props.onToggleField}
            legend="Nivel que ya tenés en la web"
          />
        ))}
      </Section>

      <Section id="cuenta" title="Perfil, preferencias y disponibilidad">
        <SingletonBlock
          label="Nombre visible"
          tableName="teacher_profiles"
          state={preview.singletons.teacherProfile}
          selected={singletonSelected("teacher_profiles", preview.singletons.teacherProfile)}
          onToggle={props.onToggleField}
        />
        <SingletonBlock
          label="Distribución 50/30/20"
          tableName="budget_distribution_settings"
          state={preview.singletons.budgetDistribution}
          selected={singletonSelected("budget_distribution_settings", preview.singletons.budgetDistribution)}
          onToggle={props.onToggleField}
        />
        <SingletonBlock
          label="Disponibilidad semanal"
          tableName="teacher_availability"
          state={preview.singletons.teacherAvailability}
          selected={singletonSelected("teacher_availability", preview.singletons.teacherAvailability)}
          onToggle={props.onToggleField}
        />
        <p>
          Recargos por atraso:{" "}
          {!preview.insertOnly.surchargeSettings.presentInBackup
            ? "no vienen en la copia."
            : preview.insertOnly.surchargeSettings.status === "insert"
              ? "se agregarán desactivados (los recargos por atraso están desactivados en TeacherFlow)."
              : "ya existen en la web: se conservan y nunca se reemplazan."}
        </p>
      </Section>

      <Section id="acuerdos" title="Acuerdos de entrenamiento e historial de niveles">
        <p>
          <span className="font-medium text-textPrimary">Acuerdos de entrenamiento:</span>{" "}
          {joinParts(
            [
              preview.insertOnly.trainingBillingAgreements.inserts.length > 0 && `${preview.insertOnly.trainingBillingAgreements.inserts.length} para agregar`,
              preview.insertOnly.trainingBillingAgreements.preserved.length > 0 && `${preview.insertOnly.trainingBillingAgreements.preserved.length} ya existen (se conservan)`,
            ],
            "no hay en la copia",
          )}
          .
        </p>
        <p>
          <span className="font-medium text-textPrimary">Historial de niveles:</span>{" "}
          {joinParts(
            [
              preview.insertOnly.studentLevelHistory.inserts.length > 0 && `${preview.insertOnly.studentLevelHistory.inserts.length} para agregar`,
              preview.insertOnly.studentLevelHistory.preserved.length > 0 && `${preview.insertOnly.studentLevelHistory.preserved.length} ya existen (se conservan)`,
            ],
            "no hay en la copia",
          )}
          .
        </p>
      </Section>

      <Section id="agenda" title="Series, clases y registros">
        <AggregateBlock title="Series de clases" items={preview.aggregates.recurrenceRules} />
        <AggregateBlock title="Clases del calendario" items={preview.aggregates.calendarLessons} />
        <AggregateBlock title="Registros de clases dictadas" items={preview.aggregates.lessonRegistrations} />
      </Section>

      <Section id="cobros" title="Cobros y pagos">
        <FinancialBlock components={preview.aggregates.financialComponents} />
      </Section>

      <Section id="afuera" title="Lo que no se importa en esta versión">
        <ul className="flex flex-col gap-1.5">
          {excluded.map(([key, label]) => {
            const count = preview.excludedCollections[key].count;
            return (
              <li key={key}>
                <span className="font-medium text-textPrimary">{label}:</span>{" "}
                {count > 0 ? `${countOf(count, "entrada", "entradas")}. ${EXCLUDED_COLLECTION_REASON}` : "no hay en la copia."}
              </li>
            );
          })}
          <li>
            <span className="font-medium text-textPrimary">Reportes ya generados:</span> no forman parte de la copia que se importa.
          </li>
        </ul>
      </Section>

      <section aria-labelledby="confirmar-titulo" className="rounded-lg border-2 border-borderStrong bg-surface p-4 shadow-card">
        <h4 id="confirmar-titulo" className="text-base font-semibold text-textPrimary">
          Antes de confirmar
        </h4>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-textSecondary">
          <li>
            Se van a <strong className="text-textPrimary">agregar {summary.rowsToCreateIsApproximate ? "al menos " : ""}{countOf(summary.rowsToCreate, "elemento nuevo", "elementos nuevos")}</strong>.
            {summary.rowsToCreateIsApproximate && " Las series, las clases y los registros traen detalles internos que no se cuentan acá."}
          </li>
          <li>
            {summary.fieldsToOverride > 0 ? (
              <>
                Se van a <strong className="text-textPrimary">reemplazar {countOf(summary.fieldsToOverride, "dato", "datos")}</strong> que ya tenías en la web (los que marcaste).
              </>
            ) : (
              "No se reemplaza ningún dato de los que ya tenés en la web."
            )}
          </li>
          <li>
            {summary.studentsToLink > 0 ? (
              <>
                <strong className="text-textPrimary">{countOf(summary.studentsToLink, "alumno", "alumnos")}</strong> se {summary.studentsToLink === 1 ? "une" : "unen"} con un alumno que ya existía.
              </>
            ) : (
              "Ningún alumno se une con uno que ya existía."
            )}
          </li>
          <li>
            {summary.duplicatesToCreateSeparately > 0 ? (
              <>
                <strong className="text-textPrimary">{countOf(summary.duplicatesToCreateSeparately, "posible duplicado", "posibles duplicados")}</strong> se{" "}
                {summary.duplicatesToCreateSeparately === 1 ? "agrega" : "agregan"} como alumno aparte.
              </>
            ) : (
              "Ningún posible duplicado se agrega como alumno aparte."
            )}
          </li>
          <li>
            {summary.aggregatesOmitted > 0 ? (
              <>
                <strong className="text-textPrimary">{countOf(summary.aggregatesOmitted, "elemento", "elementos")}</strong> no se {summary.aggregatesOmitted === 1 ? "importa" : "importan"} porque dependen de datos que no existen.
              </>
            ) : (
              "No hay elementos que queden afuera por depender de datos que no existen."
            )}
          </li>
          <li>
            {summary.excludedCollectionsWithData > 0 ? (
              <>
                <strong className="text-textPrimary">{countOf(summary.excludedCollectionsWithData, "tipo de historial", "tipos de historial")}</strong> con datos en la copia no se {summary.excludedCollectionsWithData === 1 ? "importa" : "importan"} en esta versión.
              </>
            ) : (
              "No hay historiales con datos que queden afuera."
            )}
          </li>
        </ul>
        <p className="mt-2 text-sm text-textMuted">
          Todo lo que ya tenés en la web y no marcaste se conserva sin tocar. Después de importar podés deshacerlo, por un tiempo limitado y si nada de lo
          importado cambió ni se usó.
        </p>

        {summary.requiresStrongConfirmation && (
          <div className="mt-3">
            <Notice tone="warning" title="Esta importación reemplaza datos o crea alumnos con riesgo de duplicado">
              <label htmlFor="importar-confirmacion" className="block font-medium text-textPrimary">
                Para confirmar, escribí <span className="font-mono font-semibold">{STRONG_CONFIRMATION_PHRASE}</span>
              </label>
              <input
                id="importar-confirmacion"
                type="text"
                autoComplete="off"
                value={strongConfirmInput}
                onChange={(e) => props.onStrongConfirmChange(e.target.value)}
                aria-describedby="importar-confirmacion-ayuda"
                placeholder={STRONG_CONFIRMATION_PHRASE}
                className={`${FIELD_CLASS} max-w-xs`}
              />
              <p id="importar-confirmacion-ayuda" className="text-textMuted">
                Elegiste reemplazar datos que ya tenías o crear un alumno aunque se parece a otro. El botón se habilita al escribir la palabra.
              </p>
            </Notice>
          </div>
        )}

        {error && (
          <div className="mt-3">
            <ImportErrorBox message={error} code={errorCode} boxRef={errorRef} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <button type="button" disabled={pending || !phraseOk} aria-busy={pending} onClick={props.onConfirm} className={BUTTON_PRIMARY}>
            Confirmar e importar
          </button>
          <button type="button" onClick={props.onCancel} className={BUTTON_SECONDARY}>
            Cancelar (no se importa nada)
          </button>
        </div>
        <p className="mt-2 text-sm text-textMuted">
          Cancelar no cambia ningún dato. El análisis temporal se descarta solo a los {PREVIEW_VALIDITY_MINUTES} minutos.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paso 3: resultado
// ---------------------------------------------------------------------------

export interface ResultStageProps {
  summary: ApplyRunSummary;
  error: string | null;
  errorCode: string | null;
  undoState: UndoBlockedPreview | null;
  undoDone: boolean;
  undoDiscarded: boolean;
  pending: boolean;
  onPreviewUndo: () => void;
  onApplyUndo: () => void;
  onCloseUndoReview: () => void;
  onDiscardUndo: () => void;
  onReset: () => void;
}

export function ResultStage(props: ResultStageProps) {
  const { summary, error, errorCode, undoState, undoDone, undoDiscarded, pending } = props;
  const breakdown = formatImportCounts(summary.countsByTable);
  const errorRef = useRef<HTMLDivElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const restoreReviewFocus = useRef(false);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, errorCode]);
  // Al cerrar la revisión de «deshacer», el foco vuelve al botón que la abrió.
  useEffect(() => {
    if (!undoState && restoreReviewFocus.current) {
      restoreReviewFocus.current = false;
      reviewButtonRef.current?.focus();
    }
  }, [undoState]);

  return (
    <div className="flex flex-col gap-4">
      <StepIndicator current={3} />

      {undoDone ? (
        <>
          <StageHeading>Importación deshecha</StageHeading>
          <Notice tone="success" title="Todo volvió a como estaba">
            <p>Se quitó lo que se había agregado y los datos reemplazados volvieron a su valor anterior.</p>
          </Notice>
        </>
      ) : (
        <>
          <StageHeading>Importación completada</StageHeading>
          <Notice tone="success" title={summary.totalRowsWritten > 0 ? `Se agregaron ${countOf(summary.totalRowsWritten, "elemento", "elementos")}` : "No hubo nada para agregar"}>
            {summary.totalRowsWritten === 0 && <p>Todo lo de la copia ya estaba en la web o quedó afuera, así que no se agregó nada.</p>}
            {breakdown && <p>Detalle: {breakdown}.</p>}
            {summary.replayed && <p>Esta importación ya se había aplicado antes: no se repitió ni se duplicó nada.</p>}
            <p>Revisá tus alumnos, el calendario y los cobros. También queda en el historial de importaciones, más abajo.</p>
          </Notice>
        </>
      )}

      {error && <ImportErrorBox message={error} code={errorCode} boxRef={errorRef} />}

      {!undoDone && !undoDiscarded && (
        <section aria-labelledby="deshacer-titulo" className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-4 shadow-card">
          <h4 id="deshacer-titulo" className="text-sm font-semibold text-textPrimary">
            ¿Algo no salió como esperabas?
          </h4>
          <p className="text-sm text-textSecondary">
            Podés deshacer esta importación por un tiempo limitado (el historial muestra hasta cuándo), siempre que nada de lo importado se haya modificado ni usado después.
          </p>
          {!undoState && (
            <button ref={reviewButtonRef} type="button" disabled={pending} aria-busy={pending} onClick={props.onPreviewUndo} className={`self-start ${BUTTON_SECONDARY}`}>
              {pending ? "Revisando…" : "Revisar si se puede deshacer"}
            </button>
          )}
          {undoState && (
            <UndoReviewPanel
              undoState={undoState}
              pending={pending}
              onConfirm={props.onApplyUndo}
              onCancel={() => {
                restoreReviewFocus.current = true;
                props.onCloseUndoReview();
              }}
            />
          )}
          {!undoState && <DiscardUndoControl pending={pending} onDiscard={props.onDiscardUndo} />}
        </section>
      )}

      {undoDiscarded && !undoDone && (
        <FocusBox>
          <Notice tone="info" title="Ya no se puede deshacer">
            <p>Quitaste la opción de deshacer esta importación. Lo que se importó se queda como está.</p>
          </Notice>
        </FocusBox>
      )}

      <button type="button" onClick={props.onReset} className={`self-start ${BUTTON_SECONDARY}`}>
        Volver al inicio
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contenedor: el estado y los manejadores de siempre
// ---------------------------------------------------------------------------

export function BackupImportWizard() {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [backup, setBackup] = useState<BackupSourceInfo | null>(null);
  const [selectedFields, setSelectedFields] = useState<Record<string, Set<string>>>({});
  const [duplicateDecisions, setDuplicateDecisions] = useState<Record<string, DuplicateDecision["decision"]>>({});
  const [strongConfirmInput, setStrongConfirmInput] = useState("");
  const [applyResult, setApplyResult] = useState<{ importRunId: string; summary: ApplyRunSummary } | null>(null);
  const [undoState, setUndoState] = useState<UndoBlockedPreview | null>(null);
  const [undoDone, setUndoDone] = useState(false);
  const [undoDiscarded, setUndoDiscarded] = useState(false);
  const [leftIdle, setLeftIdle] = useState(false);

  const confirmationSummary = useMemo(() => {
    if (!preview) return null;
    const fieldOverridesByRow: Record<string, string[]> = {};
    for (const [key, set] of Object.entries(selectedFields)) {
      if (set.size > 0) fieldOverridesByRow[key] = Array.from(set);
    }
    return computeConfirmationSummary(preview, { fieldOverridesByRow, duplicateDecisions });
  }, [preview, selectedFields, duplicateDecisions]);

  // Un error que llega ya traducido trae su código; uno que nunca salió del navegador (se cortó la red) se traduce acá, con la
  // misma función, según el paso donde ocurrió.
  function fail(result: { error?: string; errorCode?: string }, fallback: string, context: ImportErrorContext) {
    const translated = result.errorCode ? null : translateImportError(result.error ?? fallback, context);
    setError(translated ? translated.message : (result.error ?? fallback));
    setErrorCode(translated ? translated.code : (result.errorCode ?? null));
  }

  function clearError() {
    setError(null);
    setErrorCode(null);
  }

  function handleAnalyze() {
    clearError();
    setLeftIdle(true);
    setStage("analyzing");
    startTransition(async () => {
      const result = await guardNetwork(() => analyzeLatestCloudBackupAction());
      if (result.error || !result.data) {
        fail(result, "Ocurrió un error inesperado. Intentá de nuevo.", "analyze");
        setStage("idle");
        return;
      }
      setPreview(result.data.preview);
      setBackup(result.data.backup);
      setStage("preview");
    });
  }

  function toggleField(tableName: string, rowId: string, field: string) {
    const key = overrideKey(tableName, rowId);
    setSelectedFields((prev) => {
      const next = { ...prev };
      if (tableName === BUDGET_TABLE && field === BUDGET_DISTRIBUTION_FIELD) {
        next[key] = toggleDistribution(next[key] ?? new Set<string>());
        return next;
      }
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
    clearError();
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
      const result = await guardNetwork(() => applyImportPreviewAction(preview.previewId, fieldOverrides, duplicates));
      if (result.error || !result.data) {
        fail(result, "Ocurrió un error inesperado. Intentá de nuevo.", "apply");
        setStage("preview");
        return;
      }
      setApplyResult(result.data);
      setStage("result");
    });
  }

  function handlePreviewUndo() {
    if (!applyResult) return;
    clearError();
    startTransition(async () => {
      const result = await guardNetwork(() => previewUndoImportAction(applyResult.importRunId));
      if (result.error || !result.data) {
        fail(result, "No pudimos revisar si se puede deshacer. Intentá de nuevo.", "undoPreview");
        return;
      }
      setUndoState(result.data);
    });
  }

  function handleApplyUndo() {
    if (!undoState) return;
    clearError();
    startTransition(async () => {
      const result = await guardNetwork(() => applyUndoImportAction(undoState.undoPreviewId));
      // Sólo se marca deshecho después de una confirmación REAL del
      // servidor — nunca porque la promesa haya terminado sin error.
      if (result.error || !result.data) {
        fail(result, "No pudimos deshacer la importación. Nada se tocó — intentá de nuevo.", "undo");
        return;
      }
      setUndoDone(true);
    });
  }

  function handleDiscardUndo() {
    if (!applyResult) return;
    clearError();
    startTransition(async () => {
      const result = await guardNetwork(() => discardImportUndoAction(applyResult.importRunId));
      // Si falla, se muestra el error y el undo SIGUE disponible — nunca se
      // oculta la opción de deshacer por un error.
      if (result.error || !result.data) {
        fail(result, "No pudimos quitar la opción de deshacer. Sigue disponible.", "discard");
        return;
      }
      setUndoState(null);
      setUndoDiscarded(true);
    });
  }

  function reset() {
    setStage("idle");
    clearError();
    setPreview(null);
    setBackup(null);
    setSelectedFields({});
    setDuplicateDecisions({});
    setStrongConfirmInput("");
    setApplyResult(null);
    setUndoState(null);
    setUndoDone(false);
    setUndoDiscarded(false);
  }

  if (stage === "idle") {
    return <IdleStage error={error} errorCode={errorCode} pending={pending} focusHeading={leftIdle} onAnalyze={handleAnalyze} />;
  }

  if (stage === "analyzing") {
    return <ProgressStage step={1} title="Analizando tu copia de seguridad" label="Esto puede tardar unos segundos. Todavía no se cambia nada." />;
  }

  if (stage === "preview" && preview && confirmationSummary) {
    return (
      <PreviewStage
        preview={preview}
        backup={backup}
        summary={confirmationSummary}
        selectedFields={selectedFields}
        duplicateDecisions={duplicateDecisions}
        strongConfirmInput={strongConfirmInput}
        pending={pending}
        error={error}
        errorCode={errorCode}
        onToggleField={toggleField}
        onDuplicateDecision={setDuplicateDecision}
        onStrongConfirmChange={setStrongConfirmInput}
        onConfirm={handleConfirm}
        onCancel={reset}
      />
    );
  }

  if (stage === "applying") {
    return <ProgressStage step={2} title="Importando tus datos" label="No cierres ni recargues esta página. Si algo falla, no se importa nada." />;
  }

  if (stage === "result" && applyResult) {
    return (
      <ResultStage
        summary={applyResult.summary}
        error={error}
        errorCode={errorCode}
        undoState={undoState}
        undoDone={undoDone}
        undoDiscarded={undoDiscarded}
        pending={pending}
        onPreviewUndo={handlePreviewUndo}
        onApplyUndo={handleApplyUndo}
        onCloseUndoReview={() => setUndoState(null)}
        onDiscardUndo={handleDiscardUndo}
        onReset={reset}
      />
    );
  }

  return null;
}
