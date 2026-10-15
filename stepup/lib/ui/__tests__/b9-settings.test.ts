import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * B9 (actualizado por el bloque de cuenta) — Configuración: estructura, jerarquía, acciones sensibles, textos y comportamiento
 * preservado. Ya no contiene la distribución 50/30/20 (vive en Resumen financiero), la copia de seguridad ni el «dispositivo
 * autorizado» de la app anterior (la base no guarda sesiones web: ver docs/design/web-v1/14-cuenta-configuracion-y-resumen.md).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PAGE = "app/(app)/configuracion/page.tsx";
const VIEW = "components/account/configuration-view.tsx";
const BACKUP_PAGE = "app/(app)/configuracion/respaldo/page.tsx";
const ACCOUNT_FILES = [
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

test("estructura: Cuenta → Preferencias → Acciones sensibles, sin índice lateral (con tres secciones cortas no aporta) ni «Sesión y datos»", () => {
  const found = sections();
  assert.deepEqual(
    found.map((s) => s.id),
    ["cuenta", "preferencias", "acciones-sensibles"],
  );
  assert.doesNotMatch(code(VIEW), /SettingsIndex|SECTIONS|Secciones de Configuración/, "no queda una columna lateral con enlaces a secciones");
  const ui = code("components/account/settings-ui.tsx");
  assert.doesNotMatch(ui, /SettingsIndex|SettingsLinkRow|SettingsLinkCard/, "se retiraron las piezas del índice y de las tarjetas-enlace");
  assert.match(ui, /<section id=\{id\} aria-labelledby=\{`\$\{id\}-titulo`\} className="scroll-mt-20">/, "cada sección es una región con su título y no queda tapada por el encabezado fijo");
  assert.match(ui, /<h2 id=\{`\$\{id\}-titulo`\}/, "el título de cada sección es un h2");
  assert.match(ui, /<h3 className="text-\[15px\] font-\[650\] text-textPrimary">\{title\}<\/h3>/, "el título de cada fila es un h3");
});

test("encabezado y contenedor: «Configuración» / «Tu cuenta, preferencias y datos.» en el ancho útil del shell", () => {
  const page = code(PAGE);
  assert.match(page, /<PageHeader title="Configuración" subtitle=\{user \? "Tu cuenta, preferencias y datos\." :/);
  assert.match(page, /<div className=\{PAGE_WIDTH\.wide\}>/, "ancho amplio (el mismo de Calendario, Disponibilidad y las listas)");
  assert.doesNotMatch(page, /PAGE_WIDTH\.(medium|narrow)/);
});

test("Cuenta y Contraseña en dos tarjetas superiores; Políticas de cobro y Acciones sensibles con ancho proporcionado a su contenido (no se estiran)", () => {
  const view = code(VIEW);
  const columns = [...view.matchAll(/columns="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(columns, ["lg:grid-cols-2", "max-w-[480px]", "max-w-[560px]"], "Cuenta en dos columnas; políticas (~480 px) y acciones sensibles (~560 px) compactas y a la izquierda");
  assert.ok(columns.every((c) => !/^grid-cols-[2-9]/.test(c)), "ninguna grilla de varias columnas desde el ancho móvil (por defecto una columna)");
  const account = sections()[0].body;
  assert.equal((account.match(/<SettingsCard>/g) ?? []).length, 2, "dos tarjetas: la cuenta con su nombre visible y la contraseña");
  assert.match(account, /title="Nombre visible"/);
  assert.match(account, /title="Contraseña"/);
  assert.ok(account.indexOf("Nombre visible") < account.indexOf('title="Contraseña"'));
  const ui = code("components/account/settings-ui.tsx");
  assert.match(ui, /<div className=\{`mt-3 grid items-start gap-4 \$\{columns\}`\}>/, "una columna por defecto; items-start: una tarjeta corta no se estira a la altura de la vecina");
  assert.doesNotMatch(view.replace(/columns="[^"]+"/g, ""), /max-w-\[|w-full max-w/, "el único tope de ancho está en el contenedor de cada sección corta (columns), no en las tarjetas");
});

test("las acciones sensibles están juntas, al final, con tono de peligro, y ninguna otra sección las contiene", () => {
  const found = sections();
  const danger = found[found.length - 1];
  assert.equal(danger.id, "acciones-sensibles");
  assert.equal(danger.tone, "danger");
  assert.match(danger.body, /<DeleteAccountButton billingEnabled=\{billingEnabled\} \/>/);
  assert.doesNotMatch(danger.body, /EndActiveSessionControl|sesión del dispositivo/, "no hay cierre remoto del dispositivo: la base no guarda sesiones web");
  for (const normal of found.slice(0, -1)) {
    assert.doesNotMatch(normal.body, /DeleteAccountButton|BUTTON_DANGER/, `${normal.id} no mezcla acciones sensibles`);
  }
  assert.equal(found.filter((s) => s.tone === "danger").length, 1, "una única zona sensible");
});

test("Cerrar sesión vive sólo en el control superior del shell: nada de Configuración lo ofrece ni importa la acción", () => {
  for (const file of [PAGE, VIEW, BACKUP_PAGE, ...ACCOUNT_FILES]) {
    const source = code(file);
    assert.doesNotMatch(source, /signOutAction|requestSignOut|auth\/actions/, `${file} no cierra sesión`);
    assert.doesNotMatch(source, />\s*Cerrar sesión\s*</, `${file} no muestra «Cerrar sesión»`);
  }
  const button = code("components/nav/sign-out-button.tsx");
  assert.match(button, /Cerrar sesión/);
  assert.match(button, /requestSignOut\(\)/);
});

test("Configuración no contiene 50/30/20, respaldo, app móvil ni dispositivos: sólo lo que realmente configura la cuenta y el uso de la plataforma", () => {
  const all = [PAGE, VIEW, ...ACCOUNT_FILES].map((f) => code(f)).join("\n");
  assert.doesNotMatch(all, /50\/30\/20|Distribución|Guardar distribución|presupuesto|Presupuesto|proyecci/i, "la distribución vive en Resumen financiero");
  assert.doesNotMatch(all, /Respaldo|Copias? de seguridad|respaldo|configuracion\/respaldo|ArchiveBox/, "la copia de seguridad ya no está en la interfaz de Configuración");
  assert.doesNotMatch(all, /app m[óo]vil|celular/i, "ninguna mención a una app móvil");
  assert.doesNotMatch(all, /Dispositivo autorizado|sesión del dispositivo|Sesiones abiertas|active_sessions|getActiveSession/, "no se afirma controlar sesiones que la base no distingue");
  assert.doesNotMatch(all, /Disponibilidad|Niveles personalizados|calendario\/disponibilidad|\/alumnos/, "Disponibilidad se administra desde Calendario y los niveles desde Alumnos");
  assert.doesNotMatch(all, /BudgetDistributionForm|getBudgetDistributionSettings/);
  assert.match(code(VIEW), /Los recargos por atraso están desactivados\. El semáforo de mora usa plazos fijos\./, "dice la verdad sobre los recargos (B3)");
  assert.doesNotMatch(all, /Perfil de la profesora|Gestionar disponibilidad →|Gestionar desde Alumnos →/, "sin flechas de texto: el renglón entero es el enlace");
  assert.doesNotMatch(code(VIEW), />\s*\{[^}]*(deviceId|generation|checksum)/i, "ningún dato técnico en pantalla");
  // Preferencias: sólo Políticas de cobro
  const preferences = sections().find((s) => s.id === "preferencias")!.body;
  assert.deepEqual([...preferences.matchAll(/title="([^"]+)"/g)].map((m) => m[1]), ["Políticas de cobro"]);
  // Siguen accesibles desde donde se administran: Disponibilidad desde Calendario y los niveles desde Alumnos (sus rutas y su lógica no se tocan)
  assert.match(code("components/calendar/calendar-view.tsx"), /href="\/calendario\/disponibilidad"/);
  assert.equal(existsSync(join(ROOT, "app/(app)/calendario/disponibilidad/page.tsx")), true);
  assert.match(code("components/students/students-list-view.tsx"), /<ManageLevelsSection customLevels=\{customLevels\} \/>/);
  assert.match(code("components/students/manage-levels-section.tsx"), /Niveles personalizados \(\$\{customLevels\.length\}\)|Niveles personalizados \(/);
});

test("comportamiento preservado: las mismas acciones, los mismos destinos y la misma confirmación fuerte", () => {
  assert.match(code("components/account/teacher-profile-form.tsx"), /useGuardedActionState\(saveTeacherProfileAction, INITIAL_STATE\)/);
  assert.match(code("components/account/teacher-profile-form.tsx"), /name="displayName"/);

  assert.match(code("components/account/change-password-button.tsx"), /requestOwnPasswordChangeAction\(captchaToken\)/);
  assert.match(code("components/account/change-password-button.tsx"), /Te enviamos un enlace a tu correo para cambiar tu contraseña\./);

  const del = code("components/account/delete-account-button.tsx");
  assert.match(del, /const CONFIRM_WORD = "ELIMINAR"/);
  assert.match(del, /confirmText\.trim\(\) === CONFIRM_WORD/);
  assert.match(del, /disabled=\{!canConfirm\}\s+busy=\{pending\}/);
  assert.match(del, /deleteOwnAccountAction\(\{ password, confirmation: confirmText, captchaToken \}\)/, "R4: reautenticación con contraseña");
  assert.match(del, /Se va a eliminar tu cuenta y TODOS tus datos \(alumnos, clases, pagos, reportes y sus archivos PDF\) de forma permanente/);

  const loaders = code(PAGE);
  assert.match(loaders, /getTeacherProfile\(ctx\)/);
  assert.doesNotMatch(loaders, /getBudgetDistributionSettings|getActiveSession/, "la página ya no lee la distribución ni la sesión autorizada");
});

test("los guardados devuelven `saved: true` y los errores siguen igual; la pantalla lo anuncia sin depender del color", () => {
  const actions = code("lib/actions/account.ts");
  assert.equal((actions.match(/return \{ saved: true \};/g) ?? []).length, 2, "perfil y distribución (la distribución se edita desde Resumen financiero)");
  // R1: los errores pasan por el normalizador seguro (antes se devolvía `error.message` tal cual).
  assert.match(actions, /return actionErrorMessage\("account", error\);/);
  assert.doesNotMatch(actions.replace(/result\.error\.message/g, ""), /error\.message/, "salvo el texto ya traducido por el adaptador de autenticación");
  const ui = code("components/account/settings-ui.tsx");
  assert.match(ui, /<div role="status" aria-live="polite"/, "región viva siempre montada");
  assert.match(ui, /<CheckIcon[^>]*aria-hidden/, "el éxito lleva ícono, no sólo color verde");
  assert.match(code("components/account/teacher-profile-form.tsx"), /Nombre guardado\./);
  assert.match(code("components/account/teacher-profile-form.tsx"), /state\.saved === true && !state\.error && editedAfter !== state/, "el aviso se retira al volver a editar o si hubo error");
});

test("botones: los cuatro estilos compartidos son los del sistema (44 px) y ningún botón de Configuración trae tamaño propio", () => {
  const ui = code("components/account/settings-ui.tsx");
  assert.match(ui, /import \{ buttonClass, linkClass \} from "@\/components\/ui\/button";/);
  assert.match(ui, /export const BUTTON_PRIMARY = buttonClass\(\{ variant: "primary" \}\);/);
  assert.match(ui, /export const BUTTON_SECONDARY = buttonClass\(\{ variant: "secondary" \}\);/);
  assert.match(ui, /export const BUTTON_DANGER_OUTLINE = buttonClass\(\{ variant: "dangerOutline" \}\);/);
  assert.match(ui, /export const BUTTON_DANGER = buttonClass\(\{ variant: "danger" \}\);/);
  assert.match(code("components/ui/button.tsx"), /inline-flex min-h-11 /, "todas las variantes llevan min-h-11");
  for (const file of ACCOUNT_FILES.filter((f) => !f.endsWith("settings-ui.tsx"))) {
    const source = code(file);
    assert.equal(openingTags(source, "button").length, 0, file + ": ningún <button> suelto; todos son <Button> del sistema");
    for (const tag of openingTags(source, "Button")) assert.doesNotMatch(tag, /className="[^"]*\b(px-\d|py-\d)/, file + ": botón con padding propio");
  }
  assert.match(ui, /export const FIELD_CLASS = inputClass;/, "campos con borde de control (3:1)");
});

test("teclado y foco: las confirmaciones son diálogos (foco atrapado, Escape y foco devuelto al botón); el resultado se anuncia", () => {
  const dialog = code("components/ui/dialog.tsx");
  assert.match(dialog, /useDialogA11y\(requestClose\)/, "el diálogo atrapa el foco, cierra con Escape y devuelve el foco");
  const del = code("components/account/delete-account-button.tsx");
  assert.match(del, /<Dialog\s+title="Eliminar cuenta"/);
  assert.match(del, /onClose=\{cancel\}/);
  assert.match(del, /requestAnimationFrame\(\(\) => document\.getElementById\("delete-confirm"\)\?\.focus\(\)\)/, "el foco entra al primer campo");
  assert.match(del, /function cancel\(\) \{\s*setOpen\(false\);/);
  assert.match(del, /onClick=\{cancel\}/);
  assert.match(del, /htmlFor="delete-confirm"/);
  assert.match(del, /id="delete-warning"/);

  const pwd = code("components/account/change-password-button.tsx");
  assert.match(pwd, /if \(sent\) statusRef\.current\?\.focus\(\)/);
  assert.match(pwd, /role="status" aria-live="polite" tabIndex=\{-1\}/);
});

test("Respaldo (ruta interna sin enlaces desde la interfaz): conserva «Configuración / Respaldo» y su jerarquía h1 → h2 → h3, sin mencionar una app móvil", () => {
  const ui = code("components/account/settings-ui.tsx");
  assert.match(ui, /<nav aria-label="Ruta de navegación">/);
  assert.match(ui, /<li aria-current="page"/);
  assert.match(ui, /<PrivateLink href="\/configuracion" className=\{linkClass\(\)\}>/);
  const page = code(BACKUP_PAGE);
  assert.match(page, /<SettingsBreadcrumb current="Respaldo" \/>/);
  assert.doesNotMatch(page, /Volver a Configuración/);
  assert.match(page, /<PageHeader\s+title="Respaldo"/, "el único h1 sale de PageHeader");
  assert.equal((page.match(/<h2\b/g) ?? []).length, 2, "Recuperar datos e Historial de importaciones");
  assert.match(page, /<BackupImportWizard \/>/);
  assert.match(page, /<ImportHistory \/>/);
  assert.match(page, /Tus importaciones anteriores\./);
  assert.doesNotMatch(page, /app m[óo]vil/i);
});

test("historial de importaciones: estado vacío de la app y botones compartidos; la lógica de deshacer no cambia", () => {
  const history = code("components/backup/import-history.tsx");
  assert.match(history, /<EmptyState icon=\{ArchiveBoxIcon\} message="Todavía no importaste ningún respaldo\." \/>/);
  assert.match(history, /previewUndoImportAction\(run\.id\)/);
  assert.match(history, /applyUndoImportAction\(undoState\.undoPreviewId\)/);
  assert.match(history, /discardImportUndoAction\(run\.id\)/);
  assert.match(history, /<Button ref=\{reviewButtonRef\} variant="secondary"/);
  assert.match(history, /DiscardUndoControl/, "quitar la opción de deshacer pide confirmación (B10)");
  assert.doesNotMatch(history, /text-xs font-semibold text-statusRojo hover:underline/, "sin enlaces peligrosos de texto suelto");
});

test("sin conexión con la cuenta: un aviso con salida (Reintentar), no tres tarjetas vacías", () => {
  const page = code(PAGE);
  assert.match(page, /function UnavailableState\(\)/);
  assert.match(page, /action=\{\{ label: "Reintentar", href: "\/configuracion" \}\}/);
  assert.doesNotMatch(page, /UnauthenticatedSections|Correo, contraseña y sesión activa/);
});

test("alcance: el backend (sesión autorizada, respaldos, importación) queda intacto y sin uso desde la interfaz; la autenticación y las migraciones no cambian", () => {
  const wizard = read("components/backup/import-wizard.tsx");
  assert.match(wizard, /Primero solo se analiza\./, "el asistente se simplificó en B10; su lógica no cambia");
  assert.match(code("app/(app)/inicio/page.tsx"), /redirect\(SESSION_RECOVERY_PATH\)/);
  const actions = code("lib/actions/account.ts");
  assert.match(actions, /deleteAccount: \(\) => deleteOwnAccount\(ctx\)[\s\S]*?await createSupabaseAuthAdapter\(\)\.signOut\(\);/, "primero borra y sólo después cierra sesión");
  assert.match(actions, /endActiveSession\(ctx, deviceId, generation\)/, "la acción de servidor sigue existiendo (backend sin uso, para una limpieza posterior)");
  assert.match(actions, /requestPasswordReset\(user\.email, \{ captchaToken: safeToken \}\)/);
  assert.ok(read("lib/repositories/active-sessions.ts").includes("end_active_session"), "el repositorio no se borra en este bloque");
});
