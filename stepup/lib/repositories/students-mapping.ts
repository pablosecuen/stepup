import type {
  BillingType,
  StudentCategory,
  StudentModality,
  StudentRow,
  StudentStatus,
} from "../db/database.types";

/**
 * Lógica PURA del repositorio de Alumnos — separada de `students.ts` (que
 * hace las llamadas reales a Supabase) a propósito: este archivo usa sólo
 * imports relativos (ningún `@/lib/supabase/*`, ningún `server-only`), así
 * que puede probarse directo con `node --test`, sin bundler y sin tocar la
 * red — mismo patrón que el resto de `lib/auth/*.ts` en este proyecto (ver
 * `lib/auth/safe-redirect.ts`/`config.ts`).
 */

export interface StudentRecord {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  usualDays: string[];
  usualTime: string | null;
  notes: string | null;
  birthDate: string | null;
  levels: string[];
  initialLevel: string;
  modality: StudentModality;
  status: StudentStatus;
  category: StudentCategory;
  billingType: BillingType;
  billingPlan: Record<string, unknown> | null;
  dateJoined: string;
  lastReactivatedAt: string | null;
  statusChangeDate: string | null;
  usualDurationMinutes: number;
  weeklyFrequency: number;
  price: number;
  pendingHomework: string | null;
  alerts: string[];
  currentGoals: string[];
  strengths: string[];
  areasToImprove: string[];
  isFeatured: boolean;
  isNew: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Pura — mapea una fila real de Postgres a la forma que usa la interfaz. */
export function toStudentRecord(row: StudentRow): StudentRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    usualDays: row.usual_days,
    usualTime: row.usual_time,
    notes: row.notes,
    birthDate: row.birth_date,
    levels: row.levels,
    initialLevel: row.initial_level,
    modality: row.modality,
    status: row.status,
    category: row.category,
    billingType: row.billing_type,
    billingPlan: row.billing_plan,
    dateJoined: row.date_joined,
    lastReactivatedAt: row.last_reactivated_at,
    statusChangeDate: row.status_change_date,
    usualDurationMinutes: row.usual_duration_minutes,
    weeklyFrequency: row.weekly_frequency,
    price: row.price,
    pendingHomework: row.pending_homework,
    alerts: row.alerts,
    currentGoals: row.current_goals,
    strengths: row.strengths,
    areasToImprove: row.areas_to_improve,
    isFeatured: row.is_featured,
    isNew: row.is_new,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewStudentInput {
  name: string;
  modality: StudentModality;
  category: StudentCategory;
  billingType: BillingType;
  dateJoined: string;
  price: number;
  levels?: string[];
  initialLevel?: string;
  usualDurationMinutes?: number;
  weeklyFrequency?: number;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface StudentValidationError {
  field: string;
  message: string;
}

/**
 * Mismas validaciones mínimas que exige el esquema real (constraints CHECK
 * de la migración), verificadas ANTES del round-trip de red para dar un
 * error claro e inmediato. Nunca reemplaza las constraints reales de la
 * base (que siguen siendo la última palabra) — es una validación temprana,
 * no la única.
 */
export function validateNewStudentInput(input: NewStudentInput): StudentValidationError[] {
  const errors: StudentValidationError[] = [];
  if (!input.name.trim()) errors.push({ field: "name", message: "El nombre es obligatorio." });
  if (!Number.isFinite(input.price) || input.price < 0) {
    errors.push({ field: "price", message: "El precio debe ser un número mayor o igual a cero." });
  }
  if (input.usualDurationMinutes !== undefined && input.usualDurationMinutes <= 0) {
    errors.push({ field: "usualDurationMinutes", message: "La duración habitual debe ser mayor a cero." });
  }
  if (input.weeklyFrequency !== undefined && input.weeklyFrequency < 0) {
    errors.push({ field: "weeklyFrequency", message: "La frecuencia semanal no puede ser negativa." });
  }
  if (!input.dateJoined.trim()) errors.push({ field: "dateJoined", message: "La fecha de alta es obligatoria." });
  return errors;
}

export function studentInputToRowPatch(input: NewStudentInput, ownerId: string) {
  return {
    owner_id: ownerId,
    name: input.name.trim(),
    modality: input.modality,
    category: input.category,
    billing_type: input.billingType,
    date_joined: input.dateJoined,
    price: input.price,
    levels: input.levels ?? [],
    initial_level: input.initialLevel ?? "",
    usual_duration_minutes: input.usualDurationMinutes ?? 60,
    weekly_frequency: input.weeklyFrequency ?? 1,
    phone: input.phone ?? null,
    whatsapp: input.whatsapp ?? null,
    email: input.email ?? null,
    notes: input.notes ?? null,
  };
}

export interface UpdateStudentInput extends Partial<NewStudentInput> {
  pendingHomework?: string | null;
  alerts?: string[];
  currentGoals?: string[];
  strengths?: string[];
  areasToImprove?: string[];
  isFeatured?: boolean;
}

/** Pura — arma el patch parcial (snake_case) que recibe `.update(...)`, sólo con los campos realmente provistos. */
export function updateInputToRowPatch(patch: UpdateStudentInput): Record<string, unknown> {
  const rowPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) rowPatch.name = patch.name.trim();
  if (patch.modality !== undefined) rowPatch.modality = patch.modality;
  if (patch.category !== undefined) rowPatch.category = patch.category;
  if (patch.billingType !== undefined) rowPatch.billing_type = patch.billingType;
  if (patch.price !== undefined) rowPatch.price = patch.price;
  if (patch.levels !== undefined) rowPatch.levels = patch.levels;
  if (patch.initialLevel !== undefined) rowPatch.initial_level = patch.initialLevel;
  if (patch.usualDurationMinutes !== undefined) rowPatch.usual_duration_minutes = patch.usualDurationMinutes;
  if (patch.weeklyFrequency !== undefined) rowPatch.weekly_frequency = patch.weeklyFrequency;
  if (patch.phone !== undefined) rowPatch.phone = patch.phone;
  if (patch.whatsapp !== undefined) rowPatch.whatsapp = patch.whatsapp;
  if (patch.email !== undefined) rowPatch.email = patch.email;
  if (patch.notes !== undefined) rowPatch.notes = patch.notes;
  if (patch.pendingHomework !== undefined) rowPatch.pending_homework = patch.pendingHomework;
  if (patch.alerts !== undefined) rowPatch.alerts = patch.alerts;
  if (patch.currentGoals !== undefined) rowPatch.current_goals = patch.currentGoals;
  if (patch.strengths !== undefined) rowPatch.strengths = patch.strengths;
  if (patch.areasToImprove !== undefined) rowPatch.areas_to_improve = patch.areasToImprove;
  if (patch.isFeatured !== undefined) rowPatch.is_featured = patch.isFeatured;
  return rowPatch;
}

/**
 * Validación de edición — mismas reglas que `validateNewStudentInput`,
 * pero sólo sobre los campos REALMENTE provistos en el patch (un campo
 * ausente nunca es un error: la edición es siempre parcial). Corre en el
 * servidor (Server Action), nunca sólo en el navegador.
 */
export function validateUpdateStudentInput(input: UpdateStudentInput): StudentValidationError[] {
  const errors: StudentValidationError[] = [];
  if (input.name !== undefined && !input.name.trim()) {
    errors.push({ field: "name", message: "El nombre es obligatorio." });
  }
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) {
    errors.push({ field: "price", message: "El precio debe ser un número mayor o igual a cero." });
  }
  if (input.usualDurationMinutes !== undefined && input.usualDurationMinutes <= 0) {
    errors.push({ field: "usualDurationMinutes", message: "La duración habitual debe ser mayor a cero." });
  }
  if (input.weeklyFrequency !== undefined && input.weeklyFrequency < 0) {
    errors.push({ field: "weeklyFrequency", message: "La frecuencia semanal no puede ser negativa." });
  }
  if (input.dateJoined !== undefined && !input.dateJoined.trim()) {
    errors.push({ field: "dateJoined", message: "La fecha de alta es obligatoria." });
  }
  return errors;
}
