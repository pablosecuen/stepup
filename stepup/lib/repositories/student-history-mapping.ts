import type { StudentLevelHistoryRow, StudentPriceHistoryRow, StudentStatusHistoryRow } from "../db/database.types.ts";

export interface StatusHistoryRecord {
  id: string;
  status: StudentStatusHistoryRow["status"];
  occurredOn: string;
  reason: string | null;
  internalNote: string | null;
}

export function toStatusHistoryRecord(row: StudentStatusHistoryRow): StatusHistoryRecord {
  return { id: row.id, status: row.status, occurredOn: row.occurred_on, reason: row.reason, internalNote: row.internal_note };
}

export interface LevelHistoryRecord {
  id: string;
  level: string;
  fromLevel: string | null;
  achievedOn: string;
}

export function toLevelHistoryRecord(row: StudentLevelHistoryRow): LevelHistoryRecord {
  return { id: row.id, level: row.level, fromLevel: row.from_level, achievedOn: row.achieved_on };
}

export interface PriceHistoryRecord {
  id: string;
  price: number;
  effectiveOn: string;
}

export function toPriceHistoryRecord(row: StudentPriceHistoryRow): PriceHistoryRecord {
  return { id: row.id, price: row.price, effectiveOn: row.effective_on };
}
