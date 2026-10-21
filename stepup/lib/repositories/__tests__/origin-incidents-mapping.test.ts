import { test } from "node:test";
import assert from "node:assert/strict";
import { groupIncidentViews, toIncidentView, type OriginIncidentRow } from "../origin-incidents-mapping.ts";

/** Incidencias heredadas del traslado en pantalla: lenguaje simple, sin códigos internos, y la referencia original aparte. Datos ANONIMIZADOS. */

const row = (over: Partial<OriginIncidentRow> = {}): OriginIncidentRow => ({
  id: "inc-1",
  legacy_mobile_id: "incidencia:pedagogicalLessons:lesson_1:calendarLessonId",
  entity: "pedagogicalLessons",
  row_legacy_id: "lesson_1",
  field: "calendarLessonId",
  original_reference: "calendar_recurrence_123_abc_w1_c0_d2_t540_s0",
  kind: "referencia_inexistente_en_origen",
  detail: { inicio: "2026-08-10T13:00:00.000Z", ocurrencia: "recurrence_123_abc:w1" },
  ...over,
});

test("cada incidencia conocida tiene título y explicación en lenguaje simple; la referencia técnica queda aparte", () => {
  const fields: Array<[string, string]> = [
    ["pedagogicalLessons", "calendarLessonId"],
    ["paymentCharges", "calendarLessonId"],
    ["calendarLessons", "freedByLessonId"],
    ["recurrenceExceptions", "replacementLessonId"],
    ["initialPaidSurchargeCorrections", "studentId"],
    ["initialPaidSurchargeCorrections", "voidedPaymentId"],
    ["initialPaidSurchargeCorrections", "newPaymentId"],
  ];
  for (const [entity, field] of fields) {
    const view = toIncidentView(row({ entity, field }));
    assert.notEqual(view.title, "Referencia que ya faltaba en el origen", `${entity}.${field} tiene texto propio`);
    for (const text of [view.title, view.explanation]) {
      assert.equal(/calendar_|recurrence_|lesson_|chg-|_id\b|undefined|null/.test(text), false, `sin códigos internos: ${text}`);
      assert.equal(/\b(app|aplicaci[óo]n|m[óo]vil|celular)\b/i.test(text), false, `no presenta una aplicación: ${text}`);
    }
    assert.equal(view.originalReference, "calendar_recurrence_123_abc_w1_c0_d2_t540_s0");
  }
});

test("lo heredado se explica como algo que ya faltaba antes, sin culpar a la persona ni a la web, y aclara que no se inventó nada", () => {
  const registration = toIncidentView(row());
  assert.match(registration.explanation, /ya no existía en el respaldo/);
  assert.match(registration.explanation, /se conservó completo/);
  assert.match(registration.explanation, /no se creó ninguna clase/);
  const correction = toIncidentView(row({ entity: "initialPaidSurchargeCorrections", field: "newPaymentId" }));
  assert.match(correction.explanation, /no se creó ningún pago/);
  assert.equal(registration.startsAt, "2026-08-10T13:00:00.000Z");
});

test("una incidencia desconocida o un detalle roto no rompen la pantalla", () => {
  const unknown = toIncidentView(row({ entity: "algo", field: "nuevo", detail: "texto" }));
  assert.equal(unknown.title, "Referencia que ya faltaba en el origen");
  assert.equal(unknown.startsAt, null);
  assert.equal(toIncidentView(row({ detail: null })).startsAt, null);
  assert.equal(toIncidentView(row({ detail: { inicio: "" } })).startsAt, null);
});

test("se agrupan por la fila de la web a la que pertenecen; las que no tienen fila (otra cuenta o sin importar) se ignoran", () => {
  const grouped = groupIncidentViews(
    [row({ id: "a", row_legacy_id: "lesson_1" }), row({ id: "b", row_legacy_id: "lesson_2" }), row({ id: "c", row_legacy_id: "lesson_1", field: "otro" }), row({ id: "d", row_legacy_id: "lesson_x" })],
    new Map([
      ["lesson_1", "uuid-1"],
      ["lesson_2", "uuid-2"],
    ])
  );
  assert.deepEqual(Object.keys(grouped).sort(), ["uuid-1", "uuid-2"]);
  assert.deepEqual(grouped["uuid-1"].map((v) => v.id), ["a", "c"]);
});
