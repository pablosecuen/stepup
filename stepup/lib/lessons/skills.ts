/** Puerto exacto de `SKILLS`/`Skill`/`SKILL_LABEL` (móvil, `types/index.ts` + `EvaluationSection.tsx`) — mismas 8 áreas, mismo orden, nunca inventadas. */
export const SKILLS = ["speaking", "listening", "reading", "writing", "grammar", "vocabulary", "pronunciation", "participation"] as const;

export type Skill = (typeof SKILLS)[number];

export const SKILL_LABEL: Record<Skill, string> = {
  speaking: "Habla",
  listening: "Escucha",
  reading: "Lectura",
  writing: "Escritura",
  grammar: "Gramática",
  vocabulary: "Vocabulario",
  pronunciation: "Pronunciación",
  participation: "Participación",
};
