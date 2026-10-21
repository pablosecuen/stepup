import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLegacyRegisteredOccurrenceKeys } from "../legacy-registered.ts";

test("las incidencias «la clase del calendario no existe en el respaldo» dan la clave de la ocurrencia con el id NUEVO de la serie", () => {
  const rules = [
    { id: "11111111-1111-1111-1111-111111111111", legacy_mobile_id: "recurrence_1785435689034_vq03ad" },
    { id: "22222222-2222-2222-2222-222222222222", legacy_mobile_id: null },
  ];
  const incidents = [
    { field: "calendarLessonId", detail: { motivo: "…", ocurrencia: "recurrence_1785435689034_vq03ad:w0:c0:d4:t1330:s1", inicio: "2026-08-07T16:30:00.000Z" } },
    { field: "calendarLessonId", detail: { ocurrencia: "serie_desconocida:w0:c0:d1:t1000:s0" } },
    { field: "calendarLessonId", detail: { ocurrencia: "" } },
    { field: "calendarLessonId", detail: {} },
    { field: "paymentId", detail: { ocurrencia: "recurrence_1785435689034_vq03ad:w1:c0:d4:t1330:s1" } },
    { field: "calendarLessonId", detail: null },
  ];
  const keys = buildLegacyRegisteredOccurrenceKeys(incidents, rules);
  assert.deepEqual([...keys], ["11111111-1111-1111-1111-111111111111|11111111-1111-1111-1111-111111111111:w0:c0:d4:t1330:s1"]);
  assert.equal(buildLegacyRegisteredOccurrenceKeys([], rules).size, 0);
});
