import { test } from "node:test";
import assert from "node:assert/strict";
import { patternSelfOverlap, planSeriesSlotMove } from "../slot-move.ts";
import { generateOccurrences } from "../recurrence-engine.ts";
import { localDateTimeToInstantIso, getLocalDateKey, getLocalTimeKey } from "../timezone.ts";
import { mondayOfWeekContaining } from "../weekday.ts";
import type { RecurrenceWeek } from "../types.ts";

const TZ = "America/Argentina/Buenos_Aires";
const at = (date: string, time: string) => localDateTimeToInstantIso({ date, hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)), timeZone: TZ });
const session = (weekday: number, time: string, durationMinutes = 60) => ({ weekday, hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)), durationMinutes });
const rule = (weeks: RecurrenceWeek[], startDate = "2026-10-26") => ({ weeks, startDate, endDate: null, timezone: TZ });
const TODAY = "2026-11-01";

/** Las clases que genera el patrón nuevo desde su lunes de arranque, ya sin las anteriores a la fecha efectiva (como lo hace la sucesora real). */
function occurrencesFrom(weeks: RecurrenceWeek[], effectiveDate: string, days = 28) {
  const monday = mondayOfWeekContaining(effectiveDate);
  const from = new Date(at(effectiveDate, "00:00"));
  const until = new Date(from.getTime() + days * 86_400_000);
  return generateOccurrences(
    { recurrenceId: "x", studentId: null, participantIds: [], cycleLengthWeeks: weeks.length, weeks, modality: "online", timezone: TZ, startDate: monday, endDate: null, status: "active", classTitle: null, activityKind: "class" },
    from,
    until
  ).map((occurrence) => `${getLocalDateKey(occurrence.start, TZ)} ${getLocalTimeKey(occurrence.start, TZ)}`);
}

test("una serie semanal: la clase del lunes pasa al miércoles a otra hora y desde ahí hay UNA sola clase por semana", () => {
  const weeks = [{ weekIndex: 0, sessions: [session(0, "18:00")] }];
  const plan = planSeriesSlotMove({ rule: rule(weeks), originalStartIso: at("2026-11-02", "18:00"), targetDate: "2026-11-04", targetTime: "18:30", todayDate: TODAY });
  assert.ok(plan.ok);
  assert.equal(plan.effectiveDate, "2026-11-02");
  assert.deepEqual(plan.weeks, [{ weekIndex: 0, sessions: [session(2, "18:30")] }]);
  assert.deepEqual(occurrencesFrom(plan.weeks, plan.effectiveDate, 21), ["2026-11-04 18:30", "2026-11-11 18:30", "2026-11-18 18:30"], "no queda ni la clase del lunes ni una segunda del miércoles");
});

test("un día anterior de la misma semana: rige desde ese día y la clase original deja de existir", () => {
  const weeks = [{ weekIndex: 0, sessions: [session(4, "10:00")] }]; // viernes
  const plan = planSeriesSlotMove({ rule: rule(weeks), originalStartIso: at("2026-11-06", "10:00"), targetDate: "2026-11-03", targetTime: "09:15", todayDate: TODAY });
  assert.ok(plan.ok);
  assert.equal(plan.effectiveDate, "2026-11-03", "desde el día más temprano entre la original y la nueva");
  assert.deepEqual(occurrencesFrom(plan.weeks, plan.effectiveDate, 14), ["2026-11-03 09:15", "2026-11-10 09:15"]);
});

test("inicios :00, :15, :30 y :45 y se conserva la duración de la sesión (el horario nunca cambia la duración)", () => {
  const weeks = [{ weekIndex: 0, sessions: [session(1, "17:00", 90)] }];
  for (const time of ["17:00", "17:15", "17:30", "17:45", "18:15"]) {
    const plan = planSeriesSlotMove({ rule: rule(weeks), originalStartIso: at("2026-11-03", "17:00"), targetDate: "2026-11-05", targetTime: time, todayDate: TODAY });
    assert.ok(plan.ok, time);
    assert.deepEqual(plan.weeks[0].sessions, [session(3, time, 90)]);
  }
});

test("un grupo con dos sesiones por semana: sólo cambia la sesión elegida y las demás quedan como estaban", () => {
  const weeks = [{ weekIndex: 0, sessions: [session(0, "18:00"), session(3, "18:00"), session(4, "09:00", 45)] }];
  const plan = planSeriesSlotMove({ rule: rule(weeks), originalStartIso: at("2026-11-05", "18:00"), targetDate: "2026-11-06", targetTime: "19:00", todayDate: TODAY });
  assert.ok(plan.ok);
  assert.deepEqual(plan.weeks[0].sessions, [session(0, "18:00"), session(4, "09:00", 45), session(4, "19:00")]);
  assert.equal(patternSelfOverlap(plan.weeks), false);
});

test("el nuevo horario no puede pisar otra sesión de la misma serie", () => {
  const weeks = [{ weekIndex: 0, sessions: [session(0, "18:00"), session(2, "18:30")] }];
  const plan = planSeriesSlotMove({ rule: rule(weeks), originalStartIso: at("2026-11-02", "18:00"), targetDate: "2026-11-04", targetTime: "18:00", todayDate: TODAY });
  assert.equal(plan.ok, false);
  assert.match((plan as { error: string }).error, /superpone con otra clase de esta misma serie/);
});

test("ciclo de dos semanas: la sesión conserva su semana y la numeración se reancla a la fecha efectiva", () => {
  // Semana 0 (desde el lunes 26/10): lunes 18:00. Semana 1 (2/11): jueves 18:00. La clase elegida es la del jueves 5/11.
  const weeks = [{ weekIndex: 0, sessions: [session(0, "18:00")] }, { weekIndex: 1, sessions: [session(3, "18:00")] }];
  const plan = planSeriesSlotMove({ rule: rule(weeks, "2026-10-26"), originalStartIso: at("2026-11-05", "18:00"), targetDate: "2026-11-06", targetTime: "18:30", todayDate: TODAY });
  assert.ok(plan.ok);
  // Desde el 5/11 (semana de arranque = lunes 2/11, que es la semana 1 del patrón viejo): el jueves pasa al viernes y el lunes sigue siendo la semana siguiente.
  assert.deepEqual(occurrencesFrom(plan.weeks, plan.effectiveDate, 28), ["2026-11-06 18:30", "2026-11-09 18:00", "2026-11-20 18:30", "2026-11-23 18:00"]);
});

test("rechaza lo que no se puede garantizar: pasado, más de una semana, fuera de la serie, hora inválida o una clase que no está en el patrón", () => {
  const weeks = [{ weekIndex: 0, sessions: [session(0, "18:00")] }];
  const base = { rule: rule(weeks), originalStartIso: at("2026-11-02", "18:00"), todayDate: TODAY };
  assert.match((planSeriesSlotMove({ ...base, targetDate: "2026-11-10", targetTime: "18:00" }) as { error: string }).error, /misma semana/);
  assert.match((planSeriesSlotMove({ ...base, todayDate: "2026-11-03", targetDate: "2026-11-04", targetTime: "18:00" }) as { error: string }).error, /fecha pasada/);
  assert.match((planSeriesSlotMove({ ...base, targetDate: "2026-11-04", targetTime: "25:00" }) as { error: string }).error, /día y una hora válidos/);
  assert.match((planSeriesSlotMove({ ...base, rule: { ...base.rule, endDate: "2026-11-03" }, targetDate: "2026-11-04", targetTime: "18:00" }) as { error: string }).error, /fuera de la serie/);
  assert.match((planSeriesSlotMove({ ...base, originalStartIso: at("2026-11-02", "19:00"), targetDate: "2026-11-04", targetTime: "18:00" }) as { error: string }).error, /No encontramos el horario de esta clase/);
});

test("la hora elegida puede ser la misma y sólo cambia el día (o al revés)", () => {
  const weeks = [{ weekIndex: 0, sessions: [session(0, "18:00")] }];
  const onlyTime = planSeriesSlotMove({ rule: rule(weeks), originalStartIso: at("2026-11-02", "18:00"), targetDate: "2026-11-02", targetTime: "18:45", todayDate: TODAY });
  assert.ok(onlyTime.ok);
  assert.deepEqual(occurrencesFrom(onlyTime.weeks, onlyTime.effectiveDate, 14), ["2026-11-02 18:45", "2026-11-09 18:45"]);
  const onlyDay = planSeriesSlotMove({ rule: rule(weeks), originalStartIso: at("2026-11-02", "18:00"), targetDate: "2026-11-03", targetTime: "18:00", todayDate: TODAY });
  assert.ok(onlyDay.ok);
  assert.deepEqual(occurrencesFrom(onlyDay.weeks, onlyDay.effectiveDate, 14), ["2026-11-03 18:00", "2026-11-10 18:00"]);
});
