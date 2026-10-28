// Compartir el PDF de un reporte: se ejecuta la implementación web con navegadores simulados (con y sin soporte de archivos, selector cancelado, descarga fallida).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportShareMessage, canShareReportFiles, reportPdfFileName, shareReportPdf, type ShareCapableNavigator } from "../share-pdf.ts";

const makeFile = (blob: Blob, name: string, type: string) => new File([blob], name, { type });
const makeEmptyFile = (name: string, type: string) => new File([], name, { type });
const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });

function navigatorWith(overrides: Partial<ShareCapableNavigator> = {}): { nav: ShareCapableNavigator; shared: Array<{ files?: File[]; title?: string; text?: string }> } {
  const shared: Array<{ files?: File[]; title?: string; text?: string }> = [];
  return { shared, nav: { canShare: () => true, share: async (data) => void shared.push(data), ...overrides } };
}
const base = (nav: ShareCapableNavigator | undefined, fetchPdf = async () => pdf) => ({ nav, fetchPdf, makeFile, fileName: "reporte.pdf", title: "Reporte de Ana", text: "Hola" });

test("abre el selector del sistema con el PDF real y el mensaje, y sólo dice «compartido» después", async () => {
  const { nav, shared } = navigatorWith();
  const outcome = await shareReportPdf(base(nav));
  assert.deepEqual(outcome, { status: "shared" });
  assert.equal(shared.length, 1);
  assert.equal(shared[0].files?.[0].type, "application/pdf");
  assert.equal(shared[0].files?.[0].name, "reporte.pdf");
  assert.equal(shared[0].text, "Hola");
});

test("sin navegador con soporte (sin share o sin canShare) devuelve «no soportado» sin descargar nada", async () => {
  let downloads = 0;
  const fetchPdf = async () => {
    downloads += 1;
    return pdf;
  };
  for (const nav of [undefined, {}, { share: async () => {} }, { canShare: () => true }]) {
    const outcome = await shareReportPdf(base(nav as ShareCapableNavigator | undefined, fetchPdf));
    assert.equal(outcome.status, "unsupported");
  }
  assert.equal(downloads, 0);
});

test("un navegador que no admite ARCHIVOS (canShare falso) devuelve «no soportado» y nunca llama a share", async () => {
  const { nav, shared } = navigatorWith({ canShare: () => false });
  const outcome = await shareReportPdf(base(nav));
  assert.equal(outcome.status, "unsupported");
  assert.equal(shared.length, 0);
});

test("cerrar el selector no es un error; un fallo real sí lo informa", async () => {
  const abort = Object.assign(new Error("cancelado"), { name: "AbortError" });
  assert.deepEqual(await shareReportPdf(base(navigatorWith({ share: async () => Promise.reject(abort) }).nav)), { status: "cancelled" });
  const failed = await shareReportPdf(base(navigatorWith({ share: async () => Promise.reject(new Error("boom")) }).nav));
  assert.equal(failed.status, "error");
  assert.ok(!JSON.stringify(failed).includes("boom"), "el mensaje de error interno no se expone");
});

test("si no se puede descargar el archivo se informa y no se abre el selector", async () => {
  const { nav, shared } = navigatorWith();
  const outcome = await shareReportPdf(base(nav, async () => Promise.reject(new Error("cors"))));
  assert.equal(outcome.status, "fetch_failed");
  assert.equal(shared.length, 0);
});

test("canShareReportFiles prueba con un PDF vacío y no falla si canShare lanza", () => {
  assert.equal(canShareReportFiles(navigatorWith().nav, makeEmptyFile), true);
  assert.equal(canShareReportFiles(navigatorWith({ canShare: () => false }).nav, makeEmptyFile), false);
  assert.equal(canShareReportFiles(navigatorWith({ canShare: () => { throw new Error("x"); } }).nav, makeEmptyFile), false);
  assert.equal(canShareReportFiles(undefined, makeEmptyFile), false);
});

test("el nombre del archivo no lleva tildes ni caracteres peligrosos y nunca queda vacío", () => {
  assert.equal(reportPdfFileName("Reporte de María — marzo y junio 2026"), "Reporte-de-Maria-marzo-y-junio-2026.pdf");
  assert.equal(reportPdfFileName("../../etc/passwd"), "etc-passwd.pdf");
  assert.equal(reportPdfFileName("???"), "reporte.pdf");
});

test("el mensaje sugerido nombra sólo el primer nombre, el título y el período (nada del contenido)", () => {
  assert.equal(buildReportShareMessage({ studentName: "Ana María Gómez", title: "Reporte de Ana", periodLabel: "marzo 2026" }), "Hola, te comparto el reporte de Ana: Reporte de Ana (marzo 2026).");
  assert.equal(buildReportShareMessage({ studentName: "", title: "T", periodLabel: "P" }), "Hola, te comparto el reporte: T (P).");
});
test('con PDF preparado se abre el selector en el mismo gesto, sin esperar una descarga', async()=>{
 const {nav,shared}=navigatorWith();let fetched=false;
 const result=shareReportPdf({...base(nav,async()=>{fetched=true;throw new Error('no debe descargar');}),preparedPdf:pdf});
 assert.equal(shared.length,1);assert.equal(fetched,false);assert.deepEqual(await result,{status:'shared'});
});
