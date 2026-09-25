"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import {
  createStudent,
  updateStudent,
  changeStudentStatus,
  StudentNotFoundError,
  type NewStudentInput,
  type UpdateStudentInput,
  type StudentDuplicateCandidate,
} from "@/lib/repositories/students";
import {
  createCustomLevel,
  renameCustomLevel,
  deleteCustomLevel,
  DuplicateLevelNameError,
  InvalidLevelNameError,
  LevelInUseError,
  LevelNotFoundError,
} from "@/lib/repositories/custom-levels";
import type { BillingType, StudentCategory, StudentModality, StudentStatus } from "@/lib/db/database.types";

// Server Actions — Alumnos. Nunca reciben `ownerId`/`owner_id` del
// navegador: `requireAuthenticatedDbContext()` siempre resuelve la sesión
// real en el servidor. Toda mutación pasa por `lib/repositories/*`, nunca
// una consulta a Supabase dispersa acá.

export interface FormState {
  error?: string;
  /**
   * Presente sólo cuando `create_student_via_web` encontró posibles
   * coincidencias y todavía no se confirmó "es otra persona" — CERO
   * escritura mientras este campo esté presente. `changed=true` significa
   * que este resultado llegó DESPUÉS de intentar confirmar — el conjunto
   * de candidatos cambió desde la última revisión y el servidor exige una
   * revisión nueva antes de permitir insertar.
   */
  duplicate?: { candidates: StudentDuplicateCandidate[]; changed: boolean };
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readOptionalString(formData: FormData, key: string): string | null {
  const value = readString(formData, key).trim();
  return value === "" ? null : value;
}

function readNumber(formData: FormData, key: string): number {
  const raw = readString(formData, key).trim();
  return raw === "" ? Number.NaN : Number(raw);
}

function readLevels(formData: FormData): string[] {
  return formData
    .getAll("levels")
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function friendlyErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Ocurrió un error inesperado. Intentá de nuevo.";
}

// ---------------------------------------------------------------------------
// Crear alumno
// ---------------------------------------------------------------------------

export async function createStudentAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const input: NewStudentInput = {
    name: readString(formData, "name"),
    modality: readString(formData, "modality") as StudentModality,
    category: readString(formData, "category") as StudentCategory,
    billingType: readString(formData, "billingType") as BillingType,
    dateJoined: readString(formData, "dateJoined"),
    price: readNumber(formData, "price"),
    levels: readLevels(formData),
    initialLevel: readOptionalString(formData, "initialLevel") ?? undefined,
    usualDurationMinutes: readString(formData, "usualDurationMinutes").trim()
      ? readNumber(formData, "usualDurationMinutes")
      : undefined,
    weeklyFrequency: readString(formData, "weeklyFrequency").trim() ? readNumber(formData, "weeklyFrequency") : undefined,
    phone: readOptionalString(formData, "phone"),
    whatsapp: readOptionalString(formData, "whatsapp"),
    email: readOptionalString(formData, "email"),
    notes: readOptionalString(formData, "notes"),
  };

  const claimId = readString(formData, "claimId").trim();
  if (!claimId) {
    return { error: "Ocurrió un error inesperado. Recargá la página e intentá de nuevo." };
  }
  const confirmDuplicate = readString(formData, "confirmDuplicate").trim() === "true";

  let result;
  try {
    const ctx = await requireAuthenticatedDbContext();
    result = await createStudent(ctx, input, { claimId, confirmDuplicate });
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }

  if (result.status === "possible_duplicate") {
    // Si se pedía confirmar y igual volvió "possible_duplicate", el
    // servidor detectó que el conjunto de candidatos cambió desde la
    // última revisión y rechazó la creación — nunca porque el cliente
    // haya mandado algo inválido (esta RPC ya no recibe ningún id de
    // candidato del navegador).
    return { duplicate: { candidates: result.candidates, changed: confirmDuplicate } };
  }

  revalidatePath("/alumnos");
  redirect(`/alumnos/${result.student.id}`);
}

// ---------------------------------------------------------------------------
// Editar alumno
// ---------------------------------------------------------------------------

export async function updateStudentAction(
  studentId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const patch: UpdateStudentInput = {
    name: readString(formData, "name"),
    modality: readString(formData, "modality") as StudentModality,
    category: readString(formData, "category") as StudentCategory,
    billingType: readString(formData, "billingType") as BillingType,
    price: readNumber(formData, "price"),
    levels: readLevels(formData),
    initialLevel: readOptionalString(formData, "initialLevel") ?? undefined,
    usualDurationMinutes: readString(formData, "usualDurationMinutes").trim()
      ? readNumber(formData, "usualDurationMinutes")
      : undefined,
    weeklyFrequency: readString(formData, "weeklyFrequency").trim() ? readNumber(formData, "weeklyFrequency") : undefined,
    phone: readOptionalString(formData, "phone"),
    whatsapp: readOptionalString(formData, "whatsapp"),
    email: readOptionalString(formData, "email"),
    notes: readOptionalString(formData, "notes"),
  };

  try {
    const ctx = await requireAuthenticatedDbContext();
    await updateStudent(ctx, studentId, patch);
  } catch (error) {
    if (error instanceof StudentNotFoundError) return { error: "No encontramos ese alumno." };
    return { error: friendlyErrorMessage(error) };
  }

  revalidatePath("/alumnos");
  revalidatePath(`/alumnos/${studentId}`);
  redirect(`/alumnos/${studentId}`);
}

// ---------------------------------------------------------------------------
// Cambiar estado (pausar / dar de baja / archivar / reactivar-restaurar)
// ---------------------------------------------------------------------------

export interface ChangeStatusFormState extends FormState {
  success?: boolean;
}

export async function changeStudentStatusAction(
  studentId: string,
  _prevState: ChangeStatusFormState,
  formData: FormData
): Promise<ChangeStatusFormState> {
  const status = readString(formData, "status") as StudentStatus;
  const occurredOn = readString(formData, "occurredOn").trim() || new Date().toISOString().slice(0, 10);
  const reason = readOptionalString(formData, "reason") ?? undefined;
  const internalNote = readOptionalString(formData, "internalNote") ?? undefined;

  try {
    const ctx = await requireAuthenticatedDbContext();
    await changeStudentStatus(ctx, studentId, { status, occurredOn, reason, internalNote });
  } catch (error) {
    if (error instanceof StudentNotFoundError) return { error: "No encontramos ese alumno." };
    return { error: friendlyErrorMessage(error) };
  }

  revalidatePath("/alumnos");
  revalidatePath(`/alumnos/${studentId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Niveles personalizados
// ---------------------------------------------------------------------------

export async function createLevelAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const name = readString(formData, "name");
  try {
    const ctx = await requireAuthenticatedDbContext();
    await createCustomLevel(ctx, name);
  } catch (error) {
    if (error instanceof InvalidLevelNameError || error instanceof DuplicateLevelNameError) {
      return { error: error.message };
    }
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/alumnos");
  revalidatePath("/alumnos/nuevo");
  return {};
}

export async function renameLevelAction(
  levelId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const name = readString(formData, "name");
  try {
    const ctx = await requireAuthenticatedDbContext();
    await renameCustomLevel(ctx, levelId, name);
  } catch (error) {
    if (
      error instanceof InvalidLevelNameError ||
      error instanceof DuplicateLevelNameError ||
      error instanceof LevelNotFoundError
    ) {
      return { error: error.message };
    }
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/alumnos");
  return {};
}

export async function deleteLevelAction(levelId: string, levelName: string): Promise<FormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await deleteCustomLevel(ctx, levelId, levelName);
  } catch (error) {
    if (error instanceof LevelInUseError) return { error: error.message };
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/alumnos");
  return {};
}
