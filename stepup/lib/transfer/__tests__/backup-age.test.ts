import { test } from "node:test";
import assert from "node:assert/strict";
import { describeBackupAge, FRESH_BACKUP_MAX_MINUTES } from "../backup-age.ts";

const now = new Date(2026, 9, 19, 12, 0, 0); // 19/10/2026 12:00 hora local

test("un respaldo reciente es vigente y se informa con fecha día/mes/año", () => {
  const age = describeBackupAge(new Date(2026, 9, 19, 11, 50, 0).toISOString(), now);
  assert.ok(age);
  assert.equal(age.minutes, 10);
  assert.equal(age.fresh, true);
  assert.equal(age.createdAtLabel, "19/10/2026 11:50");
  assert.doesNotMatch(age.message, /AVISO/);
});

test("pasado el límite avisa que lo cargado después no está en la copia y qué hacer", () => {
  const age = describeBackupAge(new Date(2026, 9, 19, 9, 30, 0).toISOString(), now);
  assert.ok(age);
  assert.equal(age.fresh, false);
  assert.match(age.message, /AVISO/);
  assert.match(age.message, /2 h 30 min/);
  assert.match(age.message, /Protección automática activa/);
});

test("el límite es inclusivo y el reloj adelantado nunca da minutos negativos", () => {
  assert.equal(describeBackupAge(new Date(2026, 9, 19, 11, 45, 0).toISOString(), now)?.fresh, FRESH_BACKUP_MAX_MINUTES === 15);
  assert.equal(describeBackupAge(new Date(2026, 9, 19, 12, 5, 0).toISOString(), now)?.minutes, 0);
});

test("sin fecha o con fecha inválida no inventa nada", () => {
  assert.equal(describeBackupAge(null, now), null);
  assert.equal(describeBackupAge("no es una fecha", now), null);
});
