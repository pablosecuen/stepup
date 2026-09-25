/**
 * Tipos de fila de Postgres — escritos a mano, espejando exactamente las
 * migraciones en supabase/migrations/. No hay Supabase CLI disponible en
 * este entorno para generarlos automáticamente (`supabase gen types`); una
 * vez que el proyecto tenga el CLI conectado, este archivo puede
 * reemplazarse por uno generado sin cambiar la forma (los nombres de
 * columna ya siguen 1:1 el esquema real).
 *
 * Cada tabla privada tiene `owner_id: string` (uuid de auth.users) — RLS ya
 * lo exige en el servidor; los repositorios (lib/repositories/) igual lo
 * completan explícitamente en cada insert, nunca confían únicamente en un
 * default de la base.
 */

export type UUID = string;
export type ISODateString = string; // YYYY-MM-DD
export type ISODateTimeString = string; // ISO 8601 completo

export type StudentModality = "presencial" | "online" | "mixta";
export type StudentStatus = "activo" | "pausado" | "inactivo" | "archivado";
export type StudentCategory =
  | "primaria"
  | "secundaria"
  | "profesorado_ingles"
  | "universitario"
  | "adulto_interes_personal"
  | "adulto_laboral"
  | "examen_internacional"
  | "apoyo_escolar"
  | "otro";
export type BillingType = "por_clase" | "mensual";

export interface StudentRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  usual_days: string[];
  usual_time: string | null;
  notes: string | null;
  birth_date: ISODateString | null;
  levels: string[];
  initial_level: string;
  modality: StudentModality;
  status: StudentStatus;
  category: StudentCategory;
  billing_type: BillingType;
  billing_plan: Record<string, unknown> | null;
  date_joined: ISODateString;
  last_reactivated_at: ISODateString | null;
  status_change_date: ISODateString | null;
  usual_duration_minutes: number;
  weekly_frequency: number;
  price: number;
  pending_homework: string | null;
  alerts: string[];
  current_goals: string[];
  strengths: string[];
  areas_to_improve: string[];
  is_featured: boolean;
  is_new: boolean;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface CustomLevelRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  name: string;
  created_at: ISODateTimeString;
}

export interface StudentStatusHistoryRow {
  id: UUID;
  owner_id: UUID;
  student_id: UUID;
  status: StudentStatus;
  occurred_on: ISODateString;
  reason: string | null;
  internal_note: string | null;
  created_at: ISODateTimeString;
}

export interface StudentLevelHistoryRow {
  id: UUID;
  owner_id: UUID;
  student_id: UUID;
  legacy_mobile_id: string | null;
  level: string;
  from_level: string | null;
  achieved_on: ISODateString;
  recorded_at: ISODateTimeString | null;
  previous_milestone_at: ISODateTimeString | null;
  duration_days: number | null;
  note: string | null;
  origin: "manual" | null;
  created_at: ISODateTimeString;
}

export interface StudentPriceHistoryRow {
  id: UUID;
  owner_id: UUID;
  student_id: UUID;
  price: number;
  effective_on: ISODateString;
  created_at: ISODateTimeString;
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

export type CalendarModality = StudentModality;
export type RecurrenceRuleStatus = "active" | "paused" | "ended";
export type ActivityKind = "class" | "training";

export interface RecurrenceRuleRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  primary_student_id: UUID | null;
  rule_type: "weekly" | "custom";
  cycle_length_weeks: 1 | 2 | 3 | 4;
  weeks: unknown; // RecurrenceWeek[] (jsonb) — misma forma que calendar/types RecurrenceWeek
  modality: CalendarModality;
  timezone: string;
  start_date: ISODateString;
  end_date: ISODateString | null;
  status: RecurrenceRuleStatus;
  supersedes_recurrence_id: UUID | null;
  superseded_by_recurrence_id: UUID | null;
  effective_from_date: ISODateString | null;
  class_title: string | null;
  activity_kind: ActivityKind;
  training_billing_agreement_id: UUID | null;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface RecurrenceRuleParticipantRow {
  id: UUID;
  owner_id: UUID;
  recurrence_rule_id: UUID;
  student_id: UUID;
  created_at: ISODateTimeString;
}

export type CalendarLessonType = "individual" | "group";
export type CalendarLessonStatus = "scheduled" | "completed" | "cancelled" | "rescheduled";

export interface CalendarLessonRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  primary_student_id: UUID;
  student_name: string;
  level: string;
  lesson_type: CalendarLessonType;
  start_at: ISODateTimeString;
  end_at: ISODateTimeString;
  modality: CalendarModality;
  status: CalendarLessonStatus;
  color: string;
  overlap_allowed: boolean;
  overlap_group_id: UUID | null;
  notes: string | null;
  is_recurring: boolean;
  recurrence_id: UUID | null;
  recurrence_occurrence_key: string | null;
  recurrence_index: number | null;
  recurrence_original_start: ISODateTimeString | null;
  schedule_adjustment: Record<string, unknown> | null;
  class_title: string | null;
  freed_by_lesson_id: UUID | null;
  activity_kind: ActivityKind;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface CalendarLessonParticipantRow {
  id: UUID;
  owner_id: UUID;
  calendar_lesson_id: UUID;
  student_id: UUID;
  student_name: string;
  level: string;
  created_at: ISODateTimeString;
}

export type RecurrenceExceptionType = "cancelled" | "rescheduled" | "excluded";

export interface RecurrenceExceptionRow {
  id: UUID;
  owner_id: UUID;
  recurrence_id: UUID;
  occurrence_key: string;
  exception_type: RecurrenceExceptionType;
  replacement_lesson_id: UUID | null;
  created_at: ISODateTimeString;
}

export interface TeacherAvailabilityRow {
  owner_id: UUID;
  timezone: string;
  weekly_blocks: unknown; // WeeklyAvailabilityBlock[]
  exceptions: unknown; // AvailabilityException[]
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

// ---------------------------------------------------------------------------
// Cobros
// ---------------------------------------------------------------------------

export type PaymentChargeType = "mensual" | "por_clase" | "semanal" | "quincenal" | "paquete" | "entrenamiento";
export type PaymentMethod = "efectivo" | "transferencia" | "otro";

export interface PaymentChargeRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  student_id: UUID;
  charge_type: PaymentChargeType;
  original_amount: number;
  currency: "ARS";
  due_date: ISODateString;
  billing_period: string | null;
  saved_lesson_id: UUID | null;
  package_id: UUID | null;
  training_billing_agreement_id: UUID | null;
  training_series_name: string | null;
  calendar_lesson_id: UUID | null;
  created_at: ISODateTimeString;
  voided_at: ISODateTimeString | null;
  void_reason: string | null;
}

export interface PaymentRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  student_id: UUID;
  amount: number;
  currency: "ARS";
  method: PaymentMethod;
  paid_at: ISODateString;
  recorded_at: ISODateTimeString;
  notes: string | null;
  voided_at: ISODateTimeString | null;
  void_reason: string | null;
  replaces_payment_id: UUID | null;
  source: "initial_student_setup" | null;
  /** Idempotencia real — ver `payments_owner_operation_unique`. Fase 5. */
  operation_id: UUID | null;
  created_at: ISODateTimeString;
}

export interface PaymentAllocationRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  payment_id: UUID;
  charge_id: UUID;
  student_id: UUID;
  amount: number;
  created_at: ISODateTimeString;
}

export interface PaymentAdjustmentRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  charge_id: UUID;
  student_id: UUID;
  reason: string;
  created_at: ISODateTimeString;
  voided_at: ISODateTimeString | null;
  void_reason: string | null;
}

export interface TrainingBillingAgreementRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  monthly_fee: number;
  pending_monthly_fee: number | null;
  pending_monthly_fee_effective_from: string | null;
  start_period: string;
  created_at: ISODateTimeString;
}

export type PendingTrainingBillingOperationKind = "create_series" | "convert_series" | "split_this_and_future";

export interface PendingTrainingBillingOperationRow {
  id: UUID;
  owner_id: UUID;
  operation_id: string;
  kind: PendingTrainingBillingOperationKind;
  agreement: Record<string, unknown>;
  new_rule: Record<string, unknown> | null;
  extra_rule_patch: Record<string, unknown> | null;
  split_plan: Record<string, unknown> | null;
  recurrence_ids_to_link: string[];
  expected_charge_ids: string[];
  start_period: string;
  end_period: string;
  schema_version: number;
  created_at: ISODateTimeString;
}

export interface MonthlyAmountCorrectionRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  student_id: UUID;
  billing_period: string;
  previous_amount: number;
  new_amount: number;
  changed_at: ISODateTimeString;
  reason: string;
  effective_from: "this_month" | "next_month" | null;
}

export interface InitialPaidSurchargeCorrectionRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  student_id: UUID;
  billing_period: string;
  previous_surcharge_amount: number;
  voided_payment_id: UUID | null;
  new_payment_id: UUID | null;
  corrected_at: ISODateTimeString;
  reason: string;
}

export interface FirstMonthProrationDecisionRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  student_id: UUID;
  billing_period: string;
  effective_join_date: ISODateString;
  criterion: "proportional" | "full" | "custom" | "no_charge";
  classes_remaining: number;
  classes_per_full_period: number;
  permanent_monthly_amount: number;
  charged_amount: number;
  charge_id: UUID | null;
  created_at: ISODateTimeString;
  confirmed_at: ISODateTimeString;
  source: "manual" | "automatic" | null;
  recurrence_ids: string[] | null;
  series_pattern_snapshot: unknown;
  rule_version: number | null;
}

export interface PackagePurchaseRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  student_id: UUID;
  included_classes: number;
  amount: number;
  valid_from: ISODateString;
  valid_until: ISODateString | null;
  created_at: ISODateTimeString;
  voided_at: ISODateTimeString | null;
  void_reason: string | null;
}

export interface PackageCreditMovementRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  package_id: UUID;
  student_id: UUID;
  movement_type: "consumo" | "ajuste_manual";
  amount: number;
  saved_lesson_id: UUID | null;
  reason: string | null;
  created_at: ISODateTimeString;
  voided_at: ISODateTimeString | null;
  void_reason: string | null;
}

// ---------------------------------------------------------------------------
// Registro pedagógico
// ---------------------------------------------------------------------------

export type LessonRegistrationStatus = "in_progress" | "completed";

/** Espeja `EventType` (móvil) — completo desde Fase 5 (ver `20260925100000_payments_engine.sql`: cierre de Cancelada/Reprogramada del registro ad-hoc). */
export type LessonRegistrationOutcome =
  | "clase_dictada"
  | "profesora_ausente"
  | "feriado"
  | "cancelada_con_aviso"
  | "cancelada_tarde"
  | "reprogramada";

export type LateCancellationPolicyRow = "cobrar_100" | "cobrar_porcentaje" | "descontar_del_paquete" | "no_cobrar";

export interface LessonRegistrationRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  calendar_lesson_id: UUID | null;
  activity_kind: ActivityKind;
  counts_as_class: boolean;
  status: LessonRegistrationStatus;
  homework_description: string | null;
  homework_due_date: ISODateString | null;
  billed_amount: number | null;
  scheduled_start_at: ISODateTimeString | null;
  scheduled_end_at: ISODateTimeString | null;
  actual_started_at: ISODateTimeString | null;
  actual_ended_at: ISODateTimeString | null;
  outcome: LessonRegistrationOutcome;
  holiday_exception: boolean;
  modality: string | null;
  /** Idempotencia real del camino ad-hoc — ver `lesson_registrations_owner_operation_unique`. `null` para el camino ligado a Calendario. */
  operation_id: UUID | null;
  /** Sólo tiene efecto cuando `outcome = 'cancelada_tarde'` — espeja `LateCancellationPolicy` (móvil). Fase 5. */
  late_cancellation_policy: LateCancellationPolicyRow | null;
  late_cancellation_percentage: number | null;
  /** El registro de la clase de RECUPERACIÓN apunta al original (`outcome = 'reprogramada'`) — nunca al revés. Fase 5. */
  rescheduled_from_registration_id: UUID | null;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface LessonRegistrationEditHistoryRow {
  id: UUID;
  owner_id: UUID;
  lesson_registration_id: UUID;
  /** Idempotencia real de una edición — ver `lesson_registration_edit_history_operation_unique`. */
  edit_operation_id: UUID;
  edited_at: ISODateTimeString;
  previous_snapshot: unknown;
}

export type ParticipantRegistrationStatusRow = "pending" | "completed" | "omitted";

export interface LessonRegistrationStudentRow {
  id: UUID;
  owner_id: UUID;
  lesson_registration_id: UUID;
  student_id: UUID;
  participant_status: ParticipantRegistrationStatusRow;
}

export type AttendanceStatus = "presente" | "ausente" | "tarde" | "ausente_aviso" | "sin_registrar";

export interface LessonRegistrationAttendanceRow {
  id: UUID;
  owner_id: UUID;
  lesson_registration_id: UUID;
  student_id: UUID;
  status: AttendanceStatus;
  late_minutes: number | null;
}

export interface LessonRegistrationEvaluationRow {
  id: UUID;
  owner_id: UUID;
  lesson_registration_id: UUID;
  student_id: UUID;
  general_grade: number | null;
  skill_grades: Record<string, number>;
  strengths: string[];
  areas_to_improve: string[];
  individual_observation: string | null;
  individual_homework_description: string | null;
  individual_homework_due_date: ISODateString | null;
  billed_amount: number | null;
}

export type HomeworkReviewOutcome = "realizada" | "parcial" | "no_realizada" | "ya_no_corresponde";

export interface LessonRegistrationHomeworkReviewRow {
  id: UUID;
  owner_id: UUID;
  lesson_registration_id: UUID;
  student_id: UUID;
  task_id: string;
  outcome: HomeworkReviewOutcome;
  reviewed_at: ISODateTimeString;
}

// ---------------------------------------------------------------------------
// Cuenta / configuración
// ---------------------------------------------------------------------------

export interface TeacherProfileRow {
  owner_id: UUID;
  display_name: string;
  completed_tutorial_version: number | null;
  tutorial_completed_at: ISODateTimeString | null;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface SurchargeSettingsRow {
  owner_id: UUID;
  enabled: boolean;
  grace_day: number;
  first_late_day: number;
  first_late_percentage: number;
  second_late_day: number;
  second_late_percentage: number;
  last_late_day: number;
  last_late_percentage: number;
  pending: Record<string, unknown> | null;
  pending_effective_from: string | null;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface BudgetDistributionSettingsRow {
  owner_id: UUID;
  needs_percent: number;
  wants_percent: number;
  savings_percent: number;
  savings_goal_enabled: boolean;
  savings_goal_target_amount: number | null;
  savings_goal_target_date: ISODateString | null;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface ReportRecordRow {
  id: UUID;
  owner_id: UUID;
  legacy_mobile_id: string | null;
  student_id: UUID;
  title: string;
  selected_months: string[];
  period_start: ISODateString;
  period_end: ISODateString;
  generated_at: ISODateTimeString;
  pdf_url: string | null;
  snapshot: Record<string, unknown>;
  schema_version: number;
  operation_id: UUID | null;
}

/**
 * Claim atómico real (nunca localStorage) del borrador de generación de
 * reporte activo, por (owner_id, student_id) — ver
 * `lib/repositories/report-drafts.ts`.
 */
export interface ReportDraftClaimRow {
  owner_id: UUID;
  student_id: UUID;
  operation_id: UUID;
  created_at: ISODateTimeString;
}

/**
 * `student_creation_claims` (Fase 2, corrección de carrera real —
 * `20260927100000_student_creation_race_fix.sql`) — el borrador
 * server-side de una alta manual de alumno. `status='created'` es
 * terminal e inmutable (`student_id` queda fijo). Los campos de
 * candidatos son autoridad del SERVIDOR, nunca del navegador.
 */
export interface StudentCreationClaimRow {
  id: UUID;
  owner_id: UUID;
  status: "pending" | "created";
  student_id: UUID | null;
  candidate_ids: UUID[] | null;
  candidates_snapshot: unknown;
  candidates_fingerprint: string | null;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
  completed_at: ISODateTimeString | null;
  expires_at: ISODateTimeString;
}

/**
 * `active_sessions` — YA EXISTE en este mismo proyecto Supabase, creada por
 * la app móvil (control de "un solo dispositivo autorizado" para su modelo
 * local-first). Fila real confirmada por introspección directa
 * (`information_schema.columns`, Fase 8) — nunca inventada. Una única fila
 * por `user_id` (no hay PK explícita documentada localmente, pero el
 * `ON CONFLICT (user_id)` real de `transfer_active_session` lo confirma). Sin
 * políticas RLS de insert/update/delete: toda escritura pasa por las 3 RPC
 * `security definer` de abajo, que resuelven `auth.uid()` en servidor.
 */
export interface ActiveSessionRow {
  user_id: UUID;
  device_id: string;
  generation: number;
  authorized_at: ISODateTimeString;
  expires_at: ISODateTimeString;
  last_seen_at: ISODateTimeString;
}

/**
 * Tablas/RPC que YA EXISTEN en este mismo proyecto Supabase, creadas por la
 * app móvil — nunca redefinidas acá. `delete_own_account()` confirmada por
 * introspección real (Fase 8): sin parámetros, `security definer`, resuelve
 * `auth.uid()` internamente — nunca recibe un id del cliente.
 */
export interface ExistingMobileManagedTables {
  active_sessions: "gestionada por la app móvil — transfer_active_session/touch_active_session/end_active_session (RPC)";
  cloud_backups: "gestionada por la app móvil — upload_cloud_backup (RPC)";
}
