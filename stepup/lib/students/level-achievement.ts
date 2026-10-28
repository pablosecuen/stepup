import type { LevelHistoryRecord } from "../repositories/student-history-mapping.ts";
import { parseCivilDateKey } from "../calendar/civil-calendar.ts";

export const ACHIEVEMENT_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** Mismas reglas de LevelAchievementSheet/planLevelAchievement del original. */
export function levelAchievementPreview(input: {
  levels: string[]; history: LevelHistoryRecord[]; dateJoined: string;
  level: string; date: string; today: string;
}): { error?: string; warning?: string; durationDays?: number; fromLevel?: string } {
  const { level, date, today } = input;
  if (!ACHIEVEMENT_LEVELS.includes(level as typeof ACHIEVEMENT_LEVELS[number])) return { error: "Elegí un nivel de A1 a C2." };
  if (!parseCivilDateKey(date)) return { error: "La fecha del logro no es válida." };
  if (date > today) return { error: "La fecha del logro no puede ser futura." };
  const fromLevel = input.levels.find((entry) => (ACHIEVEMENT_LEVELS as readonly string[]).includes(entry)) ?? "";
  if (level === fromLevel) return { error: "El alumno ya está en ese nivel: elegí un nivel distinto." };
  const last = [...input.history].sort((a, b) => a.achievedOn.localeCompare(b.achievedOn)).at(-1);
  const baseline = last?.achievedOn ?? input.dateJoined;
  if (date < baseline) return { error: last ? "La fecha no puede ser anterior al último logro registrado." : "La fecha no puede ser anterior al inicio del alumno." };
  const difference = ACHIEVEMENT_LEVELS.indexOf(level as typeof ACHIEVEMENT_LEVELS[number]) - ACHIEVEMENT_LEVELS.indexOf(fromLevel as typeof ACHIEVEMENT_LEVELS[number]);
  return {
    fromLevel,
    durationDays: Math.round((Date.parse(date) - Date.parse(baseline)) / 86400000),
    warning: fromLevel && difference < 0 ? `Es una corrección de ${fromLevel} a ${level}. Confirmá el cambio.` : fromLevel && difference > 1 ? `El cambio salta de ${fromLevel} a ${level}. Confirmá el salto de nivel.` : undefined,
  };
}
