import { test } from "node:test";
import assert from "node:assert/strict";
import { computeUndoAvailability, type ImportRunHistoryRow } from "../import-history-mapping.ts";

function baseRow(overrides: Partial<ImportRunHistoryRow> = {}): ImportRunHistoryRow {
  return {
    id: "run-1",
    status: "applied",
    createdAt: "2026-09-27T00:00:00.000Z",
    checksum: "abc123",
    schemaVersion: 2,
    appVersion: "1.0.0",
    totalRowsWritten: 3,
    countsByTable: { students: 3 },
    undoExpiresAt: "2026-10-27T00:00:00.000Z",
    undoneAt: null,
    payloadPurged: false,
    snapshotsPurged: false,
    ...overrides,
  };
}

const NOW = new Date("2026-09-27T12:00:00.000Z");

test("computeUndoAvailability: importación ya deshecha -> already_undone, nunca ofrece el botón de nuevo", () => {
  const row = baseRow({ status: "undone", undoneAt: "2026-09-27T01:00:00.000Z" });
  assert.deepEqual(computeUndoAvailability(row, NOW), { kind: "already_undone" });
});

test("computeUndoAvailability: snapshots purgados -> snapshots_purged, aunque no haya vencido el plazo nominal", () => {
  const row = baseRow({ snapshotsPurged: true, undoExpiresAt: "2026-12-01T00:00:00.000Z" });
  assert.deepEqual(computeUndoAvailability(row, NOW), { kind: "snapshots_purged" });
});

test("computeUndoAvailability: plazo vencido -> expired", () => {
  const row = baseRow({ undoExpiresAt: "2026-09-01T00:00:00.000Z" });
  assert.deepEqual(computeUndoAvailability(row, NOW), { kind: "expired" });
});

test("computeUndoAvailability: dentro de plazo, no deshecha, sin purgar -> available", () => {
  const row = baseRow();
  assert.deepEqual(computeUndoAvailability(row, NOW), { kind: "available" });
});

test("computeUndoAvailability: 'ya deshecha' pesa más que 'vencido' (un run deshecho después de vencer sigue siendo 'ya deshecha', nunca 'vencido')", () => {
  const row = baseRow({ status: "undone", undoneAt: "2026-09-28T00:00:00.000Z", undoExpiresAt: "2026-09-01T00:00:00.000Z" });
  assert.deepEqual(computeUndoAvailability(row, NOW), { kind: "already_undone" });
});
