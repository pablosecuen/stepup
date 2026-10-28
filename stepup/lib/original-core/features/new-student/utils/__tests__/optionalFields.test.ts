// Puerto VERBATIM del original (`src/features/new-student/utils/__tests__/optionalFields.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { validateNewStudentForm } from '../studentValidation.ts';
import { mapEditedStudentForm, mapNewStudentForm, mapStudentToEditableForm } from '../studentMapper.ts';
import type { NewStudentFormState } from '../../types/index.ts';
import { assert, assertEqual, finishTests, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function baseForm(overrides: Partial<NewStudentFormState> = {}): NewStudentFormState {
  return {
    firstName: 'Juan',
    lastName: 'Pérez',
    age: '',
    phone: '',
    whatsapp: '',
    email: '',
    levels: ['A1'],
    modality: 'presencial',
    category: 'adulto_interes_personal',
    billingType: 'por_clase',
    firstMonthSituation: 'pending',
    paidAt: '',
    price: 5000,
    weeklyFrequency: '1',
    usualDurationMinutes: '60',
    goals: '',
    notes: '',
    status: 'activo',
    usualDays: [],
    usualTime: '',
    ...overrides,
  };
}

test('validateNewStudentForm: acepta un alumno con edad, WhatsApp y correo vacíos (corrección 2026-07-24)', () => {
  const result = validateNewStudentForm(baseForm());
  assert(result.isValid, `debía ser válido, errores: ${result.errors.join(' | ')}`);
});

test('validateNewStudentForm: sigue rechazando una edad fuera de rango cuando SÍ se carga', () => {
  const result = validateNewStudentForm(baseForm({ age: '200' }));
  assert(!result.isValid, 'una edad de 200 sigue siendo inválida');
});

test('validateNewStudentForm: sigue rechazando un email con formato inválido cuando SÍ se carga', () => {
  const result = validateNewStudentForm(baseForm({ email: 'no-es-un-correo' }));
  assert(!result.isValid, 'un email mal formado sigue siendo inválido');
});

test('validateNewStudentForm: sigue exigiendo el nombre del alumno', () => {
  const result = validateNewStudentForm(baseForm({ firstName: '' }));
  assert(!result.isValid, 'el nombre sigue siendo obligatorio');
});

test('mapNewStudentForm: un alumno creado sólo con nombre no tiene birthDate', () => {
  const { profile } = mapNewStudentForm(baseForm());
  assertEqual(profile.birthDate, undefined, 'sin edad cargada, birthDate queda undefined');
  assertEqual(profile.whatsapp, undefined, 'sin WhatsApp cargado, queda undefined');
  assertEqual(profile.email, undefined, 'sin correo cargado, queda undefined');
});

test('mapNewStudentForm: cargar una edad sí produce un birthDate estimado', () => {
  const { profile } = mapNewStudentForm(baseForm({ age: '30' }));
  assert(typeof profile.birthDate === 'string' && profile.birthDate.length > 0, 'con edad cargada, birthDate se estima');
});

test('mapStudentToEditableForm: un perfil sin birthDate mapea a age vacío, nunca "null"', () => {
  const { profile } = mapNewStudentForm(baseForm());
  const editable = mapStudentToEditableForm(profile);
  assertEqual(editable.age, '', 'age vuelve a estar vacío, no como texto "null"');
});

test('mapEditedStudentForm: editar y volver a quitar la edad limpia birthDate', () => {
  const created = mapNewStudentForm(baseForm({ age: '25' }));
  const withAgeRemoved = mapEditedStudentForm(
    baseForm({ age: '' }),
    created.listItem,
    created.profile
  );
  assertEqual(withAgeRemoved.profile.birthDate, undefined, 'quitar la edad y guardar limpia birthDate');
});

test('mapEditedStudentForm: agregar una edad que no tenía crea un birthDate nuevo', () => {
  const created = mapNewStudentForm(baseForm());
  assertEqual(created.profile.birthDate, undefined, 'punto de partida: sin edad');
  const withAgeAdded = mapEditedStudentForm(
    baseForm({ age: '40' }),
    created.listItem,
    created.profile
  );
  assert(
    typeof withAgeAdded.profile.birthDate === 'string' && withAgeAdded.profile.birthDate.length > 0,
    'agregar una edad después sí produce un birthDate'
  );
});

test('mapEditedStudentForm: reenviar la misma edad no altera un birthDate ya existente', () => {
  const created = mapNewStudentForm(baseForm({ age: '25' }));
  const resaved = mapEditedStudentForm(baseForm({ age: '25' }), created.listItem, created.profile);
  assertEqual(resaved.profile.birthDate, created.profile.birthDate, 'la misma edad conserva el birthDate original');
});

finishTests('de alumno con campos opcionales');
