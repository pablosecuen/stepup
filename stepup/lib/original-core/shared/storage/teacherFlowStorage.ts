// Puerto VERBATIM del original (`src/shared/storage/teacherFlowStorage.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../shims/async-storage.ts';
import { PAYMENTS_SCHEMA_VERSION, PAYMENTS_STORAGE_KEYS } from '../../features/payments/hooks/paymentsStore.ts';
import { markLocalDataChanged } from '../backup/localRevisionStore.ts';

export const STORAGE_KEYS = {
  profiles: '@teacherflow/profiles',
  lessons: '@teacherflow/lessons',
  students: '@teacherflow/students',
  // Corrección 2026-07-16 (a pedido de Joaquín): biblioteca reutilizable de
  // materiales de "Nueva clase" — deliberadamente FUERA del respaldo
  // automático a la nube por ahora (ver `MaterialLibraryItem` en
  // `features/new-class/types/index.ts`): sólo persiste local, en este
  // dispositivo, igual que cualquier otra clave de este archivo, pero no se
  // incluye en `buildBackup.ts`/`restoreExecutor.ts`.
  materialsLibrary: '@teacherflow/materials_library',
  // Corrección 2026-07-17 (a pedido de Joaquín): "clase en curso" — persiste
  // para sobrevivir si la app se cierra a mitad de la clase (el contador
  // debe seguir siendo correcto al volver a abrirla). Deliberadamente FUERA
  // del respaldo automático a la nube: es estado efímero de este
  // dispositivo, nunca un dato histórico real del alumno.
  activeClassSession: '@teacherflow/active_class_session',
  // Corrección 2026-07-18 (a pedido de Joaquín, segunda ronda): historial de
  // reportes generados por alumno. El REGISTRO estructurado (título, meses,
  // fechas, snapshot de datos) SÍ viaja en el respaldo v2 desde esta fase
  // (ver `backupKeys.ts`/`buildBackupV2.ts`) — el PDF binario en sí sigue
  // siendo local al dispositivo y nunca viaja; se regenera desde el
  // snapshot si falta tras restaurar.
  reportHistory: '@teacherflow/report_history',
  // Corrección 2026-07-18 (a pedido de Joaquín): un único booleano — "¿ya se
  // mostró el aviso de privacidad antes de compartir un reporte?". Nunca
  // guarda contenido sensible, sólo esta preferencia de UI, así que no hace
  // falta que viaje en el respaldo estructurado.
  reportSharePrivacyNoticeSeen: '@teacherflow/report_share_privacy_notice_seen',
  // Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda): si una
  // recuperación de respaldo termina con una "clase en curso" ya presente en
  // este dispositivo (nunca viaja en el respaldo — ver `activeClassSession`
  // arriba), nunca se sigue el conteo en silencio como si nada hubiera
  // pasado. Este único booleano marca que hay un aviso pendiente de mostrar
  // en Inicio hasta que la profesora lo confirme o descarte esa clase.
  pendingPostRestoreActiveSessionWarning: '@teacherflow/pending_post_restore_active_session_warning',
  // Corrección 2026-07-18 (a pedido de Joaquín, cuarta ronda — "Próxima
  // clase" siempre visible + seguimiento en vivo opcional): interruptor
  // único que decide si TODO el ciclo en vivo (cuenta regresiva, Comenzar
  // clase, cronómetro, puntualidad, correcciones manuales) está activo.
  // Deliberadamente FUERA del respaldo automático a la nube — es una
  // preferencia de este dispositivo, no un dato histórico del alumno.
  // Default `false` si la clave no existe
  // (instalación nueva o respaldo anterior a esta fase).
  liveClassTrackingEnabled: '@teacherflow/live_class_tracking_enabled',
  // Corrección 2026-07-19 (a pedido de Joaquín — Home/navegación/búsqueda):
  // 'barra' (bottom tabs, valor por defecto) o 'menu' (Home/Alumnos/
  // Calendario se mueven dentro del menú del logo, sin barra inferior).
  // Preferencia de este dispositivo — mismo criterio de persistencia local
  // que `liveClassTrackingEnabled`.
  navigationLocation: '@teacherflow/navigation_location',
  // Corrección 2026-07-22 (a pedido de Joaquín — autenticación, teclado,
  // correo y nombre de la profesora): perfil mínimo de la profesora
  // (`{ displayName: string }`). A diferencia de `liveClassTrackingEnabled`/
  // `navigationLocation`, SÍ viaja en el respaldo v2 (ver
  // `TEACHER_PROFILE_BACKUP_KEY` en `backupKeys.ts`) — es un dato real de la
  // profesora, no una preferencia efímera del dispositivo.
  teacherProfile: '@teacherflow/teacher_profile',
  // Corrección (a pedido de Joaquín — niveles personalizados): lista de
  // `CustomLevel` que la profesora creó (ver `features/students/types`).
  // Dato académico real de la cuenta, mismo criterio que `teacherProfile`/
  // `surchargeSettings` — SÍ viaja en el respaldo v2 (best-effort, ver
  // `backupKeys.ts`), nunca local-only como `materialsLibrary`.
  customLevels: '@teacherflow/custom_levels',
} as const;

const CALENDAR_STORAGE_KEYS = {
  lessons: '@teacherflow/calendar_lessons',
  recurrenceRules: '@teacherflow/calendar_recurrence_rules',
  recurrenceExceptions: '@teacherflow/calendar_recurrence_exceptions',
} as const;

async function readJSON<T>(key: string): Promise<T | null> {
  try {
    const value = await AsyncStorage.getItem(key);

    if (!value) return null;

    return JSON.parse(value) as T;
  } catch (error) {
    console.error(`Error leyendo ${key}`, error);
    return null;
  }
}

async function writeJSON<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error guardando ${key}`, error);
    throw error;
  }
}

export async function loadLessons<T>(): Promise<T | null> {
  return readJSON<T>(STORAGE_KEYS.lessons);
}

/**
 * Corrección 2026-07-23 (protección integral de datos, Etapa 1): además de
 * guardar, marca el cambio como pendiente de proteger (`markLocalDataChanged`)
 * para que `useCloudBackupSync` dispare un respaldo casi inmediato, sin
 * esperar el temporizador de 3 minutos. Deliberadamente NO se agrega este
 * marcador dentro de `writeJSON` (genérico): eso marcaría como "pendiente"
 * incluso preferencias puramente locales del dispositivo que nunca viajan
 * en el respaldo (navegación, seguimiento en vivo, avisos ya vistos) — sólo
 * las colecciones que sí participan del respaldo lo marcan, acá mismo.
 */
export async function saveLessons<T>(lessons: T): Promise<void> {
  await writeJSON(STORAGE_KEYS.lessons, lessons);
  await markLocalDataChanged();
}

export async function loadProfiles<T>(): Promise<T | null> {
  return readJSON<T>(STORAGE_KEYS.profiles);
}

export async function saveProfiles<T>(profiles: T): Promise<void> {
  await writeJSON(STORAGE_KEYS.profiles, profiles);
  await markLocalDataChanged();
}

export async function loadStudents<T>(): Promise<T | null> {
  return readJSON<T>(STORAGE_KEYS.students);
}

export async function saveStudents<T>(students: T): Promise<void> {
  await writeJSON(STORAGE_KEYS.students, students);
  await markLocalDataChanged();
}

export async function loadMaterialsLibrary<T>(): Promise<T | null> {
  return readJSON<T>(STORAGE_KEYS.materialsLibrary);
}

export async function saveMaterialsLibrary<T>(materials: T): Promise<void> {
  return writeJSON(STORAGE_KEYS.materialsLibrary, materials);
}

export async function loadActiveClassSession<T>(): Promise<T | null> {
  return readJSON<T>(STORAGE_KEYS.activeClassSession);
}

export async function saveActiveClassSession<T>(session: T): Promise<void> {
  return writeJSON(STORAGE_KEYS.activeClassSession, session);
}

export async function loadReportHistory<T>(): Promise<T | null> {
  return readJSON<T>(STORAGE_KEYS.reportHistory);
}

export async function saveReportHistory<T>(history: T): Promise<void> {
  await writeJSON(STORAGE_KEYS.reportHistory, history);
  await markLocalDataChanged();
}

export async function loadReportSharePrivacyNoticeSeen(): Promise<boolean> {
  return Boolean(await readJSON<boolean>(STORAGE_KEYS.reportSharePrivacyNoticeSeen));
}

export async function saveReportSharePrivacyNoticeSeen(seen: boolean): Promise<void> {
  return writeJSON(STORAGE_KEYS.reportSharePrivacyNoticeSeen, seen);
}

export async function loadPendingPostRestoreActiveSessionWarning(): Promise<boolean> {
  return Boolean(await readJSON<boolean>(STORAGE_KEYS.pendingPostRestoreActiveSessionWarning));
}

export async function savePendingPostRestoreActiveSessionWarning(pending: boolean): Promise<void> {
  return writeJSON(STORAGE_KEYS.pendingPostRestoreActiveSessionWarning, pending);
}

/** `null` (nunca `false` inventado) si la clave no existe todavía — el store decide el default real. */
export async function loadLiveClassTrackingEnabled(): Promise<boolean | null> {
  return readJSON<boolean>(STORAGE_KEYS.liveClassTrackingEnabled);
}

export async function saveLiveClassTrackingEnabled(enabled: boolean): Promise<void> {
  return writeJSON(STORAGE_KEYS.liveClassTrackingEnabled, enabled);
}

/** `null` si la clave no existe todavía (instalación nueva o backup anterior) — el store decide el default real ('barra'). */
export async function loadNavigationLocation(): Promise<string | null> {
  return readJSON<string>(STORAGE_KEYS.navigationLocation);
}

export async function saveNavigationLocation(location: string): Promise<void> {
  return writeJSON(STORAGE_KEYS.navigationLocation, location);
}

/**
 * Forma mínima persistida — nunca apellido, foto ni otros datos.
 * `createdAt`/`updatedAt`/`schemaVersion` opcionales a propósito (corrección
 * 2026-07-23, protección integral de datos, Etapa 1): un valor guardado por
 * una versión anterior de la app sólo tiene `displayName` — sigue siendo
 * válido tal cual, nunca se rechaza ni se pide de nuevo por faltarle estos
 * campos (`teacherProfileStore.ts` los completa al leerlo).
 *
 * Corrección 2026-07-23 (tutorial rápido salteable): `completedTutorialVersion`/
 * `tutorialCompletedAt` — opcionales por el mismo motivo, un valor guardado
 * antes de esta fase simplemente no los tiene, lo que significa "todavía no
 * vio ninguna versión del tutorial", nunca un error.
 */
export interface StoredTeacherProfile {
  displayName: string;
  createdAt?: string;
  updatedAt?: string;
  schemaVersion?: number;
  completedTutorialVersion?: number;
  tutorialCompletedAt?: string;
}

/** `null` si todavía no existe (instalación nueva, o cuenta que nunca completó el onboarding del nombre). */
export async function loadTeacherProfile(): Promise<StoredTeacherProfile | null> {
  return readJSON<StoredTeacherProfile>(STORAGE_KEYS.teacherProfile);
}

export async function saveTeacherProfile(profile: StoredTeacherProfile): Promise<void> {
  await writeJSON(STORAGE_KEYS.teacherProfile, profile);
  await markLocalDataChanged();
}

export async function loadCustomLevels<T>(): Promise<T | null> {
  return readJSON<T>(STORAGE_KEYS.customLevels);
}

export async function saveCustomLevels<T>(customLevels: T): Promise<void> {
  await writeJSON(STORAGE_KEYS.customLevels, customLevels);
  await markLocalDataChanged();
}

export interface PermanentStudentDeletionSnapshot {
  students: unknown;
  profiles: unknown;
  lessons: unknown;
  calendarLessons: unknown;
  recurrenceRules: unknown;
  recurrenceExceptions: unknown;
  /**
   * Fase Pagos 4B.1: las cuatro colecciones financieras se persisten en la
   * MISMA operación atómica (`AsyncStorage.multiSet`) que el resto de la
   * cascada de eliminación — nunca en una escritura separada. Así, si la
   * escritura falla, ninguna de las diez claves (las seis originales + las
   * cuatro financieras) queda a medio actualizar.
   */
  paymentCharges: unknown;
  payments: unknown;
  paymentAllocations: unknown;
  paymentAdjustments: unknown;
  /**
   * Corrección 2026-07-24 (a pedido de Joaquín — tutorial rápido salteable
   * + acciones por deslizamiento en Alumnos, ítem K): el historial de
   * reportes del alumno quedaba huérfano tras una eliminación definitiva
   * (nunca se borraba). Se incluye en la MISMA escritura atómica que el
   * resto de la cascada — nunca en una operación separada.
   */
  reportHistory: unknown;
}

export async function savePermanentStudentDeletionSnapshot(
  snapshot: PermanentStudentDeletionSnapshot
): Promise<void> {
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.students, JSON.stringify(snapshot.students)],
    [STORAGE_KEYS.profiles, JSON.stringify(snapshot.profiles)],
    [STORAGE_KEYS.lessons, JSON.stringify(snapshot.lessons)],
    [CALENDAR_STORAGE_KEYS.lessons, JSON.stringify(snapshot.calendarLessons)],
    [CALENDAR_STORAGE_KEYS.recurrenceRules, JSON.stringify(snapshot.recurrenceRules)],
    [
      CALENDAR_STORAGE_KEYS.recurrenceExceptions,
      JSON.stringify(snapshot.recurrenceExceptions),
    ],
    [PAYMENTS_STORAGE_KEYS.charges, JSON.stringify(snapshot.paymentCharges)],
    [PAYMENTS_STORAGE_KEYS.payments, JSON.stringify(snapshot.payments)],
    [PAYMENTS_STORAGE_KEYS.allocations, JSON.stringify(snapshot.paymentAllocations)],
    [PAYMENTS_STORAGE_KEYS.adjustments, JSON.stringify(snapshot.paymentAdjustments)],
    [PAYMENTS_STORAGE_KEYS.schemaVersion, JSON.stringify(PAYMENTS_SCHEMA_VERSION)],
    [STORAGE_KEYS.reportHistory, JSON.stringify(snapshot.reportHistory)],
  ]);
}

export async function clearTeacherFlowStorage(): Promise<void> {
  await AsyncStorage.multiRemove([
    STORAGE_KEYS.lessons,
    STORAGE_KEYS.profiles,
    STORAGE_KEYS.students,
  ]);
}
