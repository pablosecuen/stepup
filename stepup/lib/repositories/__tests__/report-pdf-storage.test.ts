import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REPORT_PDF_BUCKET, ReportPdfCleanupIncompleteError, removeAllReportPdfsOf, type ReportPdfBucket, type StorageEntry } from "../report-pdf-storage.ts";

// R4 — El borrado de los PDF de una cuenta recorre el bucket por la API de listado (como Storage de verdad: carpetas con `id: null`,
// páginas, borrar lo inexistente no falla) y NUNCA toca objetos de otra cuenta.

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";

class FakeBucket implements ReportPdfBucket {
  objects = new Set<string>();
  listCalls: string[] = [];
  removeCalls: string[][] = [];
  failListAt: number | null = null;
  failRemoveAt: number | null = null;
  failRemoveForever = false;
  /** Un objeto que reaparece después de borrarlo (otra instancia subió un PDF durante el borrado). */
  resurrect: string | null = null;
  clock = 0;
  tick = 0;

  add(...paths: string[]) { for (const p of paths) this.objects.add(p); return this; }

  async list(path: string, options: { limit: number; offset: number; sortBy: { column: string; order: string } }) {
    this.listCalls.push(path);
    this.clock += this.tick;
    if (this.failListAt !== null && this.listCalls.length === this.failListAt) return { data: null, error: new Error("boom") };
    const children = new Map<string, StorageEntry>();
    for (const full of this.objects) {
      if (!full.startsWith(`${path}/`)) continue;
      const rest = full.slice(path.length + 1);
      const slash = rest.indexOf("/");
      if (slash === -1) children.set(rest, { name: rest, id: `id-${full}` });
      else if (!children.has(rest.slice(0, slash))) children.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null });
    }
    const sorted = [...children.values()].sort((x, y) => x.name.localeCompare(y.name));
    return { data: sorted.slice(options.offset, options.offset + options.limit), error: null };
  }

  async remove(paths: string[]) {
    this.removeCalls.push(paths);
    if (this.failRemoveForever || (this.failRemoveAt !== null && this.removeCalls.length === this.failRemoveAt)) return { data: null, error: new Error("boom") };
    for (const p of paths) this.objects.delete(p);
    if (this.resurrect) { this.objects.add(this.resurrect); this.resurrect = null; }
    return { data: paths.map((name) => ({ name })), error: null };
  }
}

const report = (owner: string, student: string, n: number) => `${owner}/${student}/${n.toString().padStart(4, "0")}.pdf`;
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

test("borra todos los PDF de la cuenta (varias carpetas de alumnos) y sólo los de esa cuenta", async () => {
  const bucket = new FakeBucket().add(report(A, S1, 1), report(A, S1, 2), report(A, S2, 1), report(B, S1, 1), report(B, S2, 1));
  const result = await removeAllReportPdfsOf(bucket, A);
  assert.equal(result.removed, 3);
  assert.deepEqual([...bucket.objects].sort(), [report(B, S1, 1), report(B, S2, 1)].sort(), "los de la otra cuenta quedan intactos");
  assert.ok(bucket.removeCalls.every((paths) => paths.every((p) => p.startsWith(`${A}/`))), "nunca se manda a borrar una ruta fuera del prefijo");
  assert.ok(bucket.listCalls.every((p) => p === A || p.startsWith(`${A}/`)), "nunca se lista fuera del prefijo");
});

test("cuenta sin archivos: no borra nada y termina bien", async () => {
  const bucket = new FakeBucket().add(report(B, S1, 1));
  assert.deepEqual(await removeAllReportPdfsOf(bucket, A), { removed: 0 });
  assert.equal(bucket.removeCalls.length, 0);
  assert.equal(bucket.objects.size, 1);
});

test("muchos archivos: pagina el listado (>100) y borra por lotes de 100", async () => {
  const bucket = new FakeBucket();
  for (let i = 0; i < 250; i += 1) bucket.add(report(A, S1, i));
  for (let i = 0; i < 130; i += 1) bucket.add(report(A, S2, i));
  const result = await removeAllReportPdfsOf(bucket, A);
  assert.equal(result.removed, 380);
  assert.equal([...bucket.objects].length, 0);
  assert.ok(bucket.removeCalls.every((paths) => paths.length <= 100));
});

test("más de 100 carpetas de alumnos (listado de carpetas paginado)", async () => {
  const bucket = new FakeBucket();
  for (let i = 0; i < 230; i += 1) bucket.add(`${A}/s${String(i).padStart(4, "0")}/r.pdf`);
  const result = await removeAllReportPdfsOf(bucket, A);
  assert.equal(result.removed, 230);
  assert.equal(bucket.objects.size, 0);
});

test("idempotente y reanudable: si Storage falla a mitad, lanza incompleto; volver a llamar termina el trabajo", async () => {
  const bucket = new FakeBucket().add(report(A, S1, 1), report(A, S2, 1), report(A, S2, 2));
  bucket.failRemoveAt = 2;
  await assert.rejects(() => removeAllReportPdfsOf(bucket, A), (error) => error instanceof ReportPdfCleanupIncompleteError && error.reason === "storage_error");
  assert.ok(bucket.objects.size > 0 && bucket.objects.size < 3, "quedó parcialmente borrado");
  const second = await removeAllReportPdfsOf(bucket, A);
  assert.equal(bucket.objects.size, 0);
  assert.ok(second.removed >= 1);
  assert.deepEqual(await removeAllReportPdfsOf(bucket, A), { removed: 0 }, "una tercera vez no hace nada");
});

test("un error del listado (primera página, o a mitad) corta con incompleto", async () => {
  for (const at of [1, 2, 3]) {
    const bucket = new FakeBucket().add(report(A, S1, 1), report(A, S2, 1));
    bucket.failListAt = at;
    await assert.rejects(() => removeAllReportPdfsOf(bucket, A), (error) => error instanceof ReportPdfCleanupIncompleteError, `listado ${at}`);
  }
});

test("la comprobación final detecta un archivo que reapareció (subido mientras se borraba): incompleto, la cuenta NO debe eliminarse", async () => {
  const bucket = new FakeBucket().add(report(A, S1, 1));
  bucket.resurrect = report(A, S2, 9);
  await assert.rejects(() => removeAllReportPdfsOf(bucket, A), (error) => error instanceof ReportPdfCleanupIncompleteError && error.reason === "files_remaining");
});

test("presupuesto de tiempo: si se agota, incompleto (la persona reintenta)", async () => {
  const bucket = new FakeBucket();
  for (let i = 0; i < 20; i += 1) bucket.add(`${A}/s${i}/r.pdf`);
  bucket.tick = 1000;
  await assert.rejects(
    () => removeAllReportPdfsOf(bucket, A, { now: () => bucket.clock, budgetMs: 5000 }),
    (error) => error instanceof ReportPdfCleanupIncompleteError && error.reason === "time_budget"
  );
});

test("nunca opera con un prefijo vacío ni con algo que no sea un id de usuario", async () => {
  const bucket = new FakeBucket().add(report(A, S1, 1), report(B, S1, 1));
  for (const bad of ["", "/", "a", "../", `${A}/`, `${A}/${S1}`, "*", "a0000000-0000-4000-8000-00000000000"]) {
    await assert.rejects(() => removeAllReportPdfsOf(bucket, bad), (error) => error instanceof ReportPdfCleanupIncompleteError, JSON.stringify(bad));
  }
  assert.equal(bucket.listCalls.length, 0, "ni siquiera lista");
  assert.equal(bucket.objects.size, 2);
});

test("nombres inesperados (con barra) o profundidad inesperada cortan en vez de borrar fuera de lugar", async () => {
  const deep = new FakeBucket().add(`${A}/x/y/z/q/w.pdf`);
  await assert.rejects(() => removeAllReportPdfsOf(deep, A), (error) => error instanceof ReportPdfCleanupIncompleteError && error.reason === "unexpected_layout");
  const weird: ReportPdfBucket = {
    list: async (path) => ({ data: path === A ? [{ name: "../otro", id: "x" }] : [], error: null }),
    remove: async () => { throw new Error("no debía borrar"); },
  };
  await assert.rejects(() => removeAllReportPdfsOf(weird, A), (error) => error instanceof ReportPdfCleanupIncompleteError);
});

test("el error nunca incluye rutas ni nombres de archivos", async () => {
  const bucket = new FakeBucket().add(report(A, S1, 1));
  bucket.failRemoveForever = true;
  try {
    await removeAllReportPdfsOf(bucket, A);
    assert.fail("debía fallar");
  } catch (error) {
    assert.doesNotMatch(String((error as Error).message), new RegExp(`${A}|${S1}|\\.pdf`));
  }
});

test("el bucket que se vacía es EXACTAMENTE el de los reportes (el mismo id que crea la migración de Storage)", () => {
  assert.equal(REPORT_PDF_BUCKET, "report-pdfs");
  const migration = readFileSync("supabase/migrations/20260926100000_report_records_storage.sql", "utf8");
  assert.match(migration, /values \('report-pdfs', 'report-pdfs', false,/);
});
