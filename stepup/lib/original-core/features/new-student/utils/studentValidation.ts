// Puerto VERBATIM del original (`src/features/new-student/utils/studentValidation.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { NewStudentFormState } from '../types/index.ts';
import { validateAmountInput } from '../../payments/utils/currencyAmountInput.ts';

export interface StudentValidationResult {
  isValid: boolean;
  errors: string[];
}

function isValidEmail(email: string): boolean {
  if (!email.trim()) return true;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Corrección 2026-07-24 (a pedido de Joaquín — edad/WhatsApp/correo dejan de
// ser obligatorios): un campo vacío siempre es válido — sólo se valida el
// formato/rango cuando la profesora efectivamente cargó un valor.
function isValidAge(age: string): boolean {
  if (!age.trim()) return true;
  const value = Number(age);

  return Number.isInteger(value) && value >= 3 && value <= 120;
}

function isValidPositiveNumber(value: string): boolean {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0;
}

function isValidNonNegativeNumber(value: string): boolean {
  const parsed = Number(value);
  return Boolean(value.trim()) && Number.isFinite(parsed) && parsed >= 0;
}

export function validateNewStudentForm(
  form: NewStudentFormState
): StudentValidationResult {
  const errors: string[] = [];

  if (!form.firstName.trim()) {
    errors.push('Ingresá el nombre del alumno.');
  }

  if (!form.lastName.trim()) {
    errors.push('Ingresá el apellido del alumno.');
  }

  if (!isValidAge(form.age)) {
    errors.push('La edad debe ser un número entre 3 y 120.');
  }

  if (!isValidEmail(form.email)) {
    errors.push('El email ingresado no es válido.');
  }

  // Corrección (a pedido de Joaquín — niveles combinables): el nivel NUNCA
  // es obligatorio para guardar — a diferencia de otros campos de esta
  // función, `form.levels` puede quedar vacío sin bloquear el alta/edición.

  // Corrección 2026-08-02 (a pedido de Joaquín — formato del monto al crear
  // un alumno): reutiliza el mismo validador que ya usa "Modificar monto
  // mensual" (`currencyAmountInput.ts`) — rechaza vacío, cero, negativo,
  // NaN, infinito y decimales con un único criterio, nunca duplicado acá.
  if (!validateAmountInput(form.price).isValid) {
    errors.push('El precio debe ser mayor que cero.');
  }

  if (!isValidNonNegativeNumber(form.weeklyFrequency)) {
    errors.push(
      'La cantidad habitual de clases no puede ser negativa.'
    );
  }

  if (!isValidPositiveNumber(form.usualDurationMinutes)) {
    errors.push(
      'La duración habitual debe ser mayor que cero.'
    );
  }

  if (
    Number(form.weeklyFrequency) > 14
  ) {
    errors.push(
      'La frecuencia semanal no puede superar 14 clases.'
    );
  }

  if (
    Number(form.usualDurationMinutes) > 480
  ) {
    errors.push(
      'La duración habitual no puede superar 480 minutos.'
    );
  }

  if (
    form.usualDays.length > 0 &&
    !form.usualTime.trim()
  ) {
    errors.push(
      'Elegí un horario habitual para los días seleccionados.'
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
