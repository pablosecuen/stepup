import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { EVIDENCE_BOX, fitEvidenceImage, fitEvidenceSize, jpegDimensions } from "../evidence-layout.ts";

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#2d6f91" } }).jpeg().toBuffer());
}

test("las dimensiones de un JPEG vertical y de uno horizontal se leen del marcador SOF", async () => {
  assert.deepEqual(jpegDimensions(await jpeg(600, 900)), { width: 600, height: 900 });
  assert.deepEqual(jpegDimensions(await jpeg(900, 600)), { width: 900, height: 600 });
  assert.equal(jpegDimensions(new Uint8Array([1, 2, 3, 4, 5])), null);
});

test("una foto vertical y una horizontal se muestran COMPLETAS dentro de la caja, con su proporción (nunca recortadas)", async () => {
  for (const [w, h] of [[600, 900], [900, 600], [900, 900], [900, 200], [200, 900]] as const) {
    const size = fitEvidenceSize(jpegDimensions(await jpeg(w, h)));
    assert.ok(size.width <= EVIDENCE_BOX.width && size.height <= EVIDENCE_BOX.height, `${w}x${h} entra en la caja`);
    assert.ok(Math.abs(size.width / size.height - w / h) / (w / h) < 0.02, `${w}x${h} conserva la proporción`);
  }
  const style = fitEvidenceImage(await jpeg(600, 900));
  assert.equal(style.objectFit, "contain");
  assert.equal(fitEvidenceSize(null).width, Math.min(EVIDENCE_BOX.width, EVIDENCE_BOX.height), "sin dimensiones legibles: un cuadrado `contain`, nunca `cover`");
});

test("cableado: el PDF no usa más el recorte `cover` en las fotos, publica las observaciones sólo con la opción y nunca las notas internas", () => {
  const pdf = readFileSync(new URL("../pdf.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(pdf, /objectFit: "cover"/);
  assert.match(pdf, /fitEvidenceImage\(image\.jpeg\)/);
  assert.match(pdf, /input\.options\.includeIndividualObservations && \(data\.individualObservations \?\? \[\]\)\.length > 0/);
  assert.doesNotMatch(pdf, /(data|input|snapshot).internalNotes|internalNotess*[:=]/);
});
