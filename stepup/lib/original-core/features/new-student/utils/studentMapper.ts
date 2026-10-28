// Puerto VERBATIM del original (`src/features/new-student/utils/studentMapper.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentBillingPlan, StudentProfile } from '../../student-profile/types/index.ts';
import type { StudentListItem } from '../../students/types/index.ts';
import { calculateAge } from '../../student-profile/utils/format.ts';
import { ARGENTINA_TIME_ZONE, billingPeriodOfDateKey, localDateKeyInTimeZone, nextBillingPeriod } from '../../payments/utils/paymentDates.ts';
import { DEFAULT_MONTHLY_DUE_DAY, resolveEffectiveBillingAmount, resolveStudentBillingPlan } from '../../student-profile/utils/studentBillingPlan.ts';
import type { NewStudentFormState } from '../types/index.ts';
import { primaryStandardLevel } from '../../students/utils/studentLevelsCore.ts';

/**
 * Corrección (a pedido de Joaquín — niveles combinables): `initialLevel`/
 * `levelHistory` son conceptos exclusivamente CEFR (base de "Registrar
 * cambio de nivel", que nunca se rediseñó para multiselección) — necesitan
 * UN valor, no la lista completa. Se usa el primer estándar presente; si el
 * alumno arranca con sólo niveles personalizados (sin ningún A1-C2), cae al
 * primer nivel elegido tal cual, nunca inventa "A1" de la nada.
 */
function resolveAchievementBaselineLevel(levels: string[]): string {
  return primaryStandardLevel(levels) ?? levels[0] ?? 'A1';
}

/**
 * Corrección 2026-07-26 (a pedido de Joaquín — ciclo mensual de cobros):
 * sólo el caso "comienza a pagar el mes siguiente" necesita un
 * `billingPlan` explícito con `startPeriod` — "ya pagado"/"pendiente" dejan
 * el plan sin tocar (sigue derivándose de `billingType`/`price` como
 * siempre, vía `resolveStudentBillingPlan`), porque la obligación del mes
 * actual ya se crea de inmediato (ver `NewStudentScreen.tsx`, que llama a
 * `applyFirstMonthSituation` después de guardar el perfil) y no hace falta
 * ninguna restricción de período para que el ciclo mensual siga solo.
 */
function resolveFirstMonthBillingPlan(form: NewStudentFormState, amount: number): StudentBillingPlan | undefined {
  if (form.billingType !== 'mensual' || form.firstMonthSituation !== 'starts_next_month') {
    return undefined;
  }
  const currentBillingPeriod = billingPeriodOfDateKey(localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE));
  return { type: 'monthly', amount, dueDay: DEFAULT_MONTHLY_DUE_DAY, startPeriod: nextBillingPeriod(currentBillingPeriod) };
}

export interface MappedNewStudent {
  listItem: StudentListItem;
  profile: StudentProfile;
}

function createEstimatedBirthDate(age: number): string {
  const currentYear = new Date().getFullYear();
  const estimatedBirthDate = new Date(currentYear - age, 0, 1);

  return estimatedBirthDate.toISOString();
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

function splitTextIntoItems(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function mapNewStudentForm(
  form: NewStudentFormState
): MappedNewStudent {
  const id = `student_${Date.now()}`;
  const now = new Date().toISOString();
  const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`;
  // La validación (`validateNewStudentForm`) ya garantiza un entero positivo
  // antes de llegar acá — el `?? 0` es sólo defensivo para el tipo.
  const price = form.price ?? 0;
  const weeklyFrequency = Number(form.weeklyFrequency);
  const usualDurationMinutes = Number(form.usualDurationMinutes);

  const listItem: StudentListItem = {
    id,
    name: fullName,
    levels: form.levels,
    modality: form.modality,
    status: form.status,
    nextClassAt: null,
    paymentStatus: 'verde',
    averageGrade: null,
    classesThisMonth: 0,
    lastPaymentAt: null,
    isFeatured: false,
    isNew: true,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: false,
  };

  const profile: StudentProfile = {
    id,
    name: fullName,
    whatsapp: form.whatsapp.trim() || undefined,
    email: form.email.trim() || undefined,
    birthDate: form.age.trim() ? createEstimatedBirthDate(Number(form.age)) : undefined,
    levels: form.levels,
    initialLevel: resolveAchievementBaselineLevel(form.levels),
    modality: form.modality,
    status: form.status,
    category: form.category,
    billingType: form.billingType,
    billingPlan: resolveFirstMonthBillingPlan(form, price),
    dateJoined: now,
    lastReactivatedAt: null,
    statusChangeDate:
      form.status === 'activo' ? null : now,
    usualDurationMinutes,
    weeklyFrequency,
    price,

    averageGrade: null,
    classesThisMonth: 0,
    attendanceRate: 100,
    paymentStatus: 'verde',
    nextClassAt: null,
    lastClassAt: null,

    pendingHomework: null,
    alerts: [],
    notes: form.notes.trim() || undefined,
    currentGoals: splitTextIntoItems(form.goals),
    strengths: [],
    areasToImprove: [],

    totalClasses: 0,
    totalHoursTaken: 0,
    totalInvested: 0,
    statusHistory: [
      {
        status: form.status,
        date: now,
      },
    ],
    levelHistory: [
      {
        level: resolveAchievementBaselineLevel(form.levels),
        date: now,
      },
    ],
    priceHistory: [
      {
        price,
        date: now,
      },
    ],
    skillGradesHistory: [],
  };

  return {
    listItem,
    profile,
  };
}

export function mapStudentToEditableForm(profile: StudentProfile): NewStudentFormState {
  // Corrección 2026-08-10 (a pedido de Joaquín — edición de cuota y estado
  // de pago desincronizados): el precio que se muestra al abrir "Editar
  // alumno" es el importe EFECTIVO REAL (`resolveStudentBillingPlan` +
  // `resolveEffectiveBillingAmount`, la única vía canónica) — nunca
  // `profile.price` crudo, que puede haber quedado desactualizado si el
  // alumno tiene un `billingPlan` explícito con un importe distinto (la
  // causa raíz exacta reportada). Este valor es sólo INFORMATIVO en el
  // formulario de edición: cambiar la cuota real se hace desde los sheets
  // dedicados (`EditBillingPlanSheet`/`EditMonthlyAmountSheet`), nunca
  // reenviando este campo como si fuera la fuente de verdad.
  const billingPeriod = billingPeriodOfDateKey(localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE));
  const effectivePrice = resolveEffectiveBillingAmount(resolveStudentBillingPlan(profile), billingPeriod);
  return {
    ...splitName(profile.name),
    age: (() => {
      const age = calculateAge(profile.birthDate);
      return age !== null ? String(age) : '';
    })(),
    phone: profile.phone ?? '',
    whatsapp: profile.whatsapp ?? '',
    email: profile.email ?? '',
    levels: profile.levels,
    modality: profile.modality,
    category: profile.category,
    billingType: profile.billingType,
    // "Situación del primer mes" es una acción del momento del alta —
    // nunca se vuelve a ofrecer al editar (ver NewStudentScreen.tsx: el
    // bloque completo queda oculto cuando isEditing).
    firstMonthSituation: 'pending',
    paidAt: '',
    price: effectivePrice > 0 ? effectivePrice : profile.price,
    weeklyFrequency: String(profile.weeklyFrequency),
    usualDurationMinutes: String(profile.usualDurationMinutes),
    goals: profile.currentGoals.join('\n'),
    notes: profile.notes ?? '',
    status: profile.status,
    usualDays: profile.usualDays ?? [],
    usualTime: profile.usualTime ?? '',
  };
}

// Corrección 2026-08-10 (a pedido de Joaquín — edición de cuota y estado de
// pago desincronizados): "Editar alumno" ya NO escribe billingType/
// billingPlan/price/priceHistory — esos campos financieros ahora se editan
// EXCLUSIVAMENTE desde los sheets dedicados dentro de NewStudentScreen.tsx
// (`EditBillingPlanSheet`/`EditMonthlyAmountSheet`, los mismos que ya usa
// Cobros), que reconcilian el cargo mensual abierto y nunca dejan
// `profile.price`/`billingPlan.amount` divergir en silencio. Esta función
// sólo sigue tocando los datos personales/académicos del formulario.
export function mapEditedStudentForm(
  form: NewStudentFormState,
  currentListItem: StudentListItem,
  currentProfile: StudentProfile
): MappedNewStudent {
  const name = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
  const requestedAge = form.age.trim() ? Number(form.age) : null;
  const nextBirthDate =
    requestedAge === null
      ? undefined
      : requestedAge === calculateAge(currentProfile.birthDate)
        ? currentProfile.birthDate
        : createEstimatedBirthDate(requestedAge);
  const now = new Date().toISOString();
  // Corrección (a pedido de Joaquín — niveles combinables): `levelHistory`
  // sigue siendo un registro exclusivamente CEFR (mismo criterio de
  // `resolveAchievementBaselineLevel`) — se agrega una entrada sólo cuando
  // cambia "el" nivel estándar del alumno dentro de la lista, igual que
  // antes comparaba `form.level !== currentProfile.level` con un único
  // valor. Agregar/quitar sólo niveles personalizados nunca toca este
  // historial.
  const previousBaselineLevel = resolveAchievementBaselineLevel(currentProfile.levels);
  const nextBaselineLevel = resolveAchievementBaselineLevel(form.levels);
  return {
    listItem: {
      ...currentListItem,
      name,
      levels: form.levels,
      modality: form.modality,
      status: currentListItem.status,
    },
    profile: {
      ...currentProfile,
      name,
      whatsapp: form.whatsapp.trim() || undefined,
      email: form.email.trim() || undefined,
      birthDate: nextBirthDate,
      levels: form.levels,
      modality: form.modality,
      category: form.category,
      weeklyFrequency: Number(form.weeklyFrequency),
      usualDurationMinutes: Number(form.usualDurationMinutes),
      currentGoals: splitTextIntoItems(form.goals),
      notes: form.notes.trim() || undefined,
      levelHistory: nextBaselineLevel !== previousBaselineLevel
        ? [...currentProfile.levelHistory, { level: nextBaselineLevel, date: now }]
        : currentProfile.levelHistory,
    },
  };
}
