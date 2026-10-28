// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/teacherAvailabilityEngine.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { TeacherAvailability } from '../../types/teacherAvailability.ts';
import { evaluateAvailability } from '../teacherAvailabilityEngine.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const base: TeacherAvailability = {
  schemaVersion: 1,
  timezone: 'America/Argentina/Buenos_Aires',
  weeklyBlocks: [
    { id: 'work-mon', weekday: 0, startTime: '09:00', endTime: '12:00', reason: 'work' },
  ],
  exceptions: [],
};

const iso = (local: string) => `${local}:00.000-03:00`;

let result = evaluateAvailability(iso('2026-07-13T10:00'), iso('2026-07-13T11:00'), base);
assert(!result.isAvailable && result.conflict?.kind === 'weekly_block', 'detecta bloqueo semanal');
assert(result.label === 'Otro trabajo', 'devuelve etiqueta semanal');

result = evaluateAvailability(iso('2026-07-13T08:00'), iso('2026-07-13T09:00'), base);
assert(result.isAvailable, 'el límite inicial no solapa por intervalos [start,end)');
result = evaluateAvailability(iso('2026-07-13T12:00'), iso('2026-07-13T13:00'), base);
assert(result.isAvailable, 'el límite final tampoco solapa');

const vacation: TeacherAvailability = {
  ...base,
  weeklyBlocks: [],
  exceptions: [
    {
      id: 'vacation', date: '2026-07-15', endDate: '2026-07-17',
      type: 'unavailable_full_day', reason: 'vacation',
    },
  ],
};
result = evaluateAvailability(iso('2026-07-17T18:00'), iso('2026-07-17T19:00'), vacation);
assert(!result.isAvailable && result.label === 'Vacaciones', 'endDate de vacaciones es inclusive');
result = evaluateAvailability(iso('2026-07-18T10:00'), iso('2026-07-18T11:00'), vacation);
assert(result.isAvailable, 'día posterior a vacaciones disponible');

const fullOverride: TeacherAvailability = {
  ...base,
  exceptions: [
    {
      id: 'extra', date: '2026-07-13', type: 'available_extra',
      startTime: '09:30', endTime: '11:30', reason: 'other',
    },
  ],
};
result = evaluateAvailability(iso('2026-07-13T10:00'), iso('2026-07-13T11:00'), fullOverride);
assert(result.isAvailable && result.label === 'Disponibilidad extra', 'override total habilita');

const partialOverride: TeacherAvailability = {
  ...base,
  exceptions: [
    {
      id: 'extra-partial', date: '2026-07-13', type: 'available_extra',
      startTime: '10:30', endTime: '11:30', reason: 'other',
    },
  ],
};
result = evaluateAvailability(iso('2026-07-13T10:00'), iso('2026-07-13T11:00'), partialOverride);
assert(!result.isAvailable, 'override parcial no oculta conflicto');

const unavailableBlock: TeacherAvailability = {
  ...base,
  weeklyBlocks: [],
  exceptions: [
    {
      id: 'leave', date: '2026-07-14', type: 'unavailable_block',
      startTime: '15:00', endTime: '17:00', reason: 'leave', note: 'Turno médico',
    },
  ],
};
result = evaluateAvailability(iso('2026-07-14T16:30'), iso('2026-07-14T17:30'), unavailableBlock);
assert(!result.isAvailable && result.label === 'Turno médico', 'bloque excepcional y nota');
assert(result.conflict?.overlapEnd === '2026-07-14T20:00:00.000Z', 'solapamiento respeta zona BA');

result = evaluateAvailability('2026-07-13T12:30:00.000Z', '2026-07-13T13:30:00.000Z', base);
assert(!result.isAvailable, 'convierte UTC a lunes 09:30-10:30 en Buenos Aires');

// ---------------------------------------------------------------------------
// Corrección 2026-07-31 (a pedido de Joaquín — horarios de 15 minutos):
// escenario 8 del pedido — un horario de cuarto de hora respeta bloqueos
// semanales y vacaciones igual que cualquier otro, sin redondear.
// ---------------------------------------------------------------------------

result = evaluateAvailability(iso('2026-07-13T09:15'), iso('2026-07-13T10:15'), base);
assert(
  !result.isAvailable && result.conflict?.kind === 'weekly_block',
  'escenario 8: un horario de cuarto de hora (09:15) también respeta el bloqueo semanal de trabajo'
);

result = evaluateAvailability(iso('2026-07-17T09:15'), iso('2026-07-17T10:15'), vacation);
assert(
  !result.isAvailable && result.label === 'Vacaciones',
  'escenario 8: un horario de cuarto de hora dentro del rango de vacaciones sigue bloqueado'
);

console.log('teacherAvailabilityEngine: 14 verificaciones aprobadas');
