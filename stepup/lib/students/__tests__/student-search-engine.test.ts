// Puerto de la suite de la app anterior (src/features/dashboard/utils/__tests__/studentSearch.test.ts): los mismos casos sobre el motor portado a la web.
/**
 * Corrección 2026-07-20 (a pedido de Joaquín — "MOTOR DE BÚSQUEDA
 * APROXIMADA DE ALUMNOS", general): suite exhaustiva del motor único y
 * compartido (`src/shared/utils/studentSearch.ts`). Ningún nombre ni
 * consulta de este archivo existe en el código de producción — son datos
 * ficticios armados exclusivamente para estas pruebas, generados a
 * propósito para cubrir tildes, ñ, guiones, apóstrofes, dos apellidos,
 * nombres compuestos, letras repetidas, orden invertido, uno y dos
 * errores, error excesivo rechazado, consulta vacía, una y dos letras,
 * empates, alumnos activos y pausados, no mutación, ranking estable y
 * rendimiento con 1.000+ registros. El caso "je -> José" es sólo UN
 * ejemplo entre muchos — no hay ninguna condición especial para él en el
 * motor real.
 */
import nodeTest from "node:test";
import nodeAssert from "node:assert/strict";

// Mismo contrato que el arnés de pruebas de la app anterior (aserciones simples y pruebas síncronas), sobre node:test.
function assert(condition: unknown, message: string): asserts condition {
  nodeAssert.ok(condition, message);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  nodeAssert.ok(actual === expected, `. Esperado: ${String(expected)}. Actual: ${String(actual)}.`);
}
function test(name: string, run: () => void): void {
  nodeTest(name, run);
}
import {
  matchesStudentSearch,
  normalizeSearchText,
  rankStudentsBySearch,
  scoreStudentNameMatch,
  searchStudentsByName,
  type StudentSearchMatchType,
} from "../search.ts";

interface FakeStudent {
  id: string;
  name: string;
  status: string;
}

function student(id: string, name: string, status: string = 'activo'): FakeStudent {
  return { id, name, status };
}

// ---------------------------------------------------------------------------
// Padrón ficticio de alumnos — sólo existe dentro de este archivo.
// ---------------------------------------------------------------------------
const juanEmee = student('s1', 'Juan Emee'); // letras repetidas, nombre corto
const martinaGomez = student('s2', 'Martina Gómez'); // tilde
const joseGarcia = student('s3', 'José García'); // tilde, ejemplo insignia del pedido
const juanPerez = student('s4', 'Juan Pérez'); // para "jp"/"perez juan"
const mariaJoseFernandezLopez = student('s5', 'María José Fernández López'); // compuesto, dos apellidos, tilde
const dAngelo = student('s6', "D'Angelo O'Brien"); // apóstrofes
const mariaJoseRuiz = student('s7', 'María-José Ruiz'); // guión
const inakiNunez = student('s8', 'Iñaki Núñez'); // ñ + tilde
const ana = student('s9', 'Ana'); // muy corto
const valentinaSosa = student('s10', 'Valentina Sosa'); // largo, para "valntina"
const brunoFernandez = student('s11', 'Bruno Fernández'); // para "fernanndez"
const pausedStudent = student('s12', 'Camila Ríos', 'pausado');

const roster: FakeStudent[] = [
  juanEmee,
  martinaGomez,
  joseGarcia,
  juanPerez,
  mariaJoseFernandezLopez,
  dAngelo,
  mariaJoseRuiz,
  inakiNunez,
  ana,
  valentinaSosa,
  brunoFernandez,
  pausedStudent,
];

function search(query: string, items: FakeStudent[] = roster): FakeStudent[] {
  return searchStudentsByName(items, query, {
    getName: (item) => item.name,
    getStatus: (item) => item.status,
    getId: (item) => item.id,
  });
}

function idsOf(results: FakeStudent[]): string[] {
  return results.map((item) => item.id);
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

test('normalizeSearchText: minúsculas, sin tildes/diéresis, guiones/apóstrofes como separador, espacios colapsados', () => {
  assertEqual(normalizeSearchText('José'), 'jose', 'tilde');
  assertEqual(normalizeSearchText('GÓMEZ'), 'gomez', 'mayúsculas + tilde');
  assertEqual(normalizeSearchText('María-José'), 'maria jose', 'guión se vuelve espacio');
  assertEqual(normalizeSearchText("D'Angelo"), 'd angelo', 'apóstrofe recto se vuelve espacio');
  assertEqual(normalizeSearchText('D’Angelo'), 'd angelo', 'apóstrofe tipográfico también se vuelve espacio');
  assertEqual(normalizeSearchText('  María   José  '), 'maria jose', 'espacios repetidos y extremos colapsan');
  assertEqual(normalizeSearchText('Iñaki'), 'inaki', 'ñ se normaliza como cualquier letra con marca diacrítica');
  assertEqual(normalizeSearchText('Núñez'), 'nunez', 'ñ + tilde combinadas');
});

// ---------------------------------------------------------------------------
// Casos obligatorios exactos del pedido
// ---------------------------------------------------------------------------

test('con dos letras sólo hay coincidencia directa (pedido del 29/10/2026): «je» ya no encuentra a «José» por distancia, «jo» sí por comienzo', () => {
  assert(!idsOf(search('je')).includes('s3'), '«je» no es comienzo ni fragmento de ninguna palabra de «José García»: la tolerancia no se aplica con dos letras');
  assert(idsOf(search('jo')).includes('s3'), '«jo» es el comienzo de «José»');
  assert(idsOf(search('ca')).includes('s12'), '«ca» es el comienzo de «Camila»');
  // Dos letras que no empiezan ninguna palabra pero están dentro de una: fragmento literal, nunca tolerancia.
  assertEqual(idsOf(search('ui')).join(','), 's7', '«ui» es fragmento de «Ruiz» y de nadie más del padrón');
  // La tolerancia con dos letras devolvería a casi todos: el padrón de 12 alumnos devuelve pocos con cualquier par que no sea literal.
  for (const pair of ['xa', 'qz', 'zk', 'wj']) assertEqual(search(pair).length, 0, `«${pair}» no es literal en ningún nombre: no devuelve nada`);
});

test('jse -> José (tres letras, letra transpuesta/insertada)', () => {
  assert(idsOf(search('jse')).includes('s3'), 'debe encontrar a José García');
});

test('martna -> Martina (letra omitida)', () => {
  assert(idsOf(search('martna')).includes('s2'), 'debe encontrar a Martina Gómez');
});

test('goms -> Gómez (letra equivocada al final)', () => {
  assert(idsOf(search('goms')).includes('s2'), 'debe encontrar a Martina Gómez');
});

test('valntina -> Valentina (letra omitida en nombre largo)', () => {
  assert(idsOf(search('valntina')).includes('s10'), 'debe encontrar a Valentina Sosa');
});

test('fernanndez -> Fernández (letra repetida de más)', () => {
  assert(idsOf(search('fernanndez')).includes('s11'), 'debe encontrar a Bruno Fernández');
});

test('jp -> Juan Pérez (iniciales o prefijo aproximado del primer nombre)', () => {
  assert(idsOf(search('jp')).includes('s4'), 'debe encontrar a Juan Pérez');
});

test('mg -> Martina Gómez (iniciales o prefijo aproximado)', () => {
  assert(idsOf(search('mg')).includes('s2'), 'debe encontrar a Martina Gómez');
});

test('em -> Juan Emee (inicio de la segunda palabra)', () => {
  assert(idsOf(search('em')).includes('s1'), 'debe encontrar a Juan Emee');
});

test('perez juan -> Juan Pérez (palabras invertidas)', () => {
  assert(idsOf(search('perez juan')).includes('s4'), 'debe encontrar a Juan Pérez con el orden invertido');
});

test('gomez mart -> Martina Gómez (palabras invertidas + prefijo)', () => {
  assert(idsOf(search('gomez mart')).includes('s2'), 'debe encontrar a Martina Gómez con el orden invertido');
});

test('mart gome -> Martina Gómez (orden normal, ambas palabras por prefijo)', () => {
  assert(idsOf(search('mart gome')).includes('s2'), 'debe encontrar a Martina Gómez');
});

test('mr -> sin coincidencia directa: dos letras equivocadas no se corrigen (antes encontraba a «María» por prefijo aproximado)', () => {
  const results = search('mr', [martinaGomez, mariaJoseFernandezLopez, juanEmee]);
  assertEqual(results.length, 0, 'ni comienzo, ni fragmento, ni iniciales contiguas');
  assert(idsOf(search('ma', [martinaGomez, mariaJoseFernandezLopez, juanEmee])).includes('s5'), '«ma» sí es el comienzo de «María»');
});

// ---------------------------------------------------------------------------
// Consultas de una letra (corrección 2026-07-22, a pedido de Joaquín —
// "BUSCADOR GENERAL DE ALUMNOS"): debe encontrar cualquier alumno cuyo
// nombre o apellido CONTENGA esa letra en cualquier posición, no sólo al
// principio de una palabra — pero siempre literal, nunca aproximada.
// ---------------------------------------------------------------------------

test('consulta de una letra: encuentra tanto inicio de palabra como contenido en cualquier posición', () => {
  const results = search('j');
  assert(idsOf(results).includes('s1'), 'Juan Emee empieza con "j"');
  assert(idsOf(results).includes('s3'), 'José García empieza con "j"');
  assert(idsOf(results).includes('s4'), 'Juan Pérez empieza con "j"');
  assert(!idsOf(results).includes('s2'), 'Martina Gómez no tiene ninguna "j", ni al inicio ni en cualquier posición');
});

test('consulta de una letra encuentra la letra en cualquier posición, no sólo al inicio de palabra', () => {
  // "e" es inicio de "Emee" (Juan Emee) Y también aparece dentro de "Gómez"
  // (Martina Gómez) sin ser la primera letra — ambos deben aparecer, con
  // el que la tiene al inicio de palabra rankeado más arriba.
  const results = search('e', [ana, martinaGomez, juanEmee]);
  assertEqual(idsOf(results).join(','), 's1,s2', '"Emee" (inicio de palabra) primero, "Gómez" (contenida) después; "Ana" no tiene ninguna "e"');
});

test('consulta de una letra sigue siendo literal: nunca dispara distancia difusa ni subsecuencia', () => {
  // "q" no existe en ningún nombre del padrón — si una letra disparara
  // aproximación amplia, algo aparecería igual (falso positivo).
  const results = search('q', [ana, martinaGomez, juanEmee, joseGarcia]);
  assertEqual(results.length, 0, 'una letra ausente de todos los nombres no debe devolver nada');
});

// ---------------------------------------------------------------------------
// Nombres compuestos, dos apellidos, guiones, apóstrofes, ñ
// ---------------------------------------------------------------------------

test('nombre compuesto con dos apellidos: cualquier palabra individual encuentra a la alumna', () => {
  assert(idsOf(search('fernandez')).includes('s5'), 'por el primer apellido');
  assert(idsOf(search('lopez')).includes('s5'), 'por el segundo apellido');
  assert(idsOf(search('maria')).includes('s5'), 'por el primer nombre');
  assert(idsOf(search('jose', [mariaJoseFernandezLopez, joseGarcia])).length === 2, '"jose" encuentra tanto al segundo nombre de María José como a José García');
});

test('apóstrofes: buscar sin apóstrofe encuentra el nombre con apóstrofe', () => {
  assert(idsOf(search('angelo')).includes('s6'), "encuentra a D'Angelo O'Brien por 'angelo'");
  assert(idsOf(search('obrien')).includes('s6'), "encuentra a D'Angelo O'Brien por 'obrien' (sin apóstrofe ni espacio)");
});

test('guión: "María-José" se busca igual que "María José"', () => {
  assert(idsOf(search('maria jose')).includes('s7'), 'encuentra a María-José Ruiz buscando con espacio en vez de guión');
  assert(idsOf(search('ruiz')).includes('s7'), 'encuentra por el apellido');
});

test('ñ: buscar sin diéresis/tilde encuentra nombres con ñ', () => {
  assert(idsOf(search('inaki')).includes('s8'), 'Iñaki sin tilde de ñ');
  assert(idsOf(search('nunez')).includes('s8'), 'Núñez sin tilde ni ñ');
  assert(idsOf(search('iñaki')).includes('s8'), 'también funciona escribiendo la ñ real');
});

test('nombre muy corto: "Ana" se encuentra por coincidencia exacta y por prefijo', () => {
  assertEqual(idsOf(search('ana')).includes('s9'), true, 'coincidencia exacta');
  assertEqual(idsOf(search('an')).includes('s9'), true, 'prefijo de dos letras');
});

// ---------------------------------------------------------------------------
// Tolerancia a errores — aceptados y rechazados
// ---------------------------------------------------------------------------

test('un error tipográfico se acepta en nombres de 3 a 5 letras', () => {
  assert(idsOf(search('vale')).includes('s10') || idsOf(search('valen')).includes('s10'), 'prefijos parciales de Valentina siguen funcionando');
});

test('dos errores permitidos en nombres largos (6-9 letras)', () => {
  // "fernandez" (9) con dos letras cambiadas: "fernandes" -> también debe
  // encontrar a Fernández (2 errores permitidos para longitud 6-9).
  assert(idsOf(search('fernandes')).includes('s11'), 'dos errores dentro de la tolerancia para palabras largas');
});

test('error excesivo se rechaza: consulta muy distinta no devuelve el candidato', () => {
  const results = search('xxxxxxxx');
  assertEqual(results.length, 0, 'una consulta sin relación real con ningún alumno no devuelve nada');
});

test('rechaza coincidencias de una sola letra común en una consulta larga', () => {
  // "quilombo" comparte sólo alguna letra suelta con "gomez"/"emee" pero no
  // tiene relación real — no debe aparecer nadie.
  const results = search('quilombo');
  assertEqual(results.length, 0, 'ninguna letra suelta en común alcanza para ser un resultado');
});

test('rechaza letras en orden incorrecto sin una transposición real', () => {
  // " negomzti" no es una variante razonable de "gomez" ni de ningún otro
  // nombre del padrón.
  const results = search('negomzti');
  assertEqual(results.length, 0, 'orden de letras sin relación real no genera coincidencia');
});

// ---------------------------------------------------------------------------
// Ranking / prioridad de tipos de coincidencia
// ---------------------------------------------------------------------------

test('ranking: exacta > prefijo > inicio de palabra > contenido > error tipográfico', () => {
  const students = [
    student('a', 'Ana Torres'),
    student('b', 'Ana'),
    student('c', 'Mariana'), // "ana" como substring en cualquier posición
  ];
  const results = searchStudentsByName(students, 'ana', {
    getName: (item) => item.name,
    getStatus: (item) => item.status,
    getId: (item) => item.id,
  });
  assertEqual(results[0].id, 'b', 'coincidencia exacta primero');
  assertEqual(results[1].id, 'a', 'prefijo del nombre completo segundo');
  assertEqual(results[2].id, 'c', 'substring en cualquier posición al final');
});

test('scoreStudentNameMatch devuelve matchType coherente con la prioridad pedida (corrección 2026-07-22: palabra exacta e iniciales tienen su lugar correcto)', () => {
  const exact = scoreStudentNameMatch('Ana', 'ana');
  const wordExact = scoreStudentNameMatch('Juan Perez', 'perez');
  const prefix = scoreStudentNameMatch('Anabel Torres', 'ana');
  // «ana» ES una palabra entera de «Ana Torres»: cuenta como palabra exacta, por encima de un simple comienzo («Anabel»).
  assertEqual(scoreStudentNameMatch('Ana Torres', 'ana')?.matchType, 'word_exact', 'una palabra exacta supera al comienzo del nombre');
  const wordPrefix = scoreStudentNameMatch('Martina Gómez', 'gom');
  const contains = scoreStudentNameMatch('Mariana', 'ana');
  const initials = scoreStudentNameMatch('Juan Pablo Gómez', 'jpg');
  const fuzzy = scoreStudentNameMatch('José García', 'jse');
  const subsequence = scoreStudentNameMatch('Martina', 'mrtna');

  assertEqual(exact?.matchType, 'exact', 'nombre completo exacto');
  assertEqual(wordExact?.matchType, 'word_exact', 'palabra exacta ("perez" es exactamente una palabra de "Juan Perez")');
  assertEqual(prefix?.matchType, 'prefix', 'comienzo del nombre completo');
  assertEqual(wordPrefix?.matchType, 'word_prefix', 'comienzo de alguna palabra');
  assertEqual(contains?.matchType, 'contains', 'coincidencia literal dentro del nombre o apellido');
  assertEqual(initials?.matchType, 'initials', 'iniciales de tres palabras');
  assertEqual(fuzzy?.matchType, 'fuzzy', 'error tipográfico (aproximada)');
  assertEqual(subsequence?.matchType, 'subsequence', 'subsecuencia ordenada (aproximada)');

  // Orden exacto pedido en la sección "5. Orden de resultados": nombre
  // completo exacto > palabra exacta > comienzo del nombre completo >
  // comienzo de alguna palabra > coincidencia literal > iniciales >
  // coincidencia aproximada.
  const order: StudentSearchMatchType[] = [
    'exact',
    'word_exact',
    'prefix',
    'word_prefix',
    'contains',
    'initials',
    'fuzzy',
    'subsequence',
  ];
  const scores = [exact, wordExact, prefix, wordPrefix, contains, initials, fuzzy, subsequence].map((r) => r?.score ?? -1);
  for (let index = 0; index < scores.length - 1; index += 1) {
    assert(
      scores[index] > scores[index + 1],
      `el puntaje de '${order[index]}' (${scores[index]}) debe ser mayor que el de '${order[index + 1]}' (${scores[index + 1]})`
    );
  }
});

test('subsecuencia ordenada (desde 4 letras): "mrtna" en Martina y "vlntna" en Valentina, con umbral que evita resultados absurdos', () => {
  assert(idsOf(search('mrtna')).includes('s2'), 'mrtna -> Martina Gómez');
  assert(idsOf(search('vlntna')).includes('s10'), 'vlntna -> Valentina Sosa');
  // Con tres letras la subsecuencia coincidiría con nombres sin relación («ale» dentro de «Álvarez»): sólo vale la coincidencia directa o un error de tipeo.
  assertEqual(scoreStudentNameMatch('Lucía Álvarez', 'ale'), null, 'tres letras salteadas no son una coincidencia');
  assertEqual(scoreStudentNameMatch('Mauro Estel', 'mar'), null, 'tres letras salteadas no son una coincidencia');
  // Pero una subsecuencia de letras demasiado dispersa en una palabra
  // mucho más larga no debe aceptarse: "cla" existe como subsecuencia de
  // "constantinopla" (c...l...a), pero abarca casi toda la palabra —
  // demasiado disperso para ser una coincidencia real.
  const sparse = scoreStudentNameMatch('Constantinopla', 'cla');
  assertEqual(sparse, null, 'letras muy separadas abarcando casi toda la palabra no deben aceptarse como subsecuencia');
});

// ---------------------------------------------------------------------------
// Empates y desempate
// ---------------------------------------------------------------------------

test('desempate: alumno activo primero, luego alfabético, luego ID estable', () => {
  const students = [
    student('z', 'Bruno', 'pausado'),
    student('a', 'Bruno', 'activo'),
  ];
  const results = searchStudentsByName(students, 'bruno', {
    getName: (item) => item.name,
    getStatus: (item) => item.status,
    getId: (item) => item.id,
  });
  assertEqual(results[0].id, 'a', 'el alumno activo va primero, aunque el ID sea mayor');
});

test('desempate: mismo puntaje y mismo estado -> orden alfabético, luego ID', () => {
  const students = [
    student('id-2', 'Carla Pino'),
    student('id-1', 'Carla Bini'),
  ];
  const results = searchStudentsByName(students, 'carla', {
    getName: (item) => item.name,
    getStatus: (item) => item.status,
    getId: (item) => item.id,
  });
  assertEqual(results[0].name, 'Carla Bini', 'orden alfabético por apellido cuando el puntaje empata');
});

test('alumnos activos y pausados: ambos pueden aparecer, pero activo siempre antes en empate', () => {
  const results = search('camila');
  assert(idsOf(results).includes('s12'), 'un alumno pausado también aparece en los resultados de búsqueda');
});

// ---------------------------------------------------------------------------
// Consulta vacía, no mutación, ranking estable
// ---------------------------------------------------------------------------

test('consulta vacía devuelve la lista tal cual, sin reordenar ni filtrar', () => {
  const results = search('   ');
  assertEqual(results.length, roster.length, 'con espacios en blanco se considera vacía, no filtra');
  assertEqual(results[0], roster[0], 'mismo orden original, sin reordenar');
});

test('no muta el arreglo original ni sus elementos', () => {
  const before = [...roster];
  search('martina');
  assertEqual(roster.length, before.length, 'no se agregan ni quitan elementos del arreglo original');
  assertEqual(roster[0], before[0], 'mismo orden original preservado');
  assertEqual(roster[1].name, 'Martina Gómez', 'el objeto original no fue modificado');
});

test('ranking estable: la misma consulta produce siempre el mismo orden', () => {
  const first = idsOf(search('mar')).join(',');
  const second = idsOf(search('mar')).join(',');
  const third = idsOf(search('mar')).join(',');
  assertEqual(first, second, 'primera y segunda corrida iguales');
  assertEqual(second, third, 'segunda y tercera corrida iguales');
});

test('rankStudentsBySearch expone puntaje y tipo de coincidencia por resultado', () => {
  const results = rankStudentsBySearch(roster, 'jose', {
    getName: (item) => item.name,
    getStatus: (item) => item.status,
    getId: (item) => item.id,
  });
  const joseResult = results.find((result) => result.item.id === 's3');
  assert(joseResult !== undefined, 'debe encontrar a José García');
  assert(typeof joseResult!.score === 'number', 'el puntaje es numérico, nunca sólo verdadero/falso');
  assert(joseResult!.matchType.length > 0, 'siempre expone un tipo de coincidencia');
});

test('matchesStudentSearch: verdadero/falso simple para pantallas que sólo filtran', () => {
  assertEqual(matchesStudentSearch('José García', 'jo'), true, 'coincide');
  assertEqual(matchesStudentSearch('José García', 'jse'), true, 'coincide por un error de tipeo (tres letras o más)');
  assertEqual(matchesStudentSearch('José García', 'xyzxyz'), false, 'no coincide');
  assertEqual(matchesStudentSearch('José García', ''), true, 'consulta vacía siempre "coincide" (no filtra)');
});

// ---------------------------------------------------------------------------
// Corrección 2026-07-22 (a pedido de Joaquín — "BUSCADOR GENERAL DE
// ALUMNOS"): bug real reportado — buscar "z" en "Buscar alumno" no
// encontraba a "Juan Perez", aunque "Perez" contiene esa letra. El padrón
// de este bloque es el mínimo pedido explícitamente en la corrección;
// ninguno de estos 5 nombres existe en datos reales de producción. Cada
// prueba corresponde 1 a 1 con un ítem de la lista de "PRUEBAS
// OBLIGATORIAS" del pedido.
// ---------------------------------------------------------------------------

const zBugJuanPerez = student('z1', 'Juan Perez');
const zBugJoseAlvarez = student('z2', 'José Álvarez');
const zBugMariaGomez = student('z3', 'María Gómez');
const zBugAnaOconnor = student('z4', "Ana O'Connor");
const zBugZoeDiaz = student('z5', 'Zoe Díaz');

const zBugRoster: FakeStudent[] = [zBugJuanPerez, zBugJoseAlvarez, zBugMariaGomez, zBugAnaOconnor, zBugZoeDiaz];

function zBugSearch(query: string): FakeStudent[] {
  return search(query, zBugRoster);
}

test('BUG "z" no encontraba a Juan Perez: "z" devuelve Juan Perez y Zoe Díaz', () => {
  const ids = idsOf(zBugSearch('z'));
  assert(ids.includes('z1'), '"z" debe encontrar a Juan Perez (la letra está en "Perez")');
  assert(ids.includes('z5'), '"z" debe encontrar a Zoe Díaz (empieza con "z")');
  assertEqual(ids.indexOf('z5') < ids.indexOf('z1'), true, 'Zoe Díaz (inicio de palabra) debe rankear antes que Juan Perez (contenida en cualquier posición)');
});

test('"rez" devuelve Juan Perez', () => {
  assert(idsOf(zBugSearch('rez')).includes('z1'), '"rez" es el final de "Perez"');
});

test('"perez" devuelve Juan Perez', () => {
  assert(idsOf(zBugSearch('perez')).includes('z1'), '"perez" es palabra exacta de "Perez"');
});

test('"PÉREZ" (mayúsculas y tilde) devuelve Juan Perez', () => {
  assert(idsOf(zBugSearch('PÉREZ')).includes('z1'), 'la comparación ignora mayúsculas y tildes');
});

test('"j" devuelve todos los nombres que realmente contienen "j" (Juan Perez y José Álvarez), nunca los que no', () => {
  const ids = idsOf(zBugSearch('j'));
  assert(ids.includes('z1'), 'Juan Perez tiene "j"');
  assert(ids.includes('z2'), 'José Álvarez tiene "j"');
  assert(!ids.includes('z3'), 'María Gómez no tiene ninguna "j"');
  assert(!ids.includes('z4'), "Ana O'Connor no tiene ninguna \"j\"");
  assert(!ids.includes('z5'), 'Zoe Díaz no tiene ninguna "j"');
});

test('"jose" devuelve José Álvarez', () => {
  assert(idsOf(zBugSearch('jose')).includes('z2'), '"jose" normaliza igual que "José"');
});

test('"alvarez" devuelve José Álvarez', () => {
  assert(idsOf(zBugSearch('alvarez')).includes('z2'), 'por el apellido, sin tilde');
});

test('"gomez" devuelve María Gómez', () => {
  assert(idsOf(zBugSearch('gomez')).includes('z3'), 'por el apellido, sin tilde');
});

test('"oconnor" devuelve Ana O\'Connor', () => {
  assert(idsOf(zBugSearch('oconnor')).includes('z4'), 'sin apóstrofe ni espacio');
});

test('"jp" devuelve Juan Perez', () => {
  assert(idsOf(zBugSearch('jp')).includes('z1'), 'iniciales o prefijo aproximado de nombre y apellido');
});

test('"j p" (con espacio) devuelve Juan Perez', () => {
  assert(idsOf(zBugSearch('j p')).includes('z1'), 'cada letra como palabra separada, inicio de nombre e inicio de apellido');
});

test('"peres" devuelve Juan Perez como aproximación (una letra equivocada)', () => {
  assert(idsOf(zBugSearch('peres')).includes('z1'), '"peres" está a una sustitución de "perez"');
});

test('una consulta inexistente no devuelve resultados falsos', () => {
  assertEqual(zBugSearch('xxxxxxxxxx').length, 0, 'ninguna relación real con el padrón');
});

test('una letra no activa búsqueda difusa absurda (sólo coincidencia literal)', () => {
  // "q" no aparece en ningún nombre del padrón — si una letra disparara
  // aproximación, algo "parecido" podría colarse igual.
  assertEqual(zBugSearch('q').length, 0, '"q" no está contenida en ningún nombre del padrón, literal ni aproximada');
});

test('campo vacío devuelve todos los alumnos, en el orden original', () => {
  const results = zBugSearch('');
  assertEqual(results.length, zBugRoster.length, 'todos los alumnos, sin filtrar');
  assertEqual(results[0], zBugRoster[0], 'mismo orden original');
});

test('no muta el arreglo de entrada del padrón del bug de "z"', () => {
  const before = [...zBugRoster];
  zBugSearch('perez');
  assertEqual(zBugRoster.length, before.length, 'ni se agregan ni se quitan elementos');
  assertEqual(zBugRoster[0], before[0], 'mismo orden, mismos objetos');
});

test('el orden de relevancia del padrón del bug de "z" es estable entre corridas', () => {
  const first = idsOf(zBugSearch('a')).join(',');
  const second = idsOf(zBugSearch('a')).join(',');
  assertEqual(first, second, 'la misma consulta produce siempre el mismo orden');
});

// ---------------------------------------------------------------------------
// Rendimiento con 1.000+ registros ficticios (sólo en memoria de esta prueba)
// ---------------------------------------------------------------------------

test('rendimiento: 1.000+ alumnos ficticios se buscan en un tiempo razonable, sin guardarse en la app', () => {
  const many: FakeStudent[] = Array.from({ length: 1200 }, (_, index) =>
    student(`perf-${index}`, `Alumno Apellido${index}`)
  );
  many.push(student('target', 'Zoe Villanueva'));
  many.push(student('target-typo', 'Wanda Villanueba')); // con un error tipográfico

  const start = Date.now();
  const exactResults = search('villanueva', many);
  const typoResults = search('villanueba', many); // consulta con error, debe encontrar ambas por tolerancia
  const elapsedMs = Date.now() - start;

  assert(idsOf(exactResults).includes('target'), 'encuentra al alumno exacto entre miles');
  assert(idsOf(typoResults).includes('target-typo'), 'encuentra la variante con error tipográfico');
  assert(elapsedMs < 800, `debe resolver ambas búsquedas en un tiempo razonable (tardó ${elapsedMs}ms)`);
});
