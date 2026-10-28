"use server";

import { parseMoneyInput } from "@/lib/format/money-input";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import {
  createStudent,
  getStudent,
  updateStudent,
  changeStudentStatus,
  reactivateStudentWithBilling,
  archiveStudentAndPruneFuture,
  StudentNotFoundError,
  type NewStudentInput,
  type UpdateStudentInput,
  type StudentDuplicateCandidate,
} from "@/lib/repositories/students";
import {
  createCustomLevel,
  renameCustomLevel,
  deleteCustomLevel,
} from "@/lib/repositories/custom-levels";
import type { BillingType, StudentCategory, StudentModality, StudentStatus } from "@/lib/db/database.types";
import { todayInArgentina } from "@/lib/format/date-format";
import { MISSING_OPERATION_ID_MESSAGE, parseOperationId } from "@/lib/calendar/operation-id";
import { actionErrorMessage } from "@/lib/errors/action-error";
import { billingPeriodOfDateKey, resolveMonthlyDueDate } from "@/lib/payments/dates";
import { buildFirstMonthInput } from "@/lib/students/first-month";
import { isValidAge, joinFullName, resolveBirthDateOnEdit, estimatedBirthDateForAge, splitGoals } from "@/lib/students/student-form-fields";

// Server Actions — Alumnos. Nunca reciben `ownerId`/`owner_id` del
// navegador: `requireAuthenticatedDbContext()` siempre resuelve la sesión
// real en el servidor. Toda mutación pasa por `lib/repositories/*`, nunca
// una consulta a Supabase dispersa acá.

export interface FormState {
  error?: string;
  /**
   * Presente sólo cuando `create_student_with_operation` encontró posibles
   * coincidencias y todavía no se confirmó "es otra persona" — CERO
   * escritura mientras este campo esté presente. `changed=true` significa
   * que este resultado llegó DESPUÉS de intentar confirmar — el conjunto
   * de candidatos cambió desde la última revisión y el servidor exige una
   * revisión nueva antes de permitir insertar.
   */
  duplicate?: { candidates: StudentDuplicateCandidate[]; changed: boolean };
  /**
   * Alta confirmada por el servidor con ESTA clave de operación (creada ahora o ya existente: respuesta perdida/reintento).
   * El cliente rota la clave y navega a la ficha: la acción NO usa `redirect()` porque navegar antes de rotar dejaría la
   * clave vieja en sessionStorage y el próximo "Nuevo alumno" reencontraría al alumno anterior en vez de crear otro.
   */
  createdOperationId?: string;
  createdStudentId?: string;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readOptionalString(formData: FormData, key: string): string | null {
  const value = readString(formData, key).trim();
  return value === "" ? null : value;
}

/** Importe escrito (tarifa): UNA interpretación estricta (`parseMoneyInput`); si el texto es vacío, inválido o ambiguo devuelve NaN y la validación del alumno lo rechaza — nunca guarda un valor distinto del escrito. */
function readMoney(formData: FormData, key: string): number {
  const parsed = parseMoneyInput(readString(formData, key));
  return "amount" in parsed ? parsed.amount : Number.NaN;
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

/** Nombre y apellido por separado, como el original: los dos son obligatorios. Devuelve el nombre guardado («nombre apellido») o el error a mostrar. */
function readFullName(formData: FormData): { name: string; error?: string } {
  const first = readString(formData, "firstName").trim();
  const last = readString(formData, "lastName").trim();
  if (!first) return { name: "", error: "Ingresá el nombre del alumno." };
  if (!last) return { name: "", error: "Ingresá el apellido del alumno." };
  return { name: joinFullName(first, last) };
}

function friendlyErrorMessage(error: unknown): string {
  return actionErrorMessage("students", error);
}

// ---------------------------------------------------------------------------
// Crear alumno
// ---------------------------------------------------------------------------

export async function createStudentAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const fullName = readFullName(formData);
  if (fullName.error) return { error: fullName.error };
  const ageText = readString(formData, "age");
  if (!isValidAge(ageText)) return { error: "La edad debe ser un número entre 3 y 120." };
  const todayDateKey = todayInArgentina();
  const billingType = readString(formData, "billingType");
  const firstMonth = buildFirstMonthInput({
    billingType,
    situationText: readString(formData, "firstMonthSituation"),
    paidAtText: readString(formData, "paidAt"),
    confirmPending: readString(formData, "confirmPending") === "true",
    todayDateKey,
  });
  if (firstMonth.error) return { error: firstMonth.error };

  const input: NewStudentInput = {
    name: fullName.name,
    modality: readString(formData, "modality") as StudentModality,
    category: readString(formData, "category") as StudentCategory,
    billingType: readString(formData, "billingType") as BillingType,
    dateJoined: readString(formData, "dateJoined"),
    price: readMoney(formData, "price"),
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
    birthDate: ageText.trim() ? estimatedBirthDateForAge(Number(ageText), Number(todayDateKey.slice(0, 4))) : null,
    currentGoals: splitGoals(readString(formData, "goals")),
    firstMonth: firstMonth.firstMonth,
  };

  // La clave de operación la genera el NAVEGADOR (una vez por borrador) y la acción nunca la inventa ni la repone.
  const operationId = parseOperationId(readString(formData, "operationId"));
  if (!operationId) {
    return { error: MISSING_OPERATION_ID_MESSAGE };
  }
  const confirmDuplicate = readString(formData, "confirmDuplicate").trim() === "true";

  let result;
  try {
    const ctx = await requireAuthenticatedDbContext();
    result = await createStudent(ctx, input, { operationId, confirmDuplicate });
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
  return { createdOperationId: operationId, createdStudentId: result.student.id };
}

// ---------------------------------------------------------------------------
// Editar alumno
// ---------------------------------------------------------------------------

export async function updateStudentAction(
  studentId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  // Regla del original (2026-08-10): el tipo de facturación y el precio NO se editan desde «Editar alumno» (con esa vía el importe cambiaba sin corregir el cargo
  // del mes ni dejar historial). Se cambian sólo desde la pestaña Cobros («Editar plan de cobro» / «Modificar monto mensual»), que lo hacen de forma atómica y auditada.
  // Aunque un navegador alterado mande esos campos, esta acción nunca los lee.
  const fullName = readFullName(formData);
  if (fullName.error) return { error: fullName.error };
  const ageText = readString(formData, "age");
  if (!isValidAge(ageText)) return { error: "La edad debe ser un número entre 3 y 120." };

  const patch: UpdateStudentInput = {
    name: fullName.name,
    modality: readString(formData, "modality") as StudentModality,
    category: readString(formData, "category") as StudentCategory,
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
    currentGoals: splitGoals(readString(formData, "goals")),
  };

  try {
    const ctx = await requireAuthenticatedDbContext();
    // Misma regla del original: si la edad escrita coincide con la que ya surge de la fecha guardada, esa fecha se conserva.
    const current = await getStudent(ctx, studentId);
    if (!current) return { error: "No encontramos ese alumno." };
    patch.birthDate = resolveBirthDateOnEdit({ ageText, currentBirthDate: current.birthDate, todayDateKey: todayInArgentina() });
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
  /** Aviso sin invalidar el cambio de estado: p. ej. el alumno quedó activo pero no se pudo guardar desde cuándo se retoma el cobro mensual. */
  warning?: string;
}

export async function changeStudentStatusAction(
  studentId: string,
  _prevState: ChangeStatusFormState,
  formData: FormData
): Promise<ChangeStatusFormState> {
  const status = readString(formData, "status") as StudentStatus;
  const occurredOn = readString(formData, "occurredOn").trim() || todayInArgentina();
  const reason = readOptionalString(formData, "reason") ?? undefined;
  const internalNote = readOptionalString(formData, "internalNote") ?? undefined;
  const warning: string | undefined=undefined;

  try {
    const ctx = await requireAuthenticatedDbContext();

    if (status === "archivado" || status === "inactivo") {
      // Archivar: elección obligatoria, nunca preseleccionada — el servidor nunca confía en que la UI la haya exigido: sin un
      // valor explícito "true"/"false" acá, se rechaza en vez de asumir un default.
      // Dar de baja (inactivo): NO hay elección — el alumno sale siempre de las series y clases por venir, desde la fecha de baja,
      // en la misma transacción que el cambio de estado (si no, un alumno inactivo seguiría apareciendo en el Calendario).
      let removeFromFuture: boolean;
      if (status === "inactivo") {
        removeFromFuture = true;
      } else {
        const removeFromFutureRaw = readString(formData, "removeFromFuture").trim();
        if (removeFromFutureRaw !== "true" && removeFromFutureRaw !== "false") {
          return { error: "Elegí si conservás o quitás al alumno de la agenda futura." };
        }
        removeFromFuture = removeFromFutureRaw === "true";
      }
      // La baja o el archivado con poda nunca tocan el pasado: la fecha efectiva es hoy o una fecha futura.
      if (removeFromFuture && occurredOn < todayInArgentina()) {
        return { error: "La fecha no puede ser anterior a hoy: las clases pasadas no se modifican." };
      }
      const operationId = readString(formData, "operationId").trim();
      if (!operationId) {
        return { error: "Ocurrió un error inesperado. Recargá la página e intentá de nuevo." };
      }
      await archiveStudentAndPruneFuture(ctx, studentId, {
        status,
        occurredOn,
        reason,
        internalNote,
        removeFromFuture,
        now: new Date(),
        operationId,
      });
    } else {
      if(status==='activo'){
        const currentPeriod=billingPeriodOfDateKey(todayInArgentina());
        await reactivateStudentWithBilling(ctx,studentId,{occurredOn,reason,internalNote,choice:readString(formData,'resumeChoice').trim(),period:currentPeriod,dueDate:resolveMonthlyDueDate(currentPeriod,10)});
      }else await changeStudentStatus(ctx, studentId, { status, occurredOn, reason, internalNote });
    }
  } catch (error) {
    if (error instanceof StudentNotFoundError) return { error: "No encontramos ese alumno." };
    return { error: friendlyErrorMessage(error) };
  }

  revalidatePath("/alumnos");
  revalidatePath("/cobros");
  revalidatePath(`/alumnos/${studentId}`);
  return { success: true, warning };
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
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/alumnos");
  revalidatePath("/alumnos/nuevo");
  return {};
}

/**
 * Crea un nivel personalizado desde el formulario del alumno (el «+» junto a A1–C2) y devuelve el nivel creado para seleccionarlo al instante. Siempre en la cuenta de la sesión: nunca recibe una cuenta del
 * navegador, valida nombre vacío / igual a un nivel estándar / duplicado (sin distinguir mayúsculas) y no toca ningún nivel existente.
 */
export async function createLevelInlineAction(rawName: string): Promise<{ error?: string; data?: { id: string; name: string } }> {
  try {
    if (typeof rawName !== "string" || rawName.length > 200) return { error: "Ponele un nombre al nivel." };
    const ctx = await requireAuthenticatedDbContext();
    const level = await createCustomLevel(ctx, rawName);
    revalidatePath("/alumnos");
    revalidatePath("/alumnos/nuevo");
    return { data: { id: level.id, name: level.name } };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
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
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/alumnos");
  return {};
}
