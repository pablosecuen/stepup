// Puerto VERBATIM del original (`src/features/dashboard/utils/__tests__/remindersCenter.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CollectionEntryWithStudent } from '../../../payments/hooks/useCollectionsCenter.ts';
import type { EmptyClassItem } from '../emptyClasses.ts';
import type { PendingClass } from '../../types/index.ts';
import { buildRemindersCenterSummary } from '../remindersCenter.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyClassItem(overrides: Partial<EmptyClassItem> & { key: string }): EmptyClassItem {
  return {
    kind: 'standalone',
    title: 'Clase suelta sin alumnos',
    startIso: '2026-07-25T18:00:00.000Z',
    ...overrides,
  };
}

function pendingClass(overrides: Partial<PendingClass> & { reservationKey: string }): PendingClass {
  return {
    calendarLessonId: 'lesson-1',
    studentId: 'student-1',
    studentNames: ['Juan Emee'],
    participants: [{ studentId: 'student-1', studentName: 'Juan Emee' }],
    displayTitle: 'Juan Emee',
    isGroupClass: false,
    isRecurring: false,
    status: 'scheduled',
    start: '2026-07-20T18:00:00.000Z',
    end: '2026-07-20T19:00:00.000Z',
    durationMinutes: 60,
    modality: 'presencial',
    calendarRegistration: {
      reservationKey: overrides.reservationKey,
      lessonId: 'lesson-1',
      studentId: 'student-1',
      start: '2026-07-20T18:00:00.000Z',
      end: '2026-07-20T19:00:00.000Z',
      modality: 'presencial',
      recurrenceId: null,
      recurrenceOccurrenceKey: null,
    },
    ...overrides,
  };
}

function collectionEntry(
  overrides: Partial<CollectionEntryWithStudent> & { chargeId: string; studentName: string }
): CollectionEntryWithStudent {
  return {
    studentId: 'student-2',
    chargeType: 'mensual',
    concept: 'Mensualidad de julio 2026',
    pendingAmount: 15000,
    dueDate: '2026-07-25',
    urgency: 'vence_hoy',
    hasPartialPayment: false,
    needsFirstMonthProrationReview: false,
    ...overrides,
  };
}

test('sin nada pendiente: totalCount 0 y sin categorías (nunca se muestra un contador en cero)', () => {
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingClasses: [],
    collectionEntries: [],
  });
  assertEqual(summary.totalCount, 0, 'sin recordatorios');
  assertEqual(summary.categories.length, 0, 'ninguna categoría vacía debe aparecer');
});

test('clases sin alumnos: un ítem por EmptyClassItem, con su identidad de navegación intacta', () => {
  const item = emptyClassItem({ key: 'r1', kind: 'series', recurrenceId: 'r1', occurrenceKey: 'occ1' });
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [item],
    pendingClasses: [],
    collectionEntries: [],
  });
  assertEqual(summary.totalCount, 1, 'un recordatorio');
  const category = summary.categories.find((c) => c.kind === 'clases_sin_alumnos');
  assert(!!category, 'debe existir la categoría clases_sin_alumnos');
  assertEqual(category!.items.length, 1, 'un ítem');
  const reminderItem = category!.items[0];
  assert(reminderItem.kind === 'clases_sin_alumnos', 'kind correcto');
  if (reminderItem.kind === 'clases_sin_alumnos') {
    assertEqual(reminderItem.source, item, 'conserva el EmptyClassItem original para navegar, sin reconstruirlo');
  }
});

test('clases sin registrar: título distingue individual de grupal, conserva calendarRegistration para el registro real', () => {
  const individual = pendingClass({ reservationKey: 'k1' });
  const grupal = pendingClass({
    reservationKey: 'k2',
    isGroupClass: true,
    studentNames: ['Juan Emee', 'Martina Ruiz'],
  });
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingClasses: [individual, grupal],
    collectionEntries: [],
  });
  const category = summary.categories.find((c) => c.kind === 'clases_sin_registrar');
  assert(!!category, 'debe existir la categoría');
  assertEqual(category!.items.length, 2, 'dos ítems');
  const [firstItem, secondItem] = category!.items;
  assertEqual(firstItem.title, 'Juan Emee', 'individual muestra el nombre real');
  assertEqual(secondItem.title, 'Clase grupal · 2 alumnos', 'grupal nunca precarga un solo nombre como si fuera individual');
  if (firstItem.kind === 'clases_sin_registrar') {
    assertEqual(firstItem.source.calendarRegistration, individual.calendarRegistration, 'conserva calendarRegistration real para abrir el registro exacto');
  }
});

test('pagos: vence_hoy va a "pagos_por_vencer", cualquier etapa de mora va a "pagos_vencidos" — nunca el mismo cargo en las dos', () => {
  const dueToday = collectionEntry({ chargeId: 'c1', studentName: 'Ana', urgency: 'vence_hoy' });
  const firstLate = collectionEntry({ chargeId: 'c2', studentName: 'Bruno', urgency: 'primer_vencimiento' });
  const lastLate = collectionEntry({ chargeId: 'c3', studentName: 'Carla', urgency: 'ultimo_vencimiento' });
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingClasses: [],
    collectionEntries: [dueToday, firstLate, lastLate],
  });
  const porVencer = summary.categories.find((c) => c.kind === 'pagos_por_vencer');
  const vencidos = summary.categories.find((c) => c.kind === 'pagos_vencidos');
  assert(!!porVencer && !!vencidos, 'deben existir ambas categorías');
  assertEqual(porVencer!.items.length, 1, 'sólo el que vence hoy');
  assertEqual(vencidos!.items.length, 2, 'los dos con mora, sin importar la etapa');
  const allChargeIds = [...porVencer!.items, ...vencidos!.items].map((item) => item.id);
  assertEqual(new Set(allChargeIds).size, allChargeIds.length, 'ningún chargeId se repite entre categorías');
});

test('totalCount suma las 4 categorías reales, sin inventar una quinta de "revisión"', () => {
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [emptyClassItem({ key: 'e1' })],
    pendingClasses: [pendingClass({ reservationKey: 'p1' })],
    collectionEntries: [
      collectionEntry({ chargeId: 'c1', studentName: 'Ana', urgency: 'vence_hoy' }),
      collectionEntry({ chargeId: 'c2', studentName: 'Bruno', urgency: 'segundo_vencimiento' }),
    ],
  });
  assertEqual(summary.totalCount, 4, 'una clase sin alumnos + una sin registrar + un pago por vencer + un pago vencido');
  assertEqual(summary.categories.length, 4, 'las 4 categorías reales, ninguna quinta inventada');
});

test('nunca muta los arrays de entrada', () => {
  const emptyItems = [emptyClassItem({ key: 'e1' })];
  const pendingItems = [pendingClass({ reservationKey: 'p1' })];
  const collectionItems = [collectionEntry({ chargeId: 'c1', studentName: 'Ana' })];
  const emptySnapshot = JSON.stringify(emptyItems);
  const pendingSnapshot = JSON.stringify(pendingItems);
  const collectionSnapshot = JSON.stringify(collectionItems);

  buildRemindersCenterSummary({
    emptyClassItems: emptyItems,
    pendingClasses: pendingItems,
    collectionEntries: collectionItems,
  });

  assertEqual(JSON.stringify(emptyItems), emptySnapshot, 'emptyClassItems intacto');
  assertEqual(JSON.stringify(pendingItems), pendingSnapshot, 'pendingClasses intacto');
  assertEqual(JSON.stringify(collectionItems), collectionSnapshot, 'collectionEntries intacto');
});
