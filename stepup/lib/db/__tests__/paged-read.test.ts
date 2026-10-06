import test from "node:test";
import assert from "node:assert/strict";
import { readAllRows, buildKeysetOrFilter, IncompleteReadError, type OrderKey, type PagedSelect, type PagedQuery } from "../paged-read.ts";
import { readTable, readTableByIds, chunkIds, MAX_IDS_PER_REQUEST } from "../read.ts";
import { FakePostgrest, uuid, type Row } from "./support/fake-postgrest.ts";

const OWNER = uuid(1, "aaaaaaaa");

function makeRows(count: number, nameOf: (i: number) => string = (i) => `Alumno ${String(i % 37).padStart(2, "0")}`): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: uuid(i + 1), owner_id: OWNER, name: nameOf(i) }));
}

const BY_NAME: OrderKey[] = [
  { column: "name", ascending: true },
  { column: "id", ascending: true },
];

function expectedOrder(rows: Row[], order: readonly OrderKey[]): string[] {
  return [...rows]
    .sort((a, b) => {
      for (const key of order) {
        const av = String(a[key.column]);
        const bv = String(b[key.column]);
        if (av !== bv) return (av < bv ? -1 : 1) * (key.ascending ? 1 : -1);
      }
      return 0;
    })
    .map((row) => row.id as string);
}

function selectOf(fake: FakePostgrest, table = "students"): PagedSelect {
  return ({ count }) => fake.from(table).select("*", count ? { count: "exact" } : undefined).eq("owner_id", OWNER) as unknown as PagedQuery;
}

const SIZES = [0, 1, 99, 100, 101, 499, 500, 501, 999, 1000, 1001, 1500, 2000];

for (const size of SIZES) {
  test(`readAllRows trae las ${size} filas completas, sin repetidos y en orden estable (max_rows=1000, página 500)`, async () => {
    const rows = makeRows(size);
    const fake = new FakePostgrest({ tables: { students: rows }, maxRows: 1000 });
    const result = await readAllRows<Row>(selectOf(fake), { order: BY_NAME });
    assert.equal(result.length, size);
    assert.deepEqual(result.map((r) => r.id), expectedOrder(rows, BY_NAME));
    assert.equal(new Set(result.map((r) => r.id)).size, size);
  });
}

test("cuenta chica: una sola petición (igual que antes de R2)", async () => {
  const fake = new FakePostgrest({ tables: { students: makeRows(99) } });
  const result = await readAllRows<Row>(selectOf(fake), { order: BY_NAME });
  assert.equal(result.length, 99);
  assert.equal(fake.calls.length, 1);
});

test("sin lectura paginada, 1500 filas se truncarían en silencio a 1000 (el problema que R2 evita)", async () => {
  const fake = new FakePostgrest({ tables: { students: makeRows(1500) }, maxRows: 1000 });
  const { data } = await fake.from("students").select("*").eq("owner_id", OWNER);
  assert.equal((data as Row[]).length, 1000);
});

for (const size of [500, 1000, 1500, 2000]) {
  test(`conjunto de tamaño múltiplo exacto de la página (${size}): no se toma una página llena como la última`, async () => {
    for (const pageSize of [100, 250, 500, 1000]) {
      const rows = makeRows(size);
      const fake = new FakePostgrest({ tables: { students: rows }, maxRows: 1000 });
      const result = await readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize });
      assert.equal(result.length, size, `pageSize=${pageSize}`);
      assert.equal(new Set(result.map((r) => r.id)).size, size);
    }
  });
}

test("max_rows remoto MENOR que el tamaño de página (valor desconocido): sigue completo", async () => {
  for (const maxRows of [7, 100, 250, 333]) {
    const rows = makeRows(1001);
    const fake = new FakePostgrest({ tables: { students: rows }, maxRows });
    const result = await readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 500 });
    assert.equal(result.length, 1001, `max_rows=${maxRows}`);
    assert.deepEqual(result.map((r) => r.id), expectedOrder(rows, BY_NAME));
  }
});

test("un max_rows absurdamente chico no se confunde con el final: o se completa o falla de forma visible", async () => {
  const fake = new FakePostgrest({ tables: { students: makeRows(1001) }, maxRows: 1 });
  await assert.rejects(() => readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 500, maxPages: 50 }), IncompleteReadError);
});

test("orden estable con valores repetidos (todas las filas con el mismo nombre)", async () => {
  const rows = makeRows(1300, () => "Mismo nombre");
  const fake = new FakePostgrest({ tables: { students: rows } });
  const result = await readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 300 });
  assert.deepEqual(result.map((r) => r.id), expectedOrder(rows, BY_NAME));
});

test("orden descendente compuesto (fecha desc, id desc)", async () => {
  const order: OrderKey[] = [{ column: "paid_at", ascending: false }, { column: "id", ascending: false }];
  const rows = Array.from({ length: 1234 }, (_, i) => ({ id: uuid(i + 1), owner_id: OWNER, paid_at: `2026-0${1 + (i % 9)}-1${i % 9}` }));
  const fake = new FakePostgrest({ tables: { payments: rows } });
  const result = await readAllRows<Row>(selectOf(fake, "payments"), { order, pageSize: 200 });
  assert.deepEqual(result.map((r) => r.id), expectedOrder(rows, order));
});

test("valores con comillas, comas, puntos, paréntesis y barras en la clave de orden", async () => {
  const names = ['Ana "la" Gómez', "Pérez, Juan", "O'Brien (hijo)", "a.b.c", "back\\slash", "Zoe"];
  const rows = makeRows(120, (i) => names[i % names.length]);
  const fake = new FakePostgrest({ tables: { students: rows } });
  const result = await readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 7 });
  assert.equal(result.length, 120);
  assert.deepEqual(result.map((r) => r.id), expectedOrder(rows, BY_NAME));
});

test("el filtro de clave tiene la forma esperada (PostgREST or/and con valores entre comillas)", () => {
  assert.equal(
    buildKeysetOrFilter(BY_NAME, { name: "Ana", id: "x-1" }),
    'name.gt."Ana",and(name.eq."Ana",id.gt."x-1")'
  );
  assert.equal(
    buildKeysetOrFilter([{ column: "a", ascending: false }, { column: "b", ascending: true }, { column: "id", ascending: true }], { a: 5, b: "q", id: "z" }),
    'a.lt."5",and(a.eq."5",b.gt."q"),and(a.eq."5",b.eq."q",id.gt."z")'
  );
  assert.equal(buildKeysetOrFilter(BY_NAME, { name: 'a"b\\c', id: "i" }), 'name.gt."a\\"b\\\\c",and(name.eq."a\\"b\\\\c",id.gt."i")');
});

test("una clave de orden nula no se puede paginar: falla de forma visible", async () => {
  const rows = makeRows(1200).map((r, i) => (i === 600 ? { ...r, name: null } : r));
  const fake = new FakePostgrest({ tables: { students: rows } });
  await assert.rejects(() => readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 200 }), IncompleteReadError);
});

for (const [label, pageIndexOf] of [["primera", (n: number) => 0], ["intermedia", (n: number) => Math.floor(n / 2)], ["última", (n: number) => n - 1]] as const) {
  test(`error en la página ${label}: se propaga, nunca un parcial`, async () => {
    const rows = makeRows(1500);
    const totalCalls = 5; // camino rápido (parcial) + 500 + 500 + 500 + vacía
    const failing = pageIndexOf(totalCalls);
    const boom = { code: "57014", message: "statement timeout" };
    const fake = new FakePostgrest({ tables: { students: rows }, failCall: (index) => (index === failing ? boom : null) });
    await assert.rejects(() => readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 500 }), (error) => error === boom);
  });
}

test("alta entre páginas (antes y después del cursor): ni repetidos ni faltantes de las filas estables", async () => {
  const rows = makeRows(1500, (i) => `N${String(i).padStart(5, "0")}`);
  const stable = new Set(rows.map((r) => r.id as string));
  const fake = new FakePostgrest({
    tables: { students: rows },
    afterCall: (index, _call, f) => {
      if (index === 1) { // tras la primera página por claves
        f.tables.students.push({ id: uuid(9001), owner_id: OWNER, name: "N00000a" }); // antes del cursor
        f.tables.students.push({ id: uuid(9002), owner_id: OWNER, name: "N99999" }); // después del cursor
      }
    },
  });
  const result = await readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 500 });
  const ids = result.map((r) => r.id as string);
  assert.equal(new Set(ids).size, ids.length, "sin repetidos");
  for (const id of stable) assert.ok(ids.includes(id), "toda fila estable está presente");
});

test("baja entre páginas (antes del cursor, ya leída): no se omite ninguna fila restante (con offset se saltaría una)", async () => {
  const rows = makeRows(1500, (i) => `N${String(i).padStart(5, "0")}`);
  const fake = new FakePostgrest({
    tables: { students: rows },
    afterCall: (index, _call, f) => {
      if (index === 1) f.tables.students = f.tables.students.filter((r) => r.name !== "N00010"); // ya leída
    },
  });
  const result = await readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 500 });
  const ids = new Set(result.map((r) => r.id as string));
  for (const row of rows) assert.ok(ids.has(row.id as string), `falta ${row.name}`); // la ya leída también quedó en el resultado
  assert.equal(result.length, 1500);
});

test("baja de una fila aún no leída: el resultado no la incluye y el recuento final lo confirma (sin error)", async () => {
  const rows = makeRows(1500, (i) => `N${String(i).padStart(5, "0")}`);
  const fake = new FakePostgrest({
    tables: { students: rows },
    afterCall: (index, _call, f) => {
      if (index === 1) f.tables.students = f.tables.students.filter((r) => r.name !== "N01400");
    },
  });
  const result = await readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 500 });
  assert.equal(result.length, 1499);
});

test("un filtro de clave que el servidor ignora se detecta (fila repetida), nunca un bucle ni datos duplicados", async () => {
  const rows = makeRows(1200);
  const fake = new FakePostgrest({ tables: { students: rows } });
  const broken: PagedSelect = ({ count }) => {
    const query = fake.from("students").select("*", count ? { count: "exact" } : undefined).eq("owner_id", OWNER) as unknown as Record<string, unknown>;
    query.or = () => query; // el "servidor" ignora el filtro de página
    query.gt = () => query;
    return query as unknown as PagedQuery;
  };
  await assert.rejects(() => readAllRows<Row>(broken, { order: BY_NAME, pageSize: 500 }), /apareció dos veces/);
});

test("se corta en el máximo de páginas en vez de iterar sin fin", async () => {
  const fake = new FakePostgrest({ tables: { students: makeRows(1000) } });
  await assert.rejects(() => readAllRows<Row>(selectOf(fake), { order: BY_NAME, pageSize: 10, maxPages: 5 }), IncompleteReadError);
});

test("la lectura nunca mezcla propietarios: dos cuentas con más de 1500 filas cada una", async () => {
  const OTHER = uuid(2, "bbbbbbbb");
  const mine = makeRows(1700);
  const theirs = Array.from({ length: 1800 }, (_, i) => ({ id: uuid(100000 + i), owner_id: OTHER, name: `Otro ${i % 11}` }));
  const fake = new FakePostgrest({ tables: { students: [...mine, ...theirs] } });
  const result = await readTable<Row>(fake, "students", { filter: (q) => q.eq("owner_id", OWNER), order: BY_NAME });
  assert.equal(result.length, 1700);
  assert.ok(result.every((r) => r.owner_id === OWNER));
  assert.ok(fake.calls.every((c) => c.ownerFilters.length === 1 && c.ownerFilters[0] === OWNER));
});

// ---------------------------------------------------------------------------------------------------------------------
// Listas de ids en lotes
// ---------------------------------------------------------------------------------------------------------------------

test("chunkIds: sin duplicados ni vacíos, lotes de a lo sumo 100, orden de aparición", () => {
  const ids = Array.from({ length: 250 }, (_, i) => uuid(i + 1));
  const chunks = chunkIds([...ids, ...ids.slice(0, 20), ""]);
  assert.deepEqual(chunks.map((c) => c.length), [100, 100, 50]);
  assert.deepEqual(chunks.flat(), ids);
  assert.equal(MAX_IDS_PER_REQUEST, 100);
  assert.deepEqual(chunkIds([]), []);
});

test("chunkIds: ids más largos que un uuid (tareas `individual:<uuid>:<uuid>`) achican el lote para no pasar ~4,5 KB", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `individual:${uuid(i + 1)}:${uuid(i + 1000)}`);
  const chunks = chunkIds(ids);
  assert.ok(chunks.every((chunk) => chunk.length <= 100 && chunk.join(",").length <= 4500));
  assert.ok(chunks.length > 3);
  assert.deepEqual(chunks.flat(), ids);
});

test("más de 210 uuid en un .in() reventaría la URL; con lotes de 100 todas las solicitudes pasan y el resultado es completo", async () => {
  const lessons = Array.from({ length: 450 }, (_, i) => ({ id: uuid(i + 1), owner_id: OWNER }));
  const participants = lessons.flatMap((l, i) => [
    { id: uuid(10000 + i * 2), owner_id: OWNER, calendar_lesson_id: l.id },
    { id: uuid(10001 + i * 2), owner_id: OWNER, calendar_lesson_id: l.id },
  ]);
  const fake = new FakePostgrest({ tables: { calendar_lesson_participants: participants }, maxUrlLength: 8000 });
  const ids = lessons.map((l) => l.id);

  // Sin lotes (comportamiento anterior): una sola lista de 450 ids supera el límite de la URL.
  const raw = await fake.from("calendar_lesson_participants").select("*").eq("owner_id", OWNER).in("calendar_lesson_id", ids);
  assert.equal((raw.error as { code: string }).code, "414");

  const calls0 = fake.calls.length;
  const rows = await readTableByIds<Row>(fake, "calendar_lesson_participants", {
    matchColumn: "calendar_lesson_id",
    ids,
    filter: (q) => q.eq("owner_id", OWNER),
  });
  assert.equal(rows.length, 900);
  assert.equal(new Set(rows.map((r) => r.id)).size, 900);
  const batchCalls = fake.calls.slice(calls0);
  assert.ok(batchCalls.every((c) => c.inSizes.every((n) => n <= 100)), "ninguna lista supera 100 ids");
  assert.ok(batchCalls.every((c) => c.urlLength <= 8000));
});

test("un lote puede traer más filas que ids (se pagina dentro del lote): 100 clases × 15 participantes", async () => {
  const lessonIds = Array.from({ length: 100 }, (_, i) => uuid(i + 1));
  const participants = lessonIds.flatMap((lessonId, i) => Array.from({ length: 15 }, (_, j) => ({ id: uuid(20000 + i * 15 + j), owner_id: OWNER, calendar_lesson_id: lessonId })));
  const fake = new FakePostgrest({ tables: { calendar_lesson_participants: participants }, maxRows: 1000 });
  const rows = await readTableByIds<Row>(fake, "calendar_lesson_participants", { matchColumn: "calendar_lesson_id", ids: lessonIds, filter: (q) => q.eq("owner_id", OWNER) });
  assert.equal(rows.length, 1500);
});

test("un fallo en cualquier lote falla toda la lectura (nunca un parcial)", async () => {
  const ids = Array.from({ length: 350 }, (_, i) => uuid(i + 1));
  const rowsAll = ids.map((id, i) => ({ id: uuid(5000 + i), owner_id: OWNER, calendar_lesson_id: id }));
  for (const failingCall of [0, 1, 3]) {
    const boom = { code: "500", message: "fallo" };
    const fake = new FakePostgrest({ tables: { calendar_lesson_participants: rowsAll }, failCall: (index) => (index === failingCall ? boom : null) });
    await assert.rejects(
      () => readTableByIds<Row>(fake, "calendar_lesson_participants", { matchColumn: "calendar_lesson_id", ids, filter: (q) => q.eq("owner_id", OWNER) }),
      (error) => error === boom
    );
  }
});

test("ids repetidos: se consultan una sola vez y no se duplican filas", async () => {
  const ids = [uuid(1), uuid(2), uuid(1), uuid(2)];
  const fake = new FakePostgrest({ tables: { t: [{ id: uuid(1), owner_id: OWNER }, { id: uuid(2), owner_id: OWNER }, { id: uuid(3), owner_id: OWNER }] } });
  const rows = await readTableByIds<Row>(fake, "t", { matchColumn: "id", ids, filter: (q) => q.eq("owner_id", OWNER) });
  assert.deepEqual(rows.map((r) => r.id), [uuid(1), uuid(2)]);
});
