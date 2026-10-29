// Buscador de Alumnos (29/10/2026): coincidencia por fragmentos, en cualquier orden y con errores de tipeo; búsqueda sobre TODA la cuenta antes de paginar; filtros que no ocultan en silencio;
// dirección compartible; campo que busca mientras se escribe sin perder foco ni letras. Ejecuta el código real de la web.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { StudentRecord } from "../../repositories/students-mapping.ts";
import type { StudentStatusProjection } from "../list-status.ts";
import { resolveStudentList, type StudentListEntry, type StudentListFilterState } from "../list-filters.ts";
import { paginate } from "../filters.ts";
import { buildStudentsListHref, cleanStudentSearchText, MAX_STUDENT_SEARCH_LENGTH } from "../list-url.ts";
import { rankStudentsBySearch } from "../search.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const source = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

function student(id: string, name: string, over: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id, name, phone: null, whatsapp: null, email: null, usualDays: [], usualTime: null, notes: null, birthDate: null, levels: ["B1"], initialLevel: "B1", modality: "presencial", status: "activo",
    category: "otro", billingType: "mensual", billingPlan: { type: "monthly", amount: 50000, dueDay: 10 }, dateJoined: "2026-01-01", lastReactivatedAt: null, statusChangeDate: null, usualDurationMinutes: 60,
    weeklyFrequency: 1, price: 50000, pendingHomework: null, alerts: [], currentGoals: [], strengths: [], areasToImprove: [], isFeatured: false, isNew: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
  };
}
const payment = { paymentStatus: "verde", lastPaymentAt: null } as unknown as StudentStatusProjection;
const entry = (s: StudentRecord): StudentListEntry => ({ student: s, payment, nextClassStart: null, nextClassEnd: null });

const NAMES = [
  "Alejandro Pons Estel", "María Luz Piva", "Josefina Aguirre", "José García", "Ana Torres", "Ana", "Mariana Sosa", "Alejandra Ruiz", "Alexis Pérez", "Alicia Gómez", "Alan Díaz", "Elena Pons", "Lucía Álvarez",
  "Luz Marina Piva", "Martina Gómez", "Mateo Núñez", "Julián Pérez", "Julieta Ríos", "Camila Ríos", "Sofía Rodríguez", "Rodrigo Paz", "Mauro Estel", "Pablo Aguirre", "Agustín Pons", "Valentina Sosa",
  "Bruno Fernández", "Florencia López", "Joaquín Alonso", "Nicolás Vega", "Emilia Vega", "Tomás Acosta", "Lautaro Ibarra", "Milagros Cabrera", "Tamara Ledesma", "Andrés Molina", "Carolina Peralta",
  "Gonzalo Benítez", "Agustina Ferreyra", "Candela Ortiz", "Ramiro Silva",
];
const roster = NAMES.map((name, index) => student(`s${index}`, name));
const entries = roster.map(entry);
const base: StudentListFilterState = { search: "", status: "todos", level: "todos", modality: "todos", paymentStatus: "todos", sortBy: "nombre" };
const found = (search: string, over: Partial<StudentListFilterState> = {}) => resolveStudentList(entries, { ...base, search, ...over }).items.map((e) => e.student.name);

test("ejemplos del pedido: fragmentos, orden invertido, mayúsculas, tildes y espacios", () => {
  assert.ok(found("ale").includes("Alejandro Pons Estel"));
  assert.ok(found("pons ale").includes("Alejandro Pons Estel"));
  assert.deepEqual(found("pons ale"), ["Alejandro Pons Estel"], "«pons ale» no trae a otros «Pons» sin «ale»");
  assert.equal(found("maria luz")[0], "María Luz Piva");
  const variants = ["maria luz", "MARÍA LUZ", "  maria   luz  ", "María Luz", "mAría\tLUZ"];
  for (const variant of variants) assert.deepEqual(found(variant), found("maria luz"), JSON.stringify(variant));
  assert.deepEqual(found("piva luz"), found("luz piva"), "el orden de las palabras no cambia los resultados");
});

test("ejemplos del pedido: errores de tipeo (omitida, agregada, equivocada, intercambiada)", () => {
  assert.ok(found("alejndro").includes("Alejandro Pons Estel"), "letra omitida");
  assert.ok(found("josefna").includes("Josefina Aguirre"), "letra omitida");
  assert.ok(found("alejanddro").includes("Alejandro Pons Estel"), "letra agregada");
  assert.ok(found("alejandto").includes("Alejandro Pons Estel"), "letra equivocada");
  assert.ok(found("alejadnro").includes("Alejandro Pons Estel"), "letras intercambiadas");
  assert.ok(found("josifina").includes("Josefina Aguirre"), "vocal equivocada");
  assert.ok(found("rodrguez").includes("Sofía Rodríguez"));
  assert.equal(found("alejndro")[0], "Alejandro Pons Estel", "la más cercana primero (Alejandra queda a dos letras)");
});

test("orden: exactas primero, después comienzos y fragmentos, y al final las aproximadas", () => {
  const ranked = rankStudentsBySearch(roster, "ana", { getName: (s) => s.name, getId: (s) => s.id });
  const classes = ranked.map((r) => r.matchType);
  assert.equal(ranked[0].item.name, "Ana", "nombre completo exacto");
  assert.equal(ranked[1].item.name, "Ana Torres", "palabra exacta");
  const order = ["exact", "word_exact", "prefix", "word_prefix", "contains", "initials", "fuzzy", "subsequence"];
  const positions = classes.map((type) => order.indexOf(type));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "ninguna coincidencia más débil aparece antes que una más fuerte");
  // En la lista: comienzos antes que aproximadas, con el orden alfabético elegido dentro de los comienzos.
  const list = found("aleja");
  assert.deepEqual(list.slice(0, 2), ["Alejandra Ruiz", "Alejandro Pons Estel"]);
  const typo = found("alejndro");
  assert.equal(typo[0], "Alejandro Pons Estel");
});

test("con una o dos letras sólo hay coincidencia directa: la tolerancia no devuelve a casi todos", () => {
  for (const q of ["zz", "xy", "qk", "jq", "wv", "fz"]) assert.equal(found(q).length, 0, `«${q}» no es literal en ningún nombre`);
  for (const q of ["al", "ma", "jo", "ro", "pi", "es"]) {
    const result = found(q);
    assert.ok(result.length > 0 && result.length < NAMES.length / 2, `«${q}» devuelve ${result.length} de ${NAMES.length}`);
    for (const name of result) assert.ok(name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q), `${name} contiene «${q}»`);
  }
  assert.equal(found("a").length > 0, true, "una letra sigue siendo literal (decisión del 22/07/2026)");
});

test("la tolerancia con tres o más letras tampoco vuelve a todos: consultas sin relación no devuelven nada", () => {
  for (const q of ["zzzz", "qwerty", "xkcd", "plumbing", "ñandú"]) assert.equal(found(q).length, 0, q);
  for (const q of ["ale", "mar", "jos", "ped", "lui"]) assert.ok(found(q).length < NAMES.length / 3, `«${q}» devuelve ${found(q).length}`);
});

test("busca en TODOS los alumnos y recién después pagina: un alumno de la última página aparece al buscarlo", () => {
  const many = Array.from({ length: 130 }, (_, i) => student(`m${i}`, `Alumno${String(i).padStart(3, "0")} Apellido`)).concat(student("zz", "Zulema Quintana"));
  const all = many.map(entry);
  const sinBuscar = resolveStudentList(all, base).items;
  assert.equal(paginate(sinBuscar, 1, 24).items.some((e) => e.student.id === "zz"), false, "sin buscar, Zulema está en otra página");
  assert.equal(paginate(sinBuscar, 6, 24).items.some((e) => e.student.id === "zz"), true);
  const buscado = resolveStudentList(all, { ...base, search: "zulema" }).items;
  assert.deepEqual(paginate(buscado, 1, 24).items.map((e) => e.student.name), ["Zulema Quintana"], "buscado, aparece en la primera página");
  assert.equal(paginate(buscado, 3, 24).page, 1, "una página inexistente de una búsqueda corta se recorta a la primera");
});

test("el orden elegido rige entre coincidencias de igual relevancia", () => {
  const rows = [
    { ...entry(student("1", "Ale Uno")), nextClassStart: "2026-11-05T10:00:00Z" },
    { ...entry(student("2", "Ale Dos")), nextClassStart: "2026-11-01T10:00:00Z" },
    { ...entry(student("3", "Ale Tres")), nextClassStart: null },
  ];
  const byName = resolveStudentList(rows, { ...base, search: "ale" }).items.map((e) => e.student.name);
  assert.deepEqual(byName, ["Ale Dos", "Ale Tres", "Ale Uno"]);
  const byClass = resolveStudentList(rows, { ...base, search: "ale", sortBy: "proxima_clase" }).items.map((e) => e.student.name);
  assert.deepEqual(byClass, ["Ale Dos", "Ale Uno", "Ale Tres"]);
});

test("los filtros se conservan y lo que dejan fuera NO se oculta en silencio: se cuenta", () => {
  const mixed = [
    entry(student("a", "Alejandro Activo")),
    entry(student("b", "Alejandra Pausada", { status: "pausado" })),
    entry(student("c", "Alejo Inactivo", { status: "inactivo" })),
    entry(student("d", "Alexis Avanzado", { levels: ["C1"] })),
    entry(student("e", "Beatriz Otra")),
  ];
  const activos = resolveStudentList(mixed, { ...base, status: "activo", search: "ale" });
  assert.deepEqual(activos.items.map((e) => e.student.name), ["Alejandro Activo", "Alexis Avanzado"]);
  assert.equal(activos.matchesOutsideFilters, 2, "Alejandra (pausada) y Alejo (inactivo) coinciden pero el estado los deja fuera");
  const nivel = resolveStudentList(mixed, { ...base, status: "activo", level: "C1", search: "ale" });
  assert.deepEqual(nivel.items.map((e) => e.student.name), ["Alexis Avanzado"]);
  assert.equal(nivel.matchesOutsideFilters, 3);
  const todos = resolveStudentList(mixed, { ...base, status: "todos", search: "ale" });
  assert.equal(todos.items.length, 4);
  assert.equal(todos.matchesOutsideFilters, 0);
  assert.equal(resolveStudentList(mixed, { ...base, status: "activo" }).matchesOutsideFilters, 0, "sin búsqueda no hay nada que avisar");
  assert.equal(resolveStudentList(mixed, { ...base, search: "   " }).items.length, 5, "una búsqueda de puros espacios es una búsqueda vacía");
});

test("borrar el texto recupera la lista de los demás filtros", () => {
  const conFiltro = resolveStudentList(entries, { ...base, level: "B1", search: "" }).items.length;
  assert.equal(conFiltro, NAMES.length);
  assert.equal(resolveStudentList(entries, { ...base, search: "ale" }).items.length < NAMES.length, true);
  assert.equal(resolveStudentList(entries, { ...base, search: "" }).items.length, NAMES.length);
});

test("nombres largos y caracteres raros no rompen ni tardan", () => {
  const long = student("long", "María de los Ángeles Fernández de la Vega y Rodríguez-Castañeda");
  const list = [...entries, entry(long)];
  const started = Date.now();
  for (const q of ["maria de los angeles", "castaneda", "rodriguez castañeda vega", "fernandez de la vega", "angles", "x".repeat(300), "<script>", "%_\\", "a b c d e f g"]) {
    resolveStudentList(list, { ...base, search: cleanStudentSearchText(q) });
  }
  assert.ok(Date.now() - started < 1500, "consultas extremas en menos de 1,5 s");
  assert.equal(resolveStudentList(list, { ...base, search: "castaneda" }).items[0].student.id, "long");
  assert.equal(resolveStudentList(list, { ...base, search: "maria de los angeles" }).items[0].student.id, "long");
});

test("rendimiento: 1.500 alumnos se buscan en una fracción de segundo", () => {
  const big = Array.from({ length: 1500 }, (_, i) => entry(student(`b${i}`, `${NAMES[i % NAMES.length]} ${i}`)));
  const started = Date.now();
  resolveStudentList(big, { ...base, search: "alejndro pons" });
  assert.ok(Date.now() - started < 1500, `tardó ${Date.now() - started} ms`);
});

test("dirección de la lista: limpia, sin valores por defecto, igual para el servidor y el navegador", () => {
  assert.equal(buildStudentsListHref({}), "/alumnos");
  assert.equal(buildStudentsListHref({ q: "  ale   pons " }), "/alumnos?q=ale+pons");
  assert.equal(buildStudentsListHref({ q: "ale", status: "activo", level: "todos", modality: "todos", pago: "todos", orden: "nombre", page: "1" }), "/alumnos?q=ale");
  assert.equal(buildStudentsListHref({ q: "ale", status: "todos", level: "B1", modality: "online", pago: "rojo", orden: "ultimo_pago", page: "3" }), "/alumnos?q=ale&status=todos&level=B1&modality=online&pago=rojo&orden=ultimo_pago&page=3");
  assert.equal(buildStudentsListHref({ q: "ale", page: "3" }), "/alumnos?q=ale&page=3");
  assert.equal(buildStudentsListHref({ q: "ale" }), buildStudentsListHref({ q: " ale " }), "espacios al principio o al final no cambian la dirección (no se vuelve a pedir)");
  assert.equal(buildStudentsListHref({ q: "josé ñandú & co=1" }), "/alumnos?q=jos%C3%A9+%C3%B1and%C3%BA+%26+co%3D1", "se codifica: nada del texto altera otros parámetros");
  assert.equal(cleanStudentSearchText("x".repeat(500)).length, MAX_STUDENT_SEARCH_LENGTH);
  assert.equal(cleanStudentSearchText(undefined), "");
  const parsed = new URL(`http://x${buildStudentsListHref({ q: "josé ñandú & co=1" })}`).searchParams.get("q");
  assert.equal(parsed, "josé ñandú & co=1", "recargar o compartir la dirección devuelve el mismo texto");
});

test("circuito del campo: busca al escribir (200 ms), Enter al instante, sin llenar el historial ni perder foco", () => {
  const form = source("components/students/students-filters-form.tsx");
  assert.match(form, /export const SEARCH_DEBOUNCE_MS = 200;/);
  assert.match(form, /setTimeout\(\(\) => go\(searchHref\(value\), "replace"\), SEARCH_DEBOUNCE_MS\)/);
  assert.match(form, /router\.replace\(href, \{ scroll: false \}\)/, "escribir reemplaza la dirección: sin una entrada de historial por letra y sin subir la página");
  assert.match(form, /router\.push\(href, \{ scroll: false \}\)/, "Enter / «Aplicar filtros» sí avanzan en el historial");
  assert.match(form, /onSubmit=\{onSubmit\}/);
  assert.match(form, /event\.preventDefault\(\);\s+const data = new FormData\(event\.currentTarget\)/);
  assert.match(form, /startTransition\(\(\) => \{/, "la navegación es una transición: la lista vieja sigue visible, sin esqueleto, hasta que llega la nueva");
  // El campo es del navegador mientras se escribe: no se remonta ni se le pisa el texto.
  assert.match(form, /value=\{text\}/);
  assert.match(form, /if \(!isPending && !debouncing && cleanStudentSearchText\(text\) !== search\)/, "una respuesta con otro texto en camino nunca pisa lo escrito");
  assert.doesNotMatch(form, /<form[^>]*\bkey=/, "el formulario no se remonta");
  assert.match(form, /<div key=\{`\$\{status\}\|\$\{level\}\|\$\{modality\}\|\$\{paymentStatus\}\|\$\{sortBy\}`\}/, "sólo los selectores se renuevan al cambiar los filtros; el campo de texto nunca");
  assert.match(form, /onCompositionStart/);
  assert.match(form, /onCompositionEnd/);
  assert.match(form, /maxLength=\{MAX_STUDENT_SEARCH_LENGTH\}/);
  // Escribir no cambia los filtros ya aplicados ni la página.
  assert.match(form, /function searchHref\(value: string\)[\s\S]*buildStudentsListHref\(\{ q: value, status: s, level: l, modality: m, pago, orden \}\)/);
  assert.doesNotMatch(form, /page:/);
  // Sin consulta repetida si la dirección no cambió; borrar y Escape vuelven a la lista de los demás filtros.
  assert.match(form, /if \(href === \(latest\.requestedHref \?\? latest\.appliedHref\)\) return;/);
  assert.match(form, /aria-label="Borrar búsqueda"/);
  assert.match(form, /event\.key === "Escape"/);
  // Conteo y aviso salen de la misma respuesta que la lista; el aviso lleva ícono y texto, no sólo color.
  assert.match(form, /role="status" aria-live="polite"/);
  assert.match(form, /Se buscan coincidencias dentro de los filtros elegidos/);
  assert.match(form, /Quitar filtros/);
  assert.match(form, /status: "todos", orden: sortBy/, "«Quitar filtros» conserva el texto buscado");
  assert.match(form, /<InformationCircleIcon/);
});

test("el servidor es el único que filtra: la página usa el motor y la dirección compartida; sin esqueleto por letra", () => {
  const page = source("app/(app)/alumnos/page.tsx");
  assert.match(page, /resolveStudentList\(entries, filters\)/);
  assert.match(page, /const \{ items: filtered, matchesOutsideFilters \} = resolveStudentList/);
  assert.ok(page.indexOf("resolveStudentList(") < page.indexOf("paginate(filtered"), "búsqueda y orden antes de paginar");
  assert.match(page, /cleanStudentSearchText\(params\.q\)/);
  assert.match(page, /buildStudentsListHref\(\{ \.\.\.params, q: search, page: String\(p\) \}\)/);
  // La lista no se anima ni se reemplaza por un esqueleto al buscar (sólo al cambiar de página).
  const view = source("components/students/students-list-view.tsx");
  assert.match(view, /<EnterOnChange changeKey=\{`pagina-\$\{page\}`\}>/);
  assert.match(view, /matchesOutsideFilters=\{matchesOutsideFilters\}/);
  assert.match(view, /Ningún alumno coincide con «\$\{search\}» dentro de los filtros elegidos\./);
  // «Volver a Alumnos» recupera la lista; sólo acepta direcciones de la propia lista.
  const back = source("components/students/profile/students-back-link.tsx");
  assert.match(back, /\^\\\/alumnos\(\\\?\[\^#\\s\]\*\)\?\$/);
  assert.match(back, /useSyncExternalStore/);
  assert.match(source("components/students/students-filters-form.tsx"), /sessionStorage\.setItem\(STUDENTS_LIST_MEMORY_KEY, appliedHref\)/);
});

test("aislamiento entre cuentas: la búsqueda sólo recibe los alumnos que la sesión puede leer", () => {
  const page = source("app/(app)/alumnos/page.tsx");
  assert.match(page, /requireAuthenticatedDbContext\(\)/);
  assert.match(page, /listStudents\(ctx\)/);
  assert.doesNotMatch(page, /createAdminClient|service_role|SERVICE_ROLE/);
  const list = source("lib/students/list-filters.ts");
  assert.doesNotMatch(list, /fetch\(|supabase|createClient/, "el motor es puro: no consulta nada por su cuenta");
});
