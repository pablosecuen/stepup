// Puerto VERBATIM del original (`src/features/new-student/types/index.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  BillingType,
  CEFRLevel,
  StudentCategory,
  StudentModality,
  StudentStatus,
} from '../../student-profile/types/index.ts';
import type { FirstMonthSituation } from '../../payments/utils/initialMonthlyBillingPlan.ts';

export type { FirstMonthSituation };

export interface NewStudentFormState {
  firstName: string;
  lastName: string;

  age: string;

  phone: string;
  whatsapp: string;
  email: string;

  /** Corrección (a pedido de Joaquín — niveles combinables): antes `level: CEFRLevel` único — ver `StudentListItem.levels`. */
  levels: CEFRLevel[];

  modality: StudentModality;

  category: StudentCategory;

  billingType: BillingType;

  /**
   * Corrección 2026-07-26 (a pedido de Joaquín — ciclo mensual de cobros):
   * "Situación del primer mes" — sólo tiene efecto cuando `billingType` es
   * `'mensual'`. Se ignora por completo para `'por_clase'` (esos alumnos
   * nunca generan una obligación mensual).
   */
  firstMonthSituation: FirstMonthSituation;

  /**
   * Corrección 2026-08-10 (a pedido de Joaquín — edición de cuota y estado
   * de pago desincronizados): fecha real del pago inicial (YYYY-MM-DD) —
   * sólo tiene efecto cuando `firstMonthSituation === 'paid'`. Vacío hasta
   * que la profesora elige "Este mes ya está pago" (ahí arranca en "hoy",
   * editable — nunca se le impone una fecha fija).
   */
  paidAt: string;

  /**
   * Corrección 2026-08-02 (a pedido de Joaquín — formato del monto al crear
   * un alumno): entero canónico en pesos (nunca texto formateado) — `null`
   * cuando el campo está vacío. Ver `CurrencyInput`/`currencyAmountInput.ts`.
   */
  price: number | null;

  weeklyFrequency: string;

  usualDurationMinutes: string;

  goals: string;

  notes: string;

  status: StudentStatus;

  usualDays: string[];

  usualTime: string;
}