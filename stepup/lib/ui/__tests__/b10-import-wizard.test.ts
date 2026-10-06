import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** B10 — simplificación del asistente de importación: pasos, terminología, riesgos visibles, errores, accesibilidad y alcance. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const WIZARD = "components/backup/import-wizard.tsx";
const UI = "components/backup/import-ui.tsx";
const HISTORY = "components/backup/import-history.tsx";
const ACTIONS = "lib/actions/backup.ts";
const PAGE = "app/(app)/configuracion/respaldo/page.tsx";
const SCREENS = [WIZARD, UI, HISTORY, PAGE];

test("terminología: ninguna pantalla del asistente usa jerga interna ni pluralizaciones «(s)»", () => {
  for (const file of SCREENS) {
    const source = code(file);
    for (const [pattern, why] of [
      [/\bfilas?\b|fila\(s\)/i, "fila(s)"],
      [/componentes?\b|componente\(s\)/i, "componente(s)"],
      [/checksum/i, "checksum"],
      [/versión de esquema|schemaVersion|esquema/i, "versión de esquema"],
      [/\bpreview\b/i, "preview"],
      [/\w\(s\)/, "plural con (s)"],
      [/\bbackup\b/i, "backup (en la pantalla se dice «copia de seguridad»)"],
      [/referencia rota/i, "referencia rota"],
      [/Agregados omitidos|Colecciones fuera/i, "agregados / colecciones"],
    ] as Array<[RegExp, string]>) {
      // Se ignoran los identificadores de código (props, tipos, nombres de estado): sólo cuenta el texto con espacios, entre comillas o en el JSX.
      const visible = [...source.matchAll(/"([^"\n]*)"|`([^`\n]*)`|(?<=[\w"}/)]>)([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "").map((text) => text.replace(/\$\{[^}]*\}/g, "")).filter((text) => /\s/.test(text)).join("\n");
      assert.doesNotMatch(visible, pattern, `${file}: ${why}`);
    }
  }
});

test("ningún id ni nombre interno se dibuja: ni legacyMobileId, ni nombres de tabla, ni tipografía de código para datos", () => {
  const wizard = code(WIZARD);
  assert.doesNotMatch(wizard, /\{[^{}]*legacyMobileId[^{}]*\}\s*<\/|>\s*\{[^{}]*legacyMobileId[^{}]*\}\s*</i, "ningún id de la app móvil en pantalla");
  assert.doesNotMatch(wizard, /TABLE_LABEL|\.tableName\}|componentId\}\s*<|\.reason\}/, "ni nombres de tabla, ni ids, ni motivos crudos");
  assert.doesNotMatch(wizard, /\bfmt\(|JSON\.stringify/, "ningún valor se imprime como JSON");
  assert.doesNotMatch(wizard, /Object\.keys\(.*\)\.join/, "ni claves de columnas");
  assert.match(wizard, /fieldLabel\(tableName, field\)/, "los datos se nombran con su etiqueta");
  assert.match(wizard, /formatFieldValue\(field, diff\.web\)/);
  assert.match(wizard, /translateOmissionReason\(/);
  assert.match(wizard, /describeFinancialMembers\(/);
  assert.match(wizard, /describeMatchSignals\(d\.matchSignals\)/);
  // La única tipografía de código es la palabra de confirmación y el código de soporte.
  assert.equal((wizard.match(/font-mono/g) ?? []).length, 1);
  assert.equal((code(UI).match(/font-mono/g) ?? []).length, 1);
});

test("flujo: tres pasos con indicador, y cada paso lleva el foco a su título", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /type Stage = "idle" \| "analyzing" \| "preview" \| "applying" \| "result";/, "los mismos estados de siempre");
  for (const step of ["<StepIndicator current={1} />", "<StepIndicator current={2} />", "<StepIndicator current={3} />"]) assert.match(wizard, new RegExp(step.replace(/[<>{}/]/g, "\\$&")));
  const ui = code(UI);
  assert.match(ui, /const STEPS = \["Analizar", "Revisar y decidir", "Resultado"\] as const;/);
  assert.match(ui, /aria-current=\{active \? "step" : undefined\}/);
  assert.match(ui, /<nav aria-label="Pasos de la importación">/);
  assert.match(wizard, /<h3 ref=\{ref\} tabIndex=\{-1\}/, "el título del paso recibe el foco");
  assert.match(wizard, /focusOnMount/);
  assert.match(wizard, /focusHeading=\{leftIdle\}/, "al cargar la página no se roba el foco");
  assert.match(wizard, /<LoadingState label=/, "carga anunciada como estado");
  assert.match(code("components/ui/states.tsx"), /role="status" aria-live="polite"/);
});

test("estado inicial: explica qué archivo (ninguno), qué se revisa, qué puede cambiar y cómo volver atrás", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /No elegís ningún archivo\./);
  assert.match(wizard, /última copia de seguridad que tu app móvil subió sola a la nube/);
  assert.match(wizard, /Primero solo se analiza\./);
  assert.match(wizard, /Analizar no cambia nada/);
  assert.match(wizard, /Lo que ya tenés en la web se conserva, salvo que marques que querés reemplazarlo\./);
  assert.match(wizard, /Se puede deshacer, con límites\./);
  assert.match(wizard, /Analizar la última copia/);
  assert.doesNotMatch(wizard, /Analizar último respaldo/);
  const page = code(PAGE);
  assert.match(page, /Por defecto no se reemplaza nada de lo que ya cargaste acá\./);
  assert.doesNotMatch(page, /nunca reemplaza/i, "ya no promete algo que el usuario puede cambiar");
});

test("vocabulario único: agregar, conservar, reemplazar, no importar y deshacer, definidos en pantalla", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /<Glossary \/>/);
  assert.match(wizard, /Cómo leer esta pantalla/);
  const copy = code("lib/backup/import-copy.ts");
  for (const term of ["Agregar", "Conservar", "Reemplazar", "No importar", "Deshacer"]) assert.match(copy, new RegExp(`term: "${term}"`));
  assert.match(copy, /Solo pasa si lo marcás vos\./);
  // Los viejos rótulos ambiguos desaparecen.
  assert.doesNotMatch(wizard, /Se recuperará|vincular|Omitir por ahora|se conserva tal cual/);
});

test("los riesgos siguen a la vista: lo que se reemplaza, lo que no se importa, lo que se duplica y los límites de deshacer", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /Antes de confirmar/);
  assert.match(wizard, /reemplazar \{countOf\(summary\.fieldsToOverride, "dato", "datos"\)\}/);
  assert.match(wizard, /se \{summary\.studentsToLink === 1 \? "une" : "unen"\} con un alumno que ya existía/);
  assert.match(wizard, /como alumno aparte/);
  assert.match(wizard, /Todo lo que ya tenés en la web y no marcaste se conserva sin tocar\./);
  assert.match(wizard, /Notice tone="warning" title="No se importarán"/);
  assert.match(wizard, /Notice tone="danger" title=\{`\$\{countOf\(omitted\.length, "grupo no se importará", "grupos no se importarán"\)\}`\}/);
  assert.match(wizard, /tendrás que cargarlos a mano si hacen falta/);
  assert.match(wizard, /Lo que no se importa en esta versión/);
  assert.match(wizard, /Esta revisión vale \{PREVIEW_VALIDITY_MINUTES\} minutos \(hasta las \{formatInstantTime\(preview\.expiresAt/);
  assert.match(wizard, /Podés deshacer esta importación por un tiempo limitado/);
  assert.match(wizard, /siempre que nada de lo importado se haya modificado ni usado después/);
  // Los avisos llevan ícono y una palabra, no sólo color.
  const ui = code(UI);
  assert.match(ui, /label: "Atención"/);
  assert.match(ui, /label: "Importante"/);
  assert.match(ui, /<span className="sr-only">\{label\}: <\/span>/);
});

test("decisiones: cada una dice qué hace, la opción segura es la de por defecto y las casillas arrancan sin marcar", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /\{ value: "skip", label: "No importar a este alumno por ahora", hint: "No se agrega ni se cambia nada\. Es la opción por defecto\." \}/);
  assert.match(wizard, /\{ value: "link", label: "Es la misma persona: unirlos"/);
  assert.match(wizard, /\{ value: "create_separate", label: "Es otra persona: crear un alumno aparte"/);
  assert.match(wizard, /duplicateDecisions\[d\.backupLegacyMobileId\] \?\? "skip"/);
  assert.match(wizard, /<fieldset[\s\S]*?<legend/, "los grupos de opciones son fieldset con legend");
  assert.match(wizard, /checked=\{selected\.has\(field\)\}/);
  assert.match(wizard, /Marcá solo lo que quieras reemplazar/);
  assert.match(wizard, /legend=\{c\.studentName \? `Alumno: \$\{c\.studentName\}` : "Alumno que ya tenés en la web"\}/, "se dice de qué alumno son las diferencias");
  assert.match(wizard, /<label className="flex items-start gap-3 py-1">\s*<input type="checkbox"/, "la etiqueta envuelve la casilla (objetivo táctil de 44 px)");
});

test("confirmación: misma palabra reforzada, botón deshabilitado hasta escribirla, nombres de botones claros", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /summary\.requiresStrongConfirmation \|\| strongConfirmInput\.trim\(\)\.toUpperCase\(\) === STRONG_CONFIRMATION_PHRASE/);
  assert.match(wizard, /disabled=\{pending \|\| !phraseOk\}/);
  assert.match(wizard, /handleConfirm[\s\S]*?strongConfirmInput\.trim\(\)\.toUpperCase\(\) !== STRONG_CONFIRMATION_PHRASE\) \{\s*return;/, "el manejador sigue defendiéndose solo");
  assert.match(wizard, /aria-describedby="importar-confirmacion-ayuda"/);
  assert.match(wizard, /<label htmlFor="importar-confirmacion"/);
  assert.match(wizard, /Confirmar e importar/);
  assert.match(wizard, /Cancelar \(no se importa nada\)/);
  assert.doesNotMatch(wizard, /Confirmar importación|Cancelar — no se importarán datos/);
  assert.match(wizard, /Cancelar no cambia ningún dato\./);
  assert.match(code("lib/backup/import-preview-mapping.ts"), /export const STRONG_CONFIRMATION_PHRASE = "IMPORTAR";/);
});

test("en curso: «Importando» avisa que no hay que cerrar la página y que, si algo falla, no se importa nada", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /title="Importando tus datos" label="No cierres ni recargues esta página\. Si algo falla, no se importa nada\."/);
  assert.match(wizard, /title="Analizando tu copia de seguridad" label="Esto puede tardar unos segundos\. Todavía no se cambia nada\."/);
});

test("resultado: dice qué se agregó (sin «filas»), si fue una repetición, y qué hacer si algo no salió bien", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /Se agregaron \$\{countOf\(summary\.totalRowsWritten, "elemento", "elementos"\)\}/);
  assert.match(wizard, /formatImportCounts\(summary\.countsByTable\)/);
  assert.match(wizard, /summary\.replayed && <p>Esta importación ya se había aplicado antes: no se repitió ni se duplicó nada\.<\/p>/);
  assert.match(wizard, /No hubo nada para agregar/);
  assert.match(wizard, /¿Algo no salió como esperabas\?/);
  assert.match(wizard, /Revisar si se puede deshacer/);
  assert.match(wizard, /Volver al inicio/);
  assert.doesNotMatch(wizard, /Previsualizar|Deshacer esta importación/);
});

test("deshacer: se revisa antes, se confirma con lo que va a pasar y quitar la opción pide confirmación con su consecuencia", () => {
  const ui = code(UI);
  assert.match(ui, /Se puede deshacer/);
  assert.match(ui, /se quita lo que se agregó y los datos que se reemplazaron\s+vuelven a su valor anterior/);
  assert.match(ui, /Sí, deshacer la importación/);
  assert.match(ui, /No se puede deshacer ahora/);
  assert.match(ui, /ya no vas a poder deshacer esta importación/);
  assert.match(ui, /Lo que importaste se queda tal\s+cual está\./);
  assert.match(ui, /Sí, quitar la opción de deshacer/);
  assert.match(ui, /BUTTON_DANGER_OUTLINE/);
  assert.doesNotMatch(ui + code(WIZARD) + code(HISTORY), /Ya revisé los resultados, no necesito poder deshacer esto|Confirmar deshacer|Previsualizar deshacer/);
  // Wizard e historial usan las MISMAS piezas.
  for (const file of [WIZARD, HISTORY]) assert.match(code(file), /DiscardUndoControl/);
  assert.match(code(HISTORY), /<UndoReviewPanel/);
  assert.match(code(WIZARD), /<UndoReviewPanel/);
  // Tras descartar, la pantalla deja de ofrecer deshacer (antes volvía a mostrar el botón).
  assert.match(code(WIZARD), /setUndoState\(null\);\s*setUndoDiscarded\(true\);/);
  assert.match(code(WIZARD), /undoDiscarded && !undoDone/);
});

test("historial: términos nuevos, estado, vencimiento y botones compartidos", () => {
  const history = code(HISTORY);
  assert.match(history, /countOf\(run\.totalRowsWritten, "elemento importado", "elementos importados"\)/);
  assert.match(history, /app móvil \$\{run\.appVersion\}/);
  assert.match(history, /Ya no se conserva el detalle de la copia, solo este resumen\./);
  assert.match(history, /Ya no se puede deshacer: el detalle necesario se eliminó con el tiempo\./);
  assert.match(history, /El plazo para deshacerla venció\./);
  assert.match(history, /Se puede deshacer hasta el/);
  assert.match(history, /Revisar si se puede deshacer/);
  assert.match(history, /<EmptyState message="Todavía no importaste ningún respaldo\." \/>/);
  assert.match(history, /formatImportCounts\(run\.countsByTable\)/, "los conteos siguen con nombres humanos");
});

test("errores: cada acción devuelve una frase útil y un código de soporte; ningún mensaje interno llega al navegador", () => {
  const actions = code(ACTIONS);
  assert.doesNotMatch(actions, /friendlyError/, "ya no se devuelve el mensaje interno tal cual");
  assert.match(actions, /translateImportError\(domainErrorMessage\(error\), context\)/);
  assert.match(actions, /errorCode\?: string;/);
  assert.equal((actions.match(/return failure\(error, "/g) ?? []).length, 7);
  for (const context of ["analyze", "apply", "undoPreview", "undo", "discard", "history"]) assert.match(actions, new RegExp(`failure\\(error, "${context}"\\)`));
  assert.match(actions, /translateValidationErrors\(validation\.errors\)/);
  assert.doesNotMatch(actions, /validation\.errors\.map\(\(e\) => e\.message\)/, "ya no se unen los mensajes de la validación");
  const ui = code(UI);
  assert.match(ui, /Código para soporte: /);
  assert.match(ui, /role="alert"/);
  assert.match(ui, /select-all font-mono/);
  // Un fallo que nunca salió del navegador (red cortada) también se traduce, con el contexto del paso.
  for (const file of [WIZARD, HISTORY]) assert.match(code(file), /translateImportError\(result\.error \?\? fallback, context\)/);
  assert.match(code(WIZARD), /fail\(result, "Ocurrió un error inesperado\. Intentá de nuevo\.", "apply"\)/);
});

test("accesibilidad: foco en el error, Escape en los paneles, foco devuelto al botón y etiquetas visibles", () => {
  const wizard = code(WIZARD);
  assert.equal((wizard.match(/if \(error\) errorRef\.current\?\.focus\(\);/g) ?? []).length, 3, "idle, revisión y resultado enfocan su error");
  assert.match(wizard, /reviewButtonRef\.current\?\.focus\(\)/);
  assert.match(wizard, /function FocusBox/);
  const ui = code(UI);
  assert.equal((ui.match(/event\.key === "Escape"\) onCancel\(\)|event\.key === "Escape"\) cancel\(\)/g) ?? []).length, 2, "Escape cierra la revisión y la confirmación");
  assert.match(ui, /role="group"\s+aria-label="Revisión para deshacer la importación"/);
  assert.match(ui, /role="group"\s+aria-label="Confirmar que ya no se podrá deshacer"/);
  assert.match(ui, /triggerRef\.current\?\.focus\(\)/);
  assert.match(code(HISTORY), /reviewButtonRef\.current\?\.focus\(\)/);
  // Botones con los estilos compartidos de 44 px; ninguno con padding propio.
  for (const file of [WIZARD, UI, HISTORY]) {
    for (const m of code(file).matchAll(/<button\b[\s\S]*?className=\{?[`"]([^`"]*)[`"]/g)) {
      assert.doesNotMatch(m[1], /\b(px-\d|py-\d)\b/, `${file}: botón con padding propio`);
    }
  }
  assert.match(code(WIZARD), /import \{ BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS \} from "@\/components\/account\/settings-ui";/);
});

test("encabezados: h2 de la página → h3 del paso → h4 de cada sección", () => {
  const wizard = code(WIZARD);
  assert.equal((wizard.match(/<h3\b/g) ?? []).length, 1, "un único h3 (el título del paso)");
  assert.equal((wizard.match(/<h4\b/g) ?? []).length, 3, "secciones, confirmación y deshacer");
  assert.doesNotMatch(wizard, /<h2\b|<h1\b/);
  assert.match(code(PAGE), /<h2 id="respaldo-recuperar"/);
});

test("alcance: la lógica de importar, validar, deshacer y las RPC no cambian", () => {
  const actions = code(ACTIONS);
  // Mismas llamadas, en el mismo orden, con los mismos argumentos.
  assert.match(actions, /const validation = validateBackupPayload\(backup\.payload\);/);
  assert.match(actions, /const result = await previewBackupImport\(\s*ctx,\s*validation\.backup as unknown as Record<string, unknown>,\s*validation\.excludedCollections as unknown as Record<string, unknown>\s*\);/);
  assert.match(actions, /applyBackupImport\(ctx, previewId, fieldOverrides, duplicateDecisions\)/);
  assert.match(actions, /previewUndoBackupImport\(ctx, importRunId\)/);
  assert.match(actions, /applyUndoBackupImport\(ctx, undoPreviewId\)/);
  assert.match(actions, /discardImportUndo\(ctx, importRunId\)/);
  assert.match(actions, /listImportRuns\(ctx\)/);
  const wizard = code(WIZARD);
  assert.match(wizard, /applyImportPreviewAction\(preview\.previewId, fieldOverrides, duplicates\)/);
  assert.match(wizard, /candidateStudentId: decision === "link" \? d\.candidateStudentId : undefined/);
  assert.match(wizard, /previewUndoImportAction\(applyResult\.importRunId\)/);
  assert.match(wizard, /applyUndoImportAction\(undoState\.undoPreviewId\)/);
  assert.match(wizard, /discardImportUndoAction\(applyResult\.importRunId\)/);
  assert.match(wizard, /if \(result\.error \|\| !result\.data\) \{[\s\S]*?return;\s*\}\s*setUndoDone\(true\);/, "sólo se marca deshecho tras la confirmación real del servidor");
  // La frontera de seguridad sigue: nada técnico cruza al navegador.
  assert.doesNotMatch(code("lib/backup/import-preview-mapping.ts"), /candidateFingerprint|candidate_fingerprint:\s*d\./);
  // Ni las migraciones, ni la validación, ni el repositorio se tocaron.
  assert.match(code("lib/backup/validation.ts"), /El backup no es un objeto JSON válido\./);
  assert.match(code("lib/repositories/backup-import.ts"), /rpc\("apply_backup_import"/);
  assert.match(code("lib/repositories/backup-import.ts"), /rpc\("fetch_own_latest_cloud_backup"/);
});
