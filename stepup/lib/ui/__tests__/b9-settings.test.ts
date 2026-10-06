import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** B9 — reorganización de Configuración: estructura, jerarquía, acciones sensibles, textos y comportamiento preservado. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PAGE = "app/(app)/configuracion/page.tsx";
const VIEW = "components/account/configuration-view.tsx";
const BACKUP_PAGE = "app/(app)/configuracion/respaldo/page.tsx";
const ACCOUNT_FILES = [
  "components/account/active-session-card.tsx",
  "components/account/budget-distribution-form.tsx",
  "components/account/change-password-button.tsx",
  "components/account/delete-account-button.tsx",
  "components/account/settings-ui.tsx",
  "components/account/teacher-profile-form.tsx",
];

/** Etiquetas JSX de apertura completas; respeta llaves y comillas dentro de los atributos (y el `=>` de las flechas). */
function openingTags(source: string, name: string): string[] {
  const result: string[] = [];
  const re = new RegExp(`<${name}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 0;
    let quote: string | null = null;
    for (let i = m.index; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0 && source[i - 1] !== "=") {
        result.push(source.slice(m.index, i + 1));
        break;
      }
    }
  }
  return result;
}

/** Contenido (JSX) de cada `<SettingsSection …>…</SettingsSection>` de la página, en orden. */
function sections(): Array<{ id: string; tone: string; body: string }> {
  return [...code(VIEW).matchAll(/<SettingsSection\b([\s\S]*?)>\s*([\s\S]*?)<\/SettingsSection>/g)].map((m) => ({
    id: /id="([^"]+)"/.exec(m[1])?.[1] ?? "",
    tone: /tone="([^"]+)"/.exec(m[1])?.[1] ?? "default",
    body: m[2],
  }));
}

test("estructura: Cuenta → Preferencias → Sesión y datos → Acciones sensibles, con un índice que apunta a cada sección", () => {
  const found = sections();
  assert.deepEqual(
    found.map((s) => s.id),
    ["cuenta", "preferencias", "sesion-y-datos", "acciones-sensibles"],
  );
  const index = [...code(VIEW).matchAll(/\{ id: "([^"]+)", label: "([^"]+)" \}/g)].map((m) => m[1]);
  assert.deepEqual(index, found.map((s) => s.id), "el índice enlaza a todas las secciones, en el mismo orden");
  assert.match(code(VIEW), /<SettingsIndex items=\{SECTIONS\} \/>/);

  const ui = code("components/account/settings-ui.tsx");
  assert.match(ui, /<nav aria-label="Secciones de Configuración"/);
  assert.match(ui, /<section id=\{id\} aria-labelledby=\{`\$\{id\}-titulo`\} className="scroll-mt-20">/, "cada sección es una región con su título y no queda tapada por el encabezado fijo");
  assert.match(ui, /<h2 id=\{`\$\{id\}-titulo`\}/, "el título de cada sección es un h2");
  assert.match(ui, /<h3 className="text-sm font-semibold text-textPrimary">\{title\}<\/h3>/, "el título de cada fila es un h3");
});

test("las acciones sensibles están juntas, al final, con tono de peligro, y ninguna otra sección las contiene", () => {
  const found = sections();
  const danger = found[found.length - 1];
  assert.equal(danger.id, "acciones-sensibles");
  assert.equal(danger.tone, "danger");
  assert.match(danger.body, /<EndActiveSessionControl session=\{session\} \/>/);
  assert.match(danger.body, /<DeleteAccountButton \/>/);
  for (const normal of found.slice(0, -1)) {
    assert.doesNotMatch(normal.body, /EndActiveSessionControl|DeleteAccountButton|BUTTON_DANGER/, `${normal.id} no mezcla acciones sensibles`);
  }
  assert.equal(found.filter((s) => s.tone === "danger").length, 1, "una única zona sensible");
});

test("Cerrar sesión vive sólo en el menú de cuenta: nada de Configuración lo ofrece ni importa la acción", () => {
  for (const file of [PAGE, VIEW, BACKUP_PAGE, ...ACCOUNT_FILES]) {
    const source = code(file);
    assert.doesNotMatch(source, /signOutAction|requestSignOut|auth\/actions/, `${file} no cierra sesión`);
    assert.doesNotMatch(source, />\s*Cerrar sesión\s*</, `${file} no muestra «Cerrar sesión»`);
  }
  const menu = code("components/nav/account-menu.tsx");
  assert.match(menu, /Cerrar sesión/);
  assert.match(menu, /requestSignOut\(\)/);
});

test("textos: sin repeticiones entre título, descripción y formulario; el aviso del 50/30/20 aparece una sola vez", () => {
  const all = [PAGE, VIEW, ...ACCOUNT_FILES].map((f) => code(f)).join("\n");
  assert.equal((all.match(/Presupuesto sugerido/g) ?? []).length, 1, "el aviso orientativo vive en una sola fila");
  assert.doesNotMatch(all, /Presupuesto sugerido sobre lo cobrado/);
  assert.equal((all.match(/Nombre visible en la app/g) ?? []).length, 0, "el título «Nombre visible en la app» ya no se repite");
  assert.doesNotMatch(all, /Perfil de la profesora|Gestionar disponibilidad →|Gestionar desde Alumnos →|Recuperar datos del respaldo →/, "sin flechas de texto: el renglón entero es el enlace");
  assert.match(code(VIEW), /Los recargos por atraso están desactivados\. El semáforo de mora usa plazos fijos\./, "dice la verdad sobre los recargos (B3)");
  assert.match(code(VIEW), /nunca conoce tus gastos ni tu ahorro bancario real/, "lenguaje orientativo del 50/30/20");
  assert.doesNotMatch(code(VIEW), />\s*\{[^}]*(deviceId|generation|checksum)/i, "ningún dato técnico en pantalla");
});

test("comportamiento preservado: las mismas acciones, los mismos destinos y la misma confirmación fuerte", () => {
  assert.match(code("components/account/teacher-profile-form.tsx"), /useGuardedActionState\(saveTeacherProfileAction, INITIAL_STATE\)/);
  assert.match(code("components/account/teacher-profile-form.tsx"), /name="displayName"/);
  const budget = code("components/account/budget-distribution-form.tsx");
  assert.match(budget, /useGuardedActionState\(saveBudgetDistributionAction, INITIAL_STATE\)/);
  for (const field of ["needs", "wants", "savings"]) assert.match(budget, new RegExp(`<input type="hidden" name="${field}"`));
  for (const fn of ["adjustNeeds", "adjustWants", "adjustSavings"]) assert.match(budget, new RegExp(`${fn}\\(distribution, v\\)`));

  const session = code("components/account/active-session-card.tsx");
  assert.match(session, /endActiveSessionAction\(session\.deviceId, session\.generation\)/);
  assert.match(session, /Esto cierra la sesión del dispositivo autorizado de inmediato\./);
  assert.match(session, /Cerrar esa sesión remotamente/);
  assert.match(session, /Confirmar cierre/);
  assert.doesNotMatch(session, /\{session\.deviceId/, "el id del dispositivo nunca se muestra");
  assert.match(session, /No hay ningún dispositivo autorizado activo en este momento\./);

  assert.match(code("components/account/change-password-button.tsx"), /requestOwnPasswordChangeAction\(\)/);
  assert.match(code("components/account/change-password-button.tsx"), /Te enviamos un enlace a tu correo para cambiar tu contraseña\./);

  const del = code("components/account/delete-account-button.tsx");
  assert.match(del, /const CONFIRM_WORD = "ELIMINAR"/);
  assert.match(del, /confirmText\.trim\(\) === CONFIRM_WORD/);
  assert.match(del, /disabled=\{!canConfirm \|\| pending\}/);
  assert.match(del, /deleteOwnAccountAction\(\)/);
  assert.match(del, /Se va a eliminar tu cuenta y TODOS tus datos \(alumnos, clases, pagos, reportes\) de forma permanente/);

  const page = code(VIEW);
  for (const href of ["/calendario/disponibilidad", "/alumnos", "/configuracion/respaldo"]) assert.match(page, new RegExp(`href="${href}"`));
  const loaders = code(PAGE);
  for (const loader of ["getTeacherProfile(ctx)", "getBudgetDistributionSettings(ctx)", "getActiveSession(ctx)"]) assert.match(loaders, new RegExp(loader.replace(/[()]/g, "\\$&")));
});

test("los guardados devuelven `saved: true` y los errores siguen igual; la pantalla lo anuncia sin depender del color", () => {
  const actions = code("lib/actions/account.ts");
  assert.equal((actions.match(/return \{ saved: true \};/g) ?? []).length, 2, "perfil y distribución");
  // R1: los errores pasan por el normalizador seguro (antes se devolvía `error.message` tal cual).
  assert.match(actions, /return actionErrorMessage\("account", error\);/);
  assert.doesNotMatch(actions.replace(/result\.error\.message/g, ""), /error\.message/, "salvo el texto ya traducido por el adaptador de autenticación");
  const ui = code("components/account/settings-ui.tsx");
  assert.match(ui, /<div role="status" aria-live="polite"/, "región viva siempre montada");
  assert.match(ui, /<CheckIcon[^>]*aria-hidden/, "el éxito lleva ícono, no sólo color verde");
  assert.match(code("components/account/teacher-profile-form.tsx"), /Nombre guardado\./);
  assert.match(code("components/account/budget-distribution-form.tsx"), /Distribución guardada\./);
  for (const form of ["teacher-profile-form", "budget-distribution-form"]) {
    assert.match(code(`components/account/${form}.tsx`), /state\.saved === true && !state\.error && editedAfter !== state/, "el aviso se retira al volver a editar o si hubo error");
  }
});

test("botones: cuatro estilos compartidos de 44 px y ningún botón de Configuración con tamaño propio", () => {
  const ui = code("components/account/settings-ui.tsx");
  assert.match(ui, /const BUTTON_BASE =\s*"inline-flex min-h-11 /);
  for (const name of ["BUTTON_PRIMARY", "BUTTON_SECONDARY", "BUTTON_DANGER_OUTLINE", "BUTTON_DANGER"]) assert.match(ui, new RegExp(`export const ${name} = \`\\$\\{BUTTON_BASE\\}`));
  for (const file of ACCOUNT_FILES.filter((f) => !f.endsWith("settings-ui.tsx"))) {
    const source = code(file);
    for (const tag of openingTags(source, "button")) {
      assert.match(tag, /className=\{[^}]*BUTTON_/, `${file}: botón sin estilo compartido → ${tag.slice(0, 70)}`);
      assert.doesNotMatch(tag, /className="[^"]*\b(px-\d|py-\d)/, `${file}: botón con padding propio → ${tag.slice(0, 70)}`);
    }
  }
  assert.match(ui, /export const FIELD_CLASS =\s*"w-full rounded-md border border-borderStrong/, "campos con borde de control (3:1)");
});

test("teclado y foco: el foco entra al abrir una confirmación y vuelve al botón al cancelar; el resultado se anuncia", () => {
  const del = code("components/account/delete-account-button.tsx");
  assert.match(del, /if \(open\) inputRef\.current\?\.focus\(\);[\s\S]*?triggerRef\.current\?\.focus\(\)/);
  assert.match(del, /function cancel\(\) \{\s*restoreFocus\.current = true;\s*setOpen\(false\)/);
  assert.match(del, /event\.key === "Escape"\) cancel\(\)/, "Escape cancela la confirmación");
  assert.match(del, /onClick=\{cancel\}/);
  assert.match(del, /<label htmlFor="delete-confirm"/);
  assert.match(del, /aria-labelledby="delete-warning"/);

  const session = code("components/account/active-session-card.tsx");
  assert.match(session, /if \(confirming\) panelRef\.current\?\.focus\(\);[\s\S]*?triggerRef\.current\?\.focus\(\)/);
  assert.match(session, /role="group"\s+aria-label="Confirmar el cierre de la sesión remota"/);
  assert.match(session, /event\.key === "Escape"\) cancel\(\)/, "Escape cancela la confirmación");
  assert.match(session, /statusRef\.current\?\.focus\(\)/, "al terminar, el foco no queda perdido");
  assert.match(session, /role="status" aria-live="polite" tabIndex=\{-1\}/);

  const pwd = code("components/account/change-password-button.tsx");
  assert.match(pwd, /if \(sent\) statusRef\.current\?\.focus\(\)/);
  assert.match(pwd, /role="status" aria-live="polite" tabIndex=\{-1\}/);
});

test("navegación: Respaldo muestra «Configuración / Respaldo» con la página actual marcada, y su jerarquía de títulos es h1 → h2 → h3", () => {
  const ui = code("components/account/settings-ui.tsx");
  assert.match(ui, /<nav aria-label="Ruta de navegación">/);
  assert.match(ui, /<li aria-current="page"/);
  assert.match(ui, /href="\/configuracion" className="inline-flex min-h-11 /);
  const page = code(BACKUP_PAGE);
  assert.match(page, /<SettingsBreadcrumb current="Respaldo" \/>/);
  assert.doesNotMatch(page, /Volver a Configuración/);
  assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
  assert.equal((page.match(/<h2\b/g) ?? []).length, 2, "Recuperar datos e Historial de importaciones");
  assert.match(page, /<BackupImportWizard \/>/);
  assert.match(page, /<ImportHistory \/>/);
  assert.match(page, /Tus importaciones anteriores\./);
});

test("historial de importaciones: estado vacío de la app y botones compartidos; la lógica de deshacer no cambia", () => {
  const history = code("components/backup/import-history.tsx");
  assert.match(history, /<EmptyState message="Todavía no importaste ningún respaldo\." \/>/);
  assert.match(history, /previewUndoImportAction\(run\.id\)/);
  assert.match(history, /applyUndoImportAction\(undoState\.undoPreviewId\)/);
  assert.match(history, /discardImportUndoAction\(run\.id\)/);
  assert.match(history, /BUTTON_SECONDARY/);
  assert.match(history, /DiscardUndoControl/, "quitar la opción de deshacer pide confirmación (B10)");
  assert.doesNotMatch(history, /text-xs font-semibold text-statusRojo hover:underline/, "sin enlaces peligrosos de texto suelto");
});

test("sin conexión con la cuenta: un aviso con salida (Reintentar), no tres tarjetas vacías", () => {
  const page = code(PAGE);
  assert.match(page, /function UnavailableState\(\)/);
  assert.match(page, /action=\{\{ label: "Reintentar", href: "\/configuracion" \}\}/);
  assert.doesNotMatch(page, /UnauthenticatedSections|Correo, contraseña y sesión activa/);
});

test("alcance: el asistente de importación, la autenticación, las sesiones y las migraciones no cambian", () => {
  const wizard = read("components/backup/import-wizard.tsx");
  assert.match(wizard, /Primero solo se analiza\./, "el asistente se simplificó en B10; su lógica no cambia");
  assert.match(code("app/(app)/inicio/page.tsx"), /redirect\(SESSION_RECOVERY_PATH\)/);
  const actions = code("lib/actions/account.ts");
  assert.match(actions, /await deleteOwnAccount\(ctx\);[\s\S]*?await createSupabaseAuthAdapter\(\)\.signOut\(\);/, "primero borra y sólo después cierra sesión");
  assert.match(actions, /endActiveSession\(ctx, deviceId, generation\)/);
  assert.match(actions, /requestPasswordReset\(user\.email\)/);
});
