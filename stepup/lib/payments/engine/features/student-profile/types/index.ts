// Puerto VERBATIM del original (`src/features/student-profile/types/index.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
// Corrección (a pedido de Joaquín — niveles personalizados): antes una
// unión cerrada de 6 literales CEFR. Ahora acepta también el nombre de
// cualquier nivel personalizado que la profesora haya creado (ver
// `CustomLevel` en `features/students/types/index.ts`) — los 6 valores
// estándar siguen siendo strings válidos, ningún alumno existente deja de
// tipar.
export type CEFRLevel = string;

export type StudentModality = 'presencial' | 'online' | 'mixta';

export type PaymentStatus = 'verde' | 'amarillo' | 'naranja' | 'rojo';

// Mismo set que students/types.ts — el Perfil es donde se lee/escribe el
// ciclo de vida completo, por eso soporta los 4 estados aunque el brief
// de esta pantalla solo mencionó 3.
export type StudentStatus = 'activo' | 'pausado' | 'inactivo' | 'archivado';

export type StudentCategory =
  | 'primaria'
  | 'secundaria'
  | 'profesorado_ingles'
  | 'universitario'
  | 'adulto_interes_personal'
  | 'adulto_laboral'
  | 'examen_internacional'
  | 'apoyo_escolar'
  | 'otro';

export type BillingType = 'por_clase' | 'mensual';

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): plan de cobro canónico del alumno. `BillingType` (arriba)
 * queda intacto por compatibilidad — un alumno viejo sin `billingPlan`
 * nunca se migra solo: `resolveStudentBillingPlan()` (en
 * `utils/studentBillingPlan.ts`) deriva un plan equivalente al
 * comportamiento actual (mensual→`monthly` con `dueDay:1`, por_clase→
 * `per_class`) sin escribir nada. Recién cuando la profesora edita el plan
 * desde el perfil se persiste `billingPlan` explícito.
 */
export type StudentBillingPlanType = 'per_class' | 'weekly' | 'biweekly' | 'monthly' | 'class_package' | 'complimentary';

export interface PerClassBillingPlan {
  type: 'per_class';
  amount: number;
}

/** `dueWeekday`: 0=domingo … 6=sábado (mismo criterio que `Date.getDay()`). */
export interface WeeklyBillingPlan {
  type: 'weekly';
  amount: number;
  dueWeekday: number;
}

/** Los períodos de 14 días se cuentan desde `anchorDate` (YYYY-MM-DD), nunca desde el calendario ISO de semanas. */
export interface BiweeklyBillingPlan {
  type: 'biweekly';
  amount: number;
  anchorDate: string;
}

/**
 * `dueDay`: día del mes (1-28, para que exista en todos los meses).
 * `startPeriod` (opcional, 'YYYY-MM'): corrección 2026-07-26 (a pedido de
 * Joaquín — ciclo mensual de cobros) — primer período para el que este plan
 * genera una obligación. `undefined` significa "sin restricción" (el
 * comportamiento histórico: genera cualquier período que le corresponda).
 * Se usa para el alumno que "comienza a pagar el mes siguiente": nunca se
 * escribe para los otros dos casos de alta ("ya pagado"/"pendiente"), donde
 * el plan sigue derivándose implícitamente como antes.
 */
export interface MonthlyBillingPlan {
  type: 'monthly';
  amount: number;
  dueDay: number;
  startPeriod?: string;
  /**
   * Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente
   * el flujo financiero mensual): vigencia del monto cuando la profesora
   * elige "Aplicar desde el próximo mes" al modificarlo. `amount` sigue
   * siendo el importe EFECTIVO para el período actual y todos los
   * anteriores; `pendingAmount`/`pendingAmountEffectiveFrom` describen un
   * cambio ya decidido pero que todavía no entró en vigencia. Nunca leer
   * `amount` directo para decidir cuánto corresponde a un período — usar
   * siempre `resolveEffectiveMonthlyAmount(plan, billingPeriod)`, la única
   * función que sabe resolver esta vigencia. Ambos opcionales y aditivos:
   * un plan sin cambio pendiente simplemente no los tiene.
   */
  pendingAmount?: number;
  pendingAmountEffectiveFrom?: string; // YYYY-MM
}

export interface ClassPackageBillingPlan {
  type: 'class_package';
  amount: number;
  includedClasses: number;
  validFrom: string; // YYYY-MM-DD
  validUntil?: string; // YYYY-MM-DD
}

/** Sin cobro — nunca genera obligaciones ni preguntas financieras, nunca afecta el scoring. */
export interface ComplimentaryBillingPlan {
  type: 'complimentary';
}

export type StudentBillingPlan =
  | PerClassBillingPlan
  | WeeklyBillingPlan
  | BiweeklyBillingPlan
  | MonthlyBillingPlan
  | ClassPackageBillingPlan
  | ComplimentaryBillingPlan;

export interface StatusHistoryEntry {
  status: StudentStatus;
  date: string; // ISO
  reason?: string;
  internalNote?: string;
}

/**
 * Corrección 2026-08-03 (a pedido de Joaquín — registrar logros de nivel en
 * Progreso): esta entrada ya existía (poblada sólo en datos semilla, nunca
 * por ninguna acción real del usuario) — se EXTIENDE en vez de crear un
 * segundo modelo paralelo. `level`/`date` son los campos históricos
 * (nivel alcanzado / fecha en que se alcanzó); los campos nuevos son
 * TODOS opcionales a propósito, para que una entrada vieja (semilla, o de
 * un respaldo anterior a esta corrección) siga siendo válida sin ellos.
 * Sólo las entradas creadas por el nuevo flujo "Registrar cambio de nivel"
 * los completan.
 */
export interface LevelHistoryEntry {
  level: CEFRLevel; // nivel alcanzado ("toLevel")
  date: string; // ISO — fecha en que se alcanzó ese nivel ("achievedAt")
  /** Identificador único de la entrada — permite referenciarla para editar/anular sin ambigüedad. */
  id?: string;
  /** Nivel anterior al logro. `null`/ausente en el primer logro registrado o en entradas históricas sin ese dato. */
  fromLevel?: CEFRLevel | null;
  /** ISO — cuándo se cargó el registro en la app (puede ser posterior a `date`, si se carga tarde). */
  recordedAt?: string;
  /** ISO del logro anterior usado como base para calcular `durationDays` (o la fecha de inicio del alumno si es el primero). `null` si no había una fecha base válida. */
  previousMilestoneAt?: string | null;
  /** Días calendario entre `previousMilestoneAt` y `date`. `null` si no se pudo calcular. */
  durationDays?: number | null;
  /** Nota opcional de la profesora sobre este logro. */
  note?: string;
  /** Origen del registro — hoy siempre `'manual'` (cargado a mano por la profesora); reservado para un futuro origen automático. */
  origin?: 'manual';
}

export interface PriceHistoryEntry {
  price: number;
  date: string; // ISO
}

export interface StudentProfile {
  id: string;
  name: string;

phone?: string;
whatsapp?: string;
email?: string;

usualDays?: string[];
usualTime?: string;

notes?: string;
  /**
   * Corrección 2026-07-24 (a pedido de Joaquín — edad/WhatsApp/correo dejan
   * de ser obligatorios): opcional a propósito — un alumno puede no tener
   * edad cargada. `undefined` nunca es un error, sólo significa "no se
   * cargó". ISO — para calcular edad cuando está presente.
   */
  birthDate?: string;
  /**
   * Corrección (a pedido de Joaquín — niveles combinables): antes
   * `level: CEFRLevel` único. Ver el mismo comentario en
   * `StudentListItem.levels` (`features/students/types/index.ts`) — misma
   * semántica, mismo criterio de migración (`normalizeLevelsList`).
   * `initialLevel` (abajo) es un concepto DISTINTO — el nivel CEFR que tenía
   * al ingresar, usado sólo como base de "Registrar cambio de nivel" — y
   * sigue siendo un único valor a propósito, ese flujo nunca se rediseñó
   * para multiselección.
   */
  levels: CEFRLevel[]; // niveles actuales (estándar y/o personalizados combinados)
  initialLevel: CEFRLevel;
  modality: StudentModality;
  status: StudentStatus;
  category: StudentCategory;
  billingType: BillingType;
  /** Opcional a propósito — ver el comentario de `StudentBillingPlan` arriba. `undefined` nunca es un error. */
  billingPlan?: StudentBillingPlan;
  dateJoined: string; // ISO — fecha de alta ORIGINAL, nunca se reemplaza
  lastReactivatedAt: string | null; // ISO — última vez que se reactivó, si corresponde
  statusChangeDate: string | null; // fecha de pausa/baja/archivo, si corresponde
  usualDurationMinutes: number;
  weeklyFrequency: number;
  /**
   * Corrección 2026-08-03 (a pedido de Joaquín — BUG P1: doble importe al
   * cambiar de plan por clase a mensual): precio HISTÓRICO de referencia —
   * el que tenía el alumno como clase suelta antes de tener un `billingPlan`
   * explícito, o el que se usa para derivarlo cuando todavía no existe (ver
   * `resolveStudentBillingPlan`). Una vez que `billingPlan` existe, este
   * campo NUNCA vuelve a actualizarse solo (cambiar el plan desde "Editar
   * plan de cobro" o "Modificar monto mensual" nunca lo toca) — por eso
   * NUNCA debe usarse para mostrar el importe vigente de ningún plan. La
   * única fuente para "cuánto paga este alumno ahora" es
   * `resolveEffectiveBillingAmount(resolveStudentBillingPlan(profile), billingPeriod)`.
   */
  price: number;

  // Resumen rápido
  averageGrade: number | null; // 1–10; null = sin ninguna calificación explícita todavía
  classesThisMonth: number;
  attendanceRate: number; // 0–100
  paymentStatus: PaymentStatus;
  nextClassAt: string | null;
  /** Corrección P0 (ver students/types/index.ts) — final efectivo de la misma ocurrencia que `nextClassAt`. Opcional: mismo motivo (fixtures de prueba existentes). */
  nextClassEndAt?: string | null;
  lastClassAt: string | null;

  // Contenido de la sección Resumen
  pendingHomework: string | null;
  alerts: string[];
  currentGoals: string[];
  strengths: string[];
  areasToImprove: string[];

  // Historial visible
  totalClasses: number;
  totalHoursTaken: number;
  totalInvested: number; // en la moneda base (ARS)
  statusHistory: StatusHistoryEntry[];
  levelHistory: LevelHistoryEntry[];
  priceHistory: PriceHistoryEntry[];
  skillGradesHistory: Array<{ date: string; grades: Record<string, number> }>;
}

export type ProfileTabKey =
  | 'resumen'
  | 'clases'
  | 'progreso'
  | 'tareas'
  | 'cobros'
  | 'reportes'
  | 'informacion';

export type ProfileQuickAction =
  | 'registrar_clase'
  | 'registrar_pago'
  | 'reprogramar_clase'
  | 'generar_pdf'
  | 'editar_alumno';

// Input del formulario de cambio de estado — mismo contrato que ya
// habíamos modelado en students/types.ts, ahora con implementación real
// (aunque todavía local/mock, sin backend).
export interface StatusChangeInput {
  status: StudentStatus;
  date: string;
  reason?: string;
  internalNote?: string;
}

export interface ReactivationInput {
  newStartDate: string;
  level: CEFRLevel;
  modality: StudentModality;
  weeklyFrequency: number;
  usualDurationMinutes: number;
  price: number;
  schedule: string;
  goals: string;
}
