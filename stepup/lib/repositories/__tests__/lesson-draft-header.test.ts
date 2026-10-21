import test from "node:test";
import assert from "node:assert/strict";
import "../../db/__tests__/support/register-alias.mjs";
import { FakePostgrest } from "../../db/__tests__/support/fake-postgrest.ts";

// «Guardar progreso»: el repositorio manda a la RPC sólo lo que viene (ausente = no se toca); vacío = se borra.

const { saveLessonContentDraft } = await import("../lesson-registrations.ts");
const content = { topics: [], objectives: [], activities: [], activityNotes: "", internalNotes: "", materialIds: [] as string[] };

async function payloadFor(header?: Parameters<typeof saveLessonContentDraft>[3]) {
  const seen: Record<string, unknown>[] = [];
  const fake = new FakePostgrest({ rpcs: { save_lesson_content_draft: (args) => { seen.push(args); return null; } } });
  await saveLessonContentDraft({ supabase: fake as never, ownerId: "o" } as never, "reg-1", content, header);
  return seen[0].p_payload as Record<string, unknown>;
}

test("sin encabezado el pedido es el de siempre: contenido y nada más (la tarea y la duración no se tocan)", async () => {
  const payload = await payloadFor();
  assert.deepEqual(Object.keys(payload).sort(), ["lesson_registration_id", "pedagogical_content"]);
});

test("con tarea, fecha y duración, viajan junto con el contenido", async () => {
  const payload = await payloadFor({ homeworkDescription: "Unidad 5", homeworkDueDate: "2026-10-28", actualStartedAt: "2026-10-21T13:00:00.000Z", actualEndedAt: "2026-10-21T14:30:00.000Z" });
  assert.equal(payload.homework_description, "Unidad 5");
  assert.equal(payload.homework_due_date, "2026-10-28");
  assert.equal(payload.actual_started_at, "2026-10-21T13:00:00.000Z");
  assert.equal(payload.actual_ended_at, "2026-10-21T14:30:00.000Z");
});

test("una tarea vaciada (null) se envía como vacía para borrarla; omitirla no la toca", async () => {
  const cleared = await payloadFor({ homeworkDescription: null, homeworkDueDate: null });
  assert.equal(cleared.homework_description, "");
  assert.equal(cleared.homework_due_date, "");
  assert.ok(!("actual_started_at" in cleared));
  const untouched = await payloadFor({ actualStartedAt: "2026-10-21T13:00:00.000Z" });
  assert.ok(!("homework_description" in untouched));
});
