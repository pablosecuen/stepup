import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { OTHER_IMPORT_DATA_LABEL, formatImportCounts, importCountLabel } from "../../backup/import-count-labels.ts";

/**
 * B3 — limpieza de textos: sin referencias a fases de desarrollo, sin "sincronizar en el futuro", sin promesas falsas en la
 * landing, sin jerga interna y sin el id de dispositivo. Sólo TEXTO: ningún dato ni función cambia (la búsqueda ignora
 * comentarios, que son documentación para quien mantiene el código).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "node_modules" || entry === ".next") continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const ALL_UI = [...sourceFiles("app"), ...sourceFiles("components")];

/** Frases que una usuaria final nunca debe leer. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bFases? \d/i, "referencia a una fase de desarrollo"],
  [/\bfases \d+ y \d+/i, "referencia a fases de desarrollo"],
  [/Depende de /, "campo provisorio que 'depende' de otra parte"],
  [/Todavía no está implementado/, "texto de 'no implementado'"],
  [/sincronizar en el futuro|todavía no sincroniza/i, "promesa vaga de sincronización"],
  [/en construcci[oó]n/i, "'en construcción'"],
  [/decisión de negocio/i, "jerga interna"],
  [/nunca de memoria|se lee siempre de la base/i, "jerga técnica"],
  [/versión de esquema|checksum/i, "dato técnico del respaldo"],
  [/dato técnico/i, "'dato técnico'"],
  [/ya se purgó/i, "'purgó'"],
  [/Sincronización no configurada|cuenta de nube|configuración de Supabase|modo de vista previa|datos de ejemplo/i, "texto de entorno interno"],
];

test("ningún texto visible contiene referencias a fases, jerga interna ni promesas desactualizadas", () => {
  const offenders: string[] = [];
  for (const file of ALL_UI) {
    const source = code(file);
    for (const [pattern, why] of FORBIDDEN) {
      const match = source.match(pattern);
      if (match) offenders.push(`${file}: ${why} → "${match[0]}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("la landing no promete recargos automáticos (están desactivados) y no dice 'en construcción'", () => {
  const landing = code("app/page.tsx");
  assert.doesNotMatch(landing, /recargos?/i);
  assert.doesNotMatch(landing, /automáticamente/i);
  assert.match(landing, /Mensualidades, pagos y vencimientos siempre a la vista\./);
  assert.match(landing, /para profesoras y profesores independientes/);
});

test("Configuración dice la verdad sobre los recargos en lenguaje simple", () => {
  const page = code("app/(app)/configuracion/page.tsx");
  assert.match(page, /Los recargos por atraso están desactivados\. El semáforo de mora usa plazos fijos\./);
});

test("el acceso (login / crear cuenta) ya no habla de sincronizar", () => {
  assert.match(code("app/login/page.tsx"), /subtitle="Ingresá con tu cuenta de TeacherFlow\."/);
  assert.match(code("app/crear-cuenta/page.tsx"), /subtitle="Creá tu cuenta con tu correo y una contraseña\."/);
});

test("el id del dispositivo nunca se muestra, pero la acción de cerrar esa sesión sigue usándolo", () => {
  const card = code("components/account/active-session-card.tsx");
  assert.doesNotMatch(card, /\{session\.deviceId/, "ningún {session.deviceId…} se renderiza");
  assert.doesNotMatch(card, /deviceId\.slice/);
  assert.doesNotMatch(card, /<dt[^>]*>Dispositivo<\/dt>/);
  assert.match(card, /endActiveSessionAction\(session\.deviceId, session\.generation\)/, "la funcionalidad no cambia");
  assert.match(card, /Esto cierra la sesión del dispositivo autorizado de inmediato\./);
});

test("el perfil del alumno quita los campos provisorios pero conserva todo dato real y las 7 pestañas", () => {
  const resumen = code("components/students/profile/resumen-tab.tsx");
  assert.doesNotMatch(resumen, /InfoCard|Próxima clase|Última clase/);
  for (const kept of ["Tarea pendiente", "Alertas importantes", "Objetivos actuales", "Fortalezas", "Aspectos a mejorar"]) assert.match(resumen, new RegExp(kept));

  const info = code("components/students/profile/informacion-tab.tsx");
  assert.doesNotMatch(info, /Horas totales tomadas|Total invertido|Cantidad total de clases/);
  for (const kept of ["Nivel inicial", "Fecha de alta", "Duración habitual", "Frecuencia semanal", "Precio de referencia", "Teléfono"]) assert.match(info, new RegExp(kept));

  assert.equal((code("components/students/profile/profile-tabs-nav.tsx").match(/\{ key: "/g) ?? []).length, 7, "las 7 pestañas siguen");
  assert.throws(() => read("components/students/profile/pending-tab.tsx"), "el componente provisorio sin uso ya no existe");
  assert.doesNotMatch(code("components/students/students-filters-form.tsx"), /Orden por próxima clase/);
});

test("el historial de importaciones no expone checksum ni versión de esquema ni nombres de tablas", () => {
  const history = code("components/backup/import-history.tsx");
  assert.doesNotMatch(history, /checksum|schemaVersion|versión de esquema/);
  assert.match(history, /formatImportCounts\(run\.countsByTable\)/);
  assert.doesNotMatch(history, /Object\.entries\(run\.countsByTable\)/, "ya no imprime los nombres internos de las tablas");
  assert.match(history, /registro\(s\) importado\(s\)/);
  assert.match(code("app/(app)/configuracion/respaldo/page.tsx"), /Tus importaciones anteriores\./);
});

test("etiquetas de conteos: nombres claros, tablas desconocidas agrupadas, nunca el nombre interno", () => {
  assert.equal(importCountLabel("students"), "alumnos");
  assert.equal(importCountLabel("calendar_lessons"), "clases");
  assert.equal(importCountLabel("payments"), "pagos");
  assert.equal(importCountLabel("tabla_interna_nueva"), OTHER_IMPORT_DATA_LABEL);
  assert.equal(formatImportCounts({ students: 5, calendar_lessons: 12, payments: 0 }), "alumnos: 5, clases: 12", "omite los ceros");
  assert.equal(formatImportCounts({ x_interna: 2, y_interna: 3, students: 1 }), "otros datos: 5, alumnos: 1", "agrupa lo desconocido");
  assert.doesNotMatch(formatImportCounts({ student_level_history: 4, secret_table: 1 }), /_/, "ningún nombre con guion bajo");
  assert.equal(formatImportCounts(null), "");
  assert.equal(formatImportCounts({}), "");
});

test("alcance: B3 es sólo texto — ningún archivo de datos, autenticación ni migraciones cambia", () => {
  // Estos módulos no deben referirse a B3 ni haberse reescrito: se comprueba que siguen existiendo con su API.
  assert.match(read("lib/actions/account.ts"), /endActiveSessionAction/);
  assert.match(read("lib/auth/actions.ts"), /export async function signOutAction/);
  assert.match(read("lib/repositories/active-sessions.ts"), /getActiveSession/);
});
