// Puerto VERBATIM del original (`src/features/calendar/utils/calendarDates.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
export const WEEK_DAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

export const HOURS = Array.from(
  { length: 16 },
  (_, i) => i + 8
);