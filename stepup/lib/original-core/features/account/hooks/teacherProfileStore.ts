// Puerto VERBATIM del original (`src/features/account/hooks/teacherProfileStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { loadTeacherProfile, saveTeacherProfile, type StoredTeacherProfile } from '../../../shared/storage/teacherFlowStorage.ts';
import { isValidTeacherName, normalizeTeacherName } from '../utils/teacherName.ts';

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — autenticación, teclado,
 * correo y nombre de la profesora): fuente canónica única del nombre de la
 * profesora — usada por Home (saludo), la pantalla de onboarding y
 * Configuración → Perfil de la profesora. Nunca se deriva del nombre del
 * dispositivo, del correo recortado, ni de ningún valor ficticio. Mismo
 * patrón de hidratación perezosa memoizada que `activeClassSessionStore.ts`.
 *
 * Corrección 2026-07-23 (protección integral de datos, Etapa 1): se agregan
 * `createdAt`/`updatedAt`/`schemaVersion` — entidad mínima igual, sólo se
 * suma trazabilidad. Un valor guardado antes de esta fase (sólo
 * `displayName`) se completa con valores razonables al leerlo
 * (`migrateStoredProfile`), nunca se rechaza.
 */
export const TEACHER_PROFILE_SCHEMA_VERSION = 1;

/**
 * Corrección 2026-07-23 (tutorial rápido salteable): versión vigente del
 * tutorial de bienvenida. Un valor guardado (`completedTutorialVersion`)
 * igual o mayor a esta constante significa "ya lo vio, no mostrarlo de
 * nuevo" — saltarlo cuenta como completado para esa versión, igual que
 * terminarlo. Si el contenido del tutorial cambia sustancialmente en el
 * futuro, subir este número vuelve a mostrarlo una vez más a todas las
 * cuentas, sin tocar el resto del perfil.
 */
export const CURRENT_TUTORIAL_VERSION = 1;

export interface TeacherProfile {
  displayName: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  /** Ausente = nunca completó (ni salteó) ninguna versión del tutorial. */
  completedTutorialVersion?: number;
  tutorialCompletedAt?: string;
}

function migrateStoredProfile(stored: StoredTeacherProfile): TeacherProfile {
  const now = new Date().toISOString();
  const createdAt = stored.createdAt ?? now;
  return {
    displayName: stored.displayName,
    createdAt,
    updatedAt: stored.updatedAt ?? createdAt,
    schemaVersion: stored.schemaVersion ?? TEACHER_PROFILE_SCHEMA_VERSION,
    completedTutorialVersion: stored.completedTutorialVersion,
    tutorialCompletedAt: stored.tutorialCompletedAt,
  };
}

/** true si ya completó (o salteó) la versión vigente del tutorial — nunca hay que volver a mostrarlo en ese caso. */
export function hasCompletedCurrentTutorial(): boolean {
  const completed = teacherProfile?.completedTutorialVersion;
  return completed !== undefined && completed >= CURRENT_TUTORIAL_VERSION;
}

/**
 * Corrección 2026-07-23 (tutorial rápido salteable, ítem D): saltear cuenta
 * como completado para la versión vigente — mismo campo, sin distinción.
 * Nunca bloquea Home si falla: el valor ya quedó aplicado en memoria antes
 * de intentar persistir, y `persistProfiles`-equivalente acá reintenta en
 * segundo plano sin lanzar. Requiere que ya exista un perfil (el tutorial
 * sólo se muestra después de tener nombre guardado).
 */
export async function setTutorialCompleted(version: number = CURRENT_TUTORIAL_VERSION): Promise<void> {
  if (!teacherProfile) return;
  const next: TeacherProfile = {
    ...teacherProfile,
    completedTutorialVersion: version,
    tutorialCompletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  teacherProfile = next;
  try {
    await saveTeacherProfile(next);
  } catch (error) {
    console.error('No se pudo guardar la preferencia del tutorial', error);
  }
}

let teacherProfile: TeacherProfile | null = null;
let hydrationPromise: Promise<void> | null = null;
let hydrated = false;

export function getTeacherProfile(): TeacherProfile | null {
  return teacherProfile;
}

/** true sólo si hay un nombre real utilizable — nunca vacío ni sólo símbolos. */
export function hasValidTeacherProfile(): boolean {
  return teacherProfile !== null && isValidTeacherName(teacherProfile.displayName);
}

export function hydrateTeacherProfile(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = loadTeacherProfile().then(async (saved) => {
      if (saved && !hydrated) {
        const migrated = migrateStoredProfile(saved);
        teacherProfile = migrated;
        // Persiste los campos completados (createdAt/updatedAt/schemaVersion)
        // sólo si de verdad faltaban — nunca reescribe un valor ya completo,
        // y nunca marca esto como un cambio pendiente de proteger (es una
        // migración de forma, no una mutación real de la profesora).
        if (!saved.createdAt || !saved.updatedAt || saved.schemaVersion === undefined) {
          await saveTeacherProfile(migrated);
        }
      }
      hydrated = true;
    });
  }
  return hydrationPromise;
}

/**
 * Guarda un nombre nuevo (desde el onboarding o desde Configuración).
 * Normaliza y valida antes de persistir — nunca escribe un valor inválido.
 * El llamador es responsable de mostrar el error si `isValidTeacherName`
 * ya había rechazado el valor antes de invocar esto.
 */
export async function setTeacherDisplayName(rawName: string): Promise<void> {
  const displayName = normalizeTeacherName(rawName);
  const now = new Date().toISOString();
  const next: TeacherProfile = {
    displayName,
    createdAt: teacherProfile?.createdAt ?? now,
    updatedAt: now,
    schemaVersion: TEACHER_PROFILE_SCHEMA_VERSION,
    completedTutorialVersion: teacherProfile?.completedTutorialVersion,
    tutorialCompletedAt: teacherProfile?.tutorialCompletedAt,
  };
  teacherProfile = next;
  await saveTeacherProfile(next);
}

/**
 * Usado exclusivamente por la restauración de respaldo. Nunca sobrescribe
 * con un valor vacío/inválido: si `profile` no trae un nombre real, esta
 * función NO toca nada (ni memoria ni disco) — deja el valor local
 * existente tal cual, para no borrar en silencio un nombre que la
 * profesora ya había cargado en este dispositivo.
 */
export async function replaceTeacherProfileFromBackup(
  profile: (Partial<TeacherProfile> & { displayName: string }) | null | undefined
): Promise<void> {
  if (!profile || !isValidTeacherName(profile.displayName)) return;
  const displayName = normalizeTeacherName(profile.displayName);
  const now = new Date().toISOString();
  const next: TeacherProfile = {
    displayName,
    createdAt: profile.createdAt ?? now,
    updatedAt: profile.updatedAt ?? now,
    schemaVersion: profile.schemaVersion ?? TEACHER_PROFILE_SCHEMA_VERSION,
    // Corrección 2026-07-23 (tutorial rápido salteable, ítem D): si el
    // respaldo ya traía la versión completada, se conserva — recuperar una
    // cuenta en un dispositivo nuevo nunca debe volver a mostrar el
    // tutorial que ya se completó en otro. Un respaldo anterior a esta fase
    // simplemente no trae el campo, lo cual sigue significando "todavía no
    // lo vio" (nunca un error).
    completedTutorialVersion: profile.completedTutorialVersion,
    tutorialCompletedAt: profile.tutorialCompletedAt,
  };
  teacherProfile = next;
  await saveTeacherProfile(next);
}
