// Puerto VERBATIM del original (`src/features/student-profile/hooks/useStudentProfile.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useCallback, useEffect, useState } from '../../../shims/react.ts';
import type {
  CEFRLevel,
  ReactivationInput,
  StatusChangeInput,
  StudentBillingPlan,
  StudentProfile,
} from '../types/index.ts';
import { loadProfiles, saveProfiles } from '../../../shared/storage/teacherFlowStorage.ts';
import { getStudentsStore, updateStudent } from '../../students/hooks/studentStore.ts';
import type { StudentListItem } from '../../students/types/index.ts';
import { planLevelAchievement, type PlanLevelAchievementResult } from '../utils/levelAchievementRules.ts';
import type { SavedLesson } from '../../new-class/types/index.ts';
import { projectPendingHomeworkSummary } from '../../new-class/utils/homeworkPendingDomain.ts';
import { calculateStudentAverageGradeFromLessons, recomputeStudentLessonDerivedFields } from '../../new-class/utils/editRegisteredLessonDomain.ts';
import { getSavedLessons, hydrateSavedLessons } from '../../new-class/hooks/savedLessonsStore.ts';
import { normalizeLevelsList, primaryStandardLevel, replacePrimaryStandardLevel } from '../../students/utils/studentLevelsCore.ts';
import { planMonthlyBillingPlanDueDayNormalization } from '../utils/studentBillingPlan.ts';

/**
 * Corrección (a pedido de Joaquín — niveles combinables): mismo criterio de
 * migración que `normalizeStudentRecord` en `studentStore.ts` — un perfil
 * guardado antes de esta corrección tiene `level: string` en vez de
 * `levels: string[]` en el JSON crudo. Se normaliza en el único punto real
 * de entrada masiva de perfiles al store en memoria (hidratación local Y
 * restauración de respaldo vía `replaceStudentProfilesStore`).
 */
function normalizeProfileRecord(raw: unknown): StudentProfile {
  const record = raw as StudentProfile & { level?: unknown };
  return { ...record, levels: normalizeLevelsList(record.levels, record.level) };
}

// MOCK — reemplazar por un useQuery de React Query contra Supabase en la
// Fase 1. Los ids coinciden a propósito con los de useStudentsList (Lista
// de alumnos) para que navegar desde una tarjeta muestre datos coherentes
// (ej. Ian Torres está "pausado" en ambos mocks).

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function isoInDays(days: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function isoYearsAgo(years: number, month: number, day: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years, month, day);
  return date.toISOString();
}

const MOCK_PROFILES: Record<string, StudentProfile> = {
  s1: {
    id: 's1',
    name: 'Martina Gómez',
    birthDate: isoYearsAgo(16, 3, 12),
    levels: ['B1'],
    initialLevel: 'A2',
    modality: 'presencial',
    status: 'activo',
    category: 'secundaria',
    billingType: 'mensual',
    dateJoined: isoDaysAgo(280),
    statusChangeDate: null,
    lastReactivatedAt: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 2,
    price: 28000,
    averageGrade: 8.6,
    classesThisMonth: 6,
    attendanceRate: 92,
    paymentStatus: 'verde',
    nextClassAt: isoInDays(0, 14, 0),
    lastClassAt: isoDaysAgo(3),
    pendingHomework: 'Ejercicios de presente perfecto, unidad 5',
    alerts: [],
    currentGoals: ['Aprobar el examen de mitad de año', 'Mejorar fluidez oral'],
    strengths: ['Comprensión de lectura', 'Vocabulario'],
    areasToImprove: ['Pronunciación', 'Tiempos verbales compuestos'],
    totalClasses: 58,
    totalHoursTaken: 58,
    totalInvested: 812000,
    statusHistory: [{ status: 'activo', date: isoDaysAgo(280) }],
    levelHistory: [
      { level: 'A2', date: isoDaysAgo(280) },
      { level: 'B1', date: isoDaysAgo(90) },
    ],
    priceHistory: [
      { price: 22000, date: isoDaysAgo(280) },
      { price: 28000, date: isoDaysAgo(60) },
    ],
    skillGradesHistory: [],
  },
  s2: {
    id: 's2',
    name: 'Lucas Pérez',
    birthDate: isoYearsAgo(23, 7, 4),
    levels: ['A2'],
    initialLevel: 'A1',
    modality: 'online',
    status: 'activo',
    category: 'universitario',
    billingType: 'mensual',
    dateJoined: isoDaysAgo(150),
    statusChangeDate: null,
    lastReactivatedAt: null,
    usualDurationMinutes: 45,
    weeklyFrequency: 2,
    price: 24000,
    averageGrade: 7.2,
    classesThisMonth: 5,
    attendanceRate: 85,
    paymentStatus: 'amarillo',
    nextClassAt: isoInDays(0, 16, 30),
    lastClassAt: isoDaysAgo(4),
    pendingHomework: 'Redacción corta: "Mi rutina diaria"',
    alerts: ['Pago con 1er vencimiento sin regularizar'],
    currentGoals: ['Preparar inglés para intercambio universitario'],
    strengths: ['Constancia'],
    areasToImprove: ['Gramática básica', 'Comprensión auditiva'],
    totalClasses: 31,
    totalHoursTaken: 23,
    totalInvested: 360000,
    statusHistory: [{ status: 'activo', date: isoDaysAgo(150) }],
    levelHistory: [{ level: 'A1', date: isoDaysAgo(150) }, { level: 'A2', date: isoDaysAgo(45) }],
    priceHistory: [{ price: 24000, date: isoDaysAgo(150) }],
    skillGradesHistory: [],
  },
  s3: {
    id: 's3',
    name: 'Ian Torres',
    birthDate: isoYearsAgo(24, 1, 20),
    levels: ['A2'],
    initialLevel: 'A1',
    modality: 'online',
    status: 'pausado',
    category: 'adulto_laboral',
    billingType: 'mensual',
    dateJoined: isoDaysAgo(150),
    statusChangeDate: isoDaysAgo(18),
    lastReactivatedAt: null,
    usualDurationMinutes: 45,
    weeklyFrequency: 2,
    price: 24000,
    averageGrade: 6.8,
    classesThisMonth: 0,
    attendanceRate: 74,
    paymentStatus: 'naranja',
    nextClassAt: null,
    lastClassAt: isoDaysAgo(19),
    pendingHomework: null,
    alerts: ['Pausado con pago pendiente de 2do vencimiento'],
    currentGoals: ['Inglés para entrevistas de trabajo'],
    strengths: ['Vocabulario técnico'],
    areasToImprove: ['Fluidez oral', 'Confianza al hablar'],
    totalClasses: 26,
    totalHoursTaken: 19,
    totalInvested: 312000,
    statusHistory: [
      { status: 'activo', date: isoDaysAgo(150) },
      {
        status: 'pausado',
        date: isoDaysAgo(18),
        reason: 'Viaje de trabajo',
        internalNote: 'Dijo que retoma en cuanto vuelva, sin fecha exacta',
      },
    ],
    levelHistory: [{ level: 'A1', date: isoDaysAgo(150) }, { level: 'A2', date: isoDaysAgo(60) }],
    priceHistory: [{ price: 24000, date: isoDaysAgo(150) }],
    skillGradesHistory: [],
  },
  s4: {
    id: 's4',
    name: 'Valentina Ruiz',
    birthDate: isoYearsAgo(29, 10, 2),
    levels: ['C1'],
    initialLevel: 'B2',
    modality: 'presencial',
    status: 'activo',
    category: 'examen_internacional',
    billingType: 'por_clase',
    dateJoined: isoDaysAgo(400),
    statusChangeDate: null,
    lastReactivatedAt: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 3,
    price: 9500,
    averageGrade: 9.1,
    classesThisMonth: 7,
    attendanceRate: 97,
    paymentStatus: 'verde',
    nextClassAt: isoInDays(0, 18, 0),
    lastClassAt: isoDaysAgo(2),
    pendingHomework: 'Simulacro de tarea de escritura 2, IELTS',
    alerts: [],
    currentGoals: ['Rendir el IELTS con banda 7.5+'],
    strengths: ['Escritura', 'Comprensión auditiva'],
    areasToImprove: ['Velocidad al hablar bajo presión'],
    totalClasses: 142,
    totalHoursTaken: 142,
    totalInvested: 1349000,
    statusHistory: [{ status: 'activo', date: isoDaysAgo(400) }],
    levelHistory: [
      { level: 'B2', date: isoDaysAgo(400) },
      { level: 'C1', date: isoDaysAgo(120) },
    ],
    priceHistory: [
      { price: 7500, date: isoDaysAgo(400) },
      { price: 9500, date: isoDaysAgo(90) },
    ],
    skillGradesHistory: [],
  },
  s5: {
    id: 's5',
    name: 'Bautista Fernández',
    birthDate: isoYearsAgo(19, 5, 15),
    levels: ['B2'],
    initialLevel: 'A2',
    modality: 'mixta',
    status: 'archivado',
    category: 'adulto_interes_personal',
    billingType: 'mensual',
    dateJoined: isoDaysAgo(500),
    statusChangeDate: isoDaysAgo(38),
    lastReactivatedAt: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 1,
    price: 26000,
    averageGrade: 6.1,
    classesThisMonth: 0,
    attendanceRate: 61,
    paymentStatus: 'rojo',
    nextClassAt: null,
    lastClassAt: isoDaysAgo(40),
    pendingHomework: null,
    alerts: ['Archivado con deuda sin saldar'],
    currentGoals: [],
    strengths: ['Buena memoria de vocabulario'],
    areasToImprove: ['Compromiso con la asistencia'],
    totalClasses: 64,
    totalHoursTaken: 64,
    totalInvested: 540000,
    statusHistory: [
      { status: 'activo', date: isoDaysAgo(500) },
      {
        status: 'archivado',
        date: isoDaysAgo(38),
        reason: 'Abandono sin aviso',
        internalNote: 'Tercer mes consecutivo de mora, se dio de baja definitiva',
      },
    ],
    levelHistory: [{ level: 'A2', date: isoDaysAgo(500) }, { level: 'B2', date: isoDaysAgo(200) }],
    priceHistory: [{ price: 20000, date: isoDaysAgo(500) }, { price: 26000, date: isoDaysAgo(150) }],
    skillGradesHistory: [],
  },
  s6: {
    id: 's6',
    name: 'Emilia Castro',
    birthDate: isoYearsAgo(31, 8, 9),
    levels: ['C2'],
    initialLevel: 'C1',
    modality: 'online',
    status: 'activo',
    category: 'adulto_laboral',
    billingType: 'mensual',
    dateJoined: isoDaysAgo(600),
    statusChangeDate: null,
    lastReactivatedAt: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 2,
    price: 27000,
    averageGrade: 9.4,
    classesThisMonth: 8,
    attendanceRate: 99,
    paymentStatus: 'verde',
    nextClassAt: isoInDays(2, 15, 0),
    lastClassAt: isoDaysAgo(5),
    pendingHomework: null,
    alerts: [],
    currentGoals: ['Mantener nivel para uso profesional diario'],
    strengths: ['Fluidez', 'Vocabulario de negocios'],
    areasToImprove: ['Modismos regionales'],
    totalClasses: 210,
    totalHoursTaken: 210,
    totalInvested: 2100000,
    statusHistory: [{ status: 'activo', date: isoDaysAgo(600) }],
    levelHistory: [{ level: 'C1', date: isoDaysAgo(600) }, { level: 'C2', date: isoDaysAgo(250) }],
    priceHistory: [{ price: 27000, date: isoDaysAgo(600) }],
    skillGradesHistory: [],
  },
  s7: {
    id: 's7',
    name: 'Tomás Alegre',
    birthDate: isoYearsAgo(12, 2, 28),
    levels: ['A1'],
    initialLevel: 'A1',
    modality: 'presencial',
    status: 'inactivo',
    category: 'primaria',
    billingType: 'mensual',
    dateJoined: isoDaysAgo(90),
    statusChangeDate: isoDaysAgo(10),
    lastReactivatedAt: null,
    usualDurationMinutes: 45,
    weeklyFrequency: 1,
    price: 18000,
    averageGrade: 7.9,
    classesThisMonth: 0,
    attendanceRate: 80,
    paymentStatus: 'verde',
    nextClassAt: null,
    lastClassAt: isoDaysAgo(11),
    pendingHomework: null,
    alerts: [],
    currentGoals: ['Apoyo escolar, sin objetivo formal todavía'],
    strengths: ['Buena predisposición'],
    areasToImprove: ['Vocabulario básico'],
    totalClasses: 12,
    totalHoursTaken: 9,
    totalInvested: 54000,
    statusHistory: [
      { status: 'activo', date: isoDaysAgo(90) },
      { status: 'inactivo', date: isoDaysAgo(10), reason: 'Cambio de colegio' },
    ],
    levelHistory: [{ level: 'A1', date: isoDaysAgo(90) }],
    priceHistory: [{ price: 18000, date: isoDaysAgo(90) }],
    skillGradesHistory: [],
  },
  s8: {
    id: 's8',
    name: 'Catalina Nuñez',
    birthDate: isoYearsAgo(20, 11, 17),
    levels: ['B1'],
    initialLevel: 'A2',
    modality: 'mixta',
    status: 'activo',
    category: 'profesorado_ingles',
    billingType: 'mensual',
    dateJoined: isoDaysAgo(220),
    statusChangeDate: null,
    lastReactivatedAt: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 2,
    price: 25000,
    averageGrade: 8.0,
    classesThisMonth: 5,
    attendanceRate: 90,
    paymentStatus: 'amarillo',
    nextClassAt: isoInDays(3, 17, 0),
    lastClassAt: isoDaysAgo(4),
    pendingHomework: 'Práctica de fonética, sonidos vocálicos',
    alerts: ['Pago con 1er vencimiento sin regularizar'],
    currentGoals: ['Rendir examen del profesorado'],
    strengths: ['Gramática', 'Análisis de textos'],
    areasToImprove: ['Pronunciación'],
    totalClasses: 78,
    totalHoursTaken: 78,
    totalInvested: 980000,
    statusHistory: [{ status: 'activo', date: isoDaysAgo(220) }],
    levelHistory: [{ level: 'A2', date: isoDaysAgo(220) }, { level: 'B1', date: isoDaysAgo(70) }],
    priceHistory: [{ price: 20000, date: isoDaysAgo(220) }, { price: 25000, date: isoDaysAgo(70) }],
    skillGradesHistory: [],
  },
};

// Store mutable a nivel de módulo — copia editable de MOCK_PROFILES.
// applyStatusChange/applyReactivation escriben acá, no en MOCK_PROFILES
// directamente, para conservar siempre el original de referencia.
// Esto es lo que permite que los cambios persistan mientras la app está
// abierta, aunque la pantalla de Perfil se desmonte (por ejemplo, al
// volver a la lista y entrar de nuevo al mismo alumno).
const profileStore: Record<string, StudentProfile> = {};

type ProfileListener = (studentId: string) => void;
const profileListeners = new Set<ProfileListener>();
function notifyProfileChanged(studentId: string): void {
  profileListeners.forEach((listener) => listener(studentId));
}
function subscribeProfiles(listener: ProfileListener): () => void {
  profileListeners.add(listener);
  return () => profileListeners.delete(listener);
}

let hydrationPromise: Promise<void> | null = null;

function persistProfiles(): void {
  void saveProfiles(profileStore).catch((error) => {
    console.error('No se pudieron guardar los perfiles', error);
  });
}

/**
 * Corrección (a pedido de Joaquín — niveles personalizados, renombrar):
 * mismo criterio que `renameStudentsLevel` en `studentStore.ts` (esa
 * función proyecta `StudentListItem`, ésta el `StudentProfile` real,
 * fuente de verdad de `levelHistory`/reportes) — actualiza a TODOS los
 * perfiles con ese nivel exacto en una sola escritura, nunca una por
 * alumno. Nunca reescribe `levelHistory` (registro histórico, punto en el
 * tiempo — un renombre no reescribe el pasado, sólo el nivel ACTUAL).
 */
export async function renameProfilesLevel(oldLevel: string, newLevel: string): Promise<number> {
  let changed = 0;
  Object.keys(profileStore).forEach((studentId) => {
    const current = profileStore[studentId];
    if (current.levels.includes(oldLevel)) {
      profileStore[studentId] = {
        ...current,
        levels: current.levels.map((level) => (level === oldLevel ? newLevel : level)),
      };
      changed += 1;
      notifyProfileChanged(studentId);
    }
  });
  if (changed > 0) {
    await saveProfiles(profileStore);
  }
  return changed;
}

function syncStudentListProjection(
  studentId: string,
  patch: Partial<StudentListItem>
): void {
  const current = getStudentsStore().find((student) => student.id === studentId);
  if (!current) return;
  updateStudent({ ...current, ...patch, id: current.id });
}

export function hydrateStudentProfiles(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = loadProfiles<Record<string, StudentProfile>>().then(
      (stored) => {
        if (stored && typeof stored === 'object') {
          Object.keys(profileStore).forEach((id) => delete profileStore[id]);
          Object.entries(stored).forEach(([id, profile]) => {
            profileStore[id] = normalizeProfileRecord(profile);
          });
        }
      }
    );
  }
  return hydrationPromise;
}

interface UseStudentProfileOptions {
  /** Solo para desarrollo/QA: fuerza el estado de error sin backend real. */
  simulateError?: boolean;
  simulatedDelayMs?: number;
}

export interface RecordLevelAchievementInput {
  toLevel: CEFRLevel;
  /** ISO o `YYYY-MM-DD` — fecha real en que el alumno alcanzó el nivel. */
  achievedAt: string;
  note?: string;
  /** Inyectable sólo para pruebas — por defecto `new Date()`. */
  now?: Date;
}

interface UseStudentProfileResult {
  data: StudentProfile | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  /** Cambio de estado 100% local — no persiste, no toca backend. */
  applyStatusChange: (input: StatusChangeInput) => void;
  applyReactivation: (input: ReactivationInput) => void;
  /**
   * Corrección 2026-08-03 (a pedido de Joaquín — BUG P1: rollback atómico
   * al cambiar de plan): a diferencia de `applyStatusChange`/`applyReactivation`
   * (que usan `persistProfiles()`, sin esperar ni revertir si falla),
   * ésta SÍ espera la escritura real y revierte perfil + plan en memoria si
   * falla — nunca debe quedar el plan nuevo aplicado en pantalla si no se
   * pudo guardar. Ver el mismo patrón ya establecido en `updateStudentProfile`.
   */
  applyBillingPlanChange: (billingPlan: StudentBillingPlan) => Promise<void>;
  /**
   * Corrección 2026-08-03 (a pedido de Joaquín — registrar logros de nivel
   * en Progreso): mismo patrón atómico que `applyBillingPlanChange` —
   * `planLevelAchievement` (puro) decide la entrada nueva y valida las
   * reglas (mismo nivel, fecha futura, fecha anterior al inicio, secuencia
   * incoherente — todas lanzan y no mutan nada); si pasa, se aplica de
   * forma optimista y se espera la escritura real, revirtiendo nivel +
   * historial en memoria si falla.
   */
  applyLevelAchievement: (input: RecordLevelAchievementInput) => Promise<PlanLevelAchievementResult>;
}

export function useStudentProfile(
  studentId: string,
  options: UseStudentProfileOptions = {}
): UseStudentProfileResult {
  const { simulateError = false, simulatedDelayMs = 500 } = options;
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const timeout = setTimeout(() => {
      if (cancelled) return;
      if (simulateError) {
        setError(new Error('No se pudo cargar el perfil del alumno'));
      } else {
        // Lee del store mutable, no de MOCK_PROFILES directamente — así,
        // si ya se aplicó un cambio de estado/reactivación antes en esta
        // sesión de la app, se conserva al volver a entrar al perfil
        // (ver punto 6: "debe persistir localmente mientras la app esté
        // abierta"). Un reload completo de la app sí reinicia el mock,
        // lo cual es correcto porque no hay backend todavía.
        setProfile(profileStore[studentId] ?? null);
      }
      setIsLoading(false);
    }, simulatedDelayMs);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [studentId, simulateError, simulatedDelayMs, attempt]);

  useEffect(
    () => subscribeProfiles((changedId) => {
      if (changedId === studentId) setProfile(profileStore[studentId] ?? null);
    }),
    [studentId]
  );

  const applyStatusChange = useCallback((input: StatusChangeInput) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const next: StudentProfile = {
        ...prev,
        status: input.status,
        statusChangeDate: input.date,
        statusHistory: [...prev.statusHistory, input],
      };
      profileStore[prev.id] = next;
      persistProfiles();
      syncStudentListProjection(prev.id, {
        status: input.status,
        nextClassAt: null,
      });
      return next;
    });
  }, []);

  const applyReactivation = useCallback((input: ReactivationInput) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const next: StudentProfile = {
        ...prev,
        status: 'activo',
        statusChangeDate: null,
        nextClassAt: null,
        // dateJoined NUNCA se reemplaza — es la fecha de alta original.
        // Reactivar guarda su propia fecha en lastReactivatedAt.
        lastReactivatedAt: input.newStartDate,
        // Corrección (a pedido de Joaquín — niveles combinables):
        // "Reactivar alumno" nunca se rediseñó para multiselección (sigue
        // ofreciendo un único nivel CEFR, ver ChangeStatusSheet.tsx) — sólo
        // reemplaza "el" nivel estándar del alumno, preservando intactos
        // los personalizados que ya tuviera (nunca los borra en silencio).
        levels: replacePrimaryStandardLevel(prev.levels, input.level),
        modality: input.modality,
        weeklyFrequency: input.weeklyFrequency,
        usualDurationMinutes: input.usualDurationMinutes,
        price: input.price,
        currentGoals: input.goals ? [input.goals] : prev.currentGoals,
        statusHistory: [
          ...prev.statusHistory,
          { status: 'activo' as const, date: input.newStartDate },
        ],
        priceHistory: [...prev.priceHistory, { price: input.price, date: input.newStartDate }],
        // totalInvested NO se toca — la inversión histórica se conserva
        // tal cual, reactivar no la modifica.
      };
      profileStore[prev.id] = next;
      persistProfiles();
      syncStudentListProjection(prev.id, {
        status: 'activo',
        levels: next.levels,
        modality: input.modality,
        nextClassAt: null,
      });
      return next;
    });
  }, []);

  // Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
  // de cobros): guarda el `StudentBillingPlan` elegido explícitamente desde
  // el perfil. Nunca migra sola a un alumno — sólo escribe cuando el
  // profesor edita el plan a propósito (ver `resolveStudentBillingPlan`,
  // que sigue siendo el único lugar que decide el plan efectivo mientras
  // `billingPlan` esté ausente).
  // Corrección 2026-08-03 (a pedido de Joaquín — BUG P1: doble importe al
  // cambiar de plan por clase a mensual, y su requisito de rollback
  // atómico): a diferencia del resto de los `apply*` de este hook, ésta
  // espera la escritura real (`await saveProfiles`, mismo patrón que
  // `updateStudentProfile`) y revierte perfil + plan en memoria si falla —
  // nunca debe quedar el plan nuevo mostrado en pantalla sin haberse podido
  // guardar. Usa `studentId` (no un `prev` de `setProfile`) porque necesita
  // el valor ANTERIOR real para poder revertirlo tras el `await`.
  const applyBillingPlanChange = useCallback(
    async (billingPlan: StudentBillingPlan) => {
      const previous = profileStore[studentId];
      if (!previous) return;
      const next: StudentProfile = { ...previous, billingPlan };
      profileStore[studentId] = next;
      setProfile(next);
      try {
        await saveProfiles(profileStore);
      } catch (error) {
        profileStore[studentId] = previous;
        setProfile(previous);
        throw error;
      }
    },
    [studentId]
  );

  // Corrección 2026-08-03 (a pedido de Joaquín — registrar logros de nivel
  // en Progreso): `planLevelAchievement` (puro) es la ÚNICA fuente de la
  // entrada nueva y de las validaciones — nunca se recalcula ni se
  // reimplementa acá. Si `planLevelAchievement` lanza (mismo nivel, fecha
  // futura, fecha anterior al inicio, secuencia incoherente), no se toca
  // `profileStore` ni `setProfile` — la excepción sube intacta para que la
  // UI (`LevelAchievementSheet`) muestre el mensaje sin aplicar nada.
  // Igual que `applyBillingPlanChange`: espera la escritura real y
  // revierte nivel + historial en memoria si `saveProfiles` falla.
  const applyLevelAchievement = useCallback(
    async (input: RecordLevelAchievementInput) => {
      const previous = profileStore[studentId];
      if (!previous) throw new Error('No se encontró el perfil del alumno.');

      // Corrección (a pedido de Joaquín — niveles combinables): "Registrar
      // cambio de nivel" sigue siendo un flujo exclusivamente CEFR (nunca
      // rediseñado para multiselección) — opera sobre "el" nivel estándar
      // del alumno dentro de la lista. Un alumno sin ningún nivel estándar
      // todavía (sólo personalizados) arranca desde `''`, para que el
      // primer logro registrado simplemente se agregue a la lista.
      const plan = planLevelAchievement({
        currentLevel: primaryStandardLevel(previous.levels) ?? '',
        history: previous.levelHistory,
        dateJoined: previous.dateJoined,
        toLevel: input.toLevel,
        achievedAt: input.achievedAt,
        note: input.note,
        now: input.now ?? new Date(),
      });

      const next: StudentProfile = {
        ...previous,
        levels: replacePrimaryStandardLevel(previous.levels, plan.nextLevel),
        levelHistory: plan.nextHistory,
      };
      profileStore[studentId] = next;
      setProfile(next);
      try {
        await saveProfiles(profileStore);
      } catch (error) {
        profileStore[studentId] = previous;
        setProfile(previous);
        throw error;
      }
      return plan;
    },
    [studentId]
  );

  return {
    data: profile,
    isLoading,
    error,
    refetch: () => setAttempt((prev) => prev + 1),
    applyStatusChange,
    applyReactivation,
    applyBillingPlanChange,
    applyLevelAchievement,
  };
}

// Getter de solo lectura — Nueva clase lo usa para calcular el importe a
// cobrar sin tener acceso directo al store privado.
export function getStudentPrice(studentId: string): number | null {
  return profileStore[studentId]?.price ?? null;
}

export function getStudentProfile(studentId: string): StudentProfile | null {
  const profile = profileStore[studentId];
  return profile ? { ...profile } : null;
}

export async function updateStudentProfile(profile: StudentProfile): Promise<void> {
  const previous = profileStore[profile.id];
  profileStore[profile.id] = { ...profile };
  notifyProfileChanged(profile.id);
  try {
    await saveProfiles(profileStore);
  } catch (error) {
    if (previous) profileStore[profile.id] = previous;
    else delete profileStore[profile.id];
    notifyProfileChanged(profile.id);
    throw error;
  }
}

function syncLessonOutcomeProjection(profile: StudentProfile): void {
  syncStudentListProjection(profile.id, {
    averageGrade: profile.averageGrade,
    classesThisMonth: profile.classesThisMonth,
    hasPendingHomework: Boolean(profile.pendingHomework),
  });
}

/**
 * Corrección 2026-08-07 (a pedido de Joaquín — PROBLEMA 3: asistencia por
 * integrante en clase grupal, regla "Hacer rollback si falla un
 * participante"): reemplaza a la antigua `applyLessonToProfile`
 * (síncrona, con `persistProfiles()` "dispara y olvida" — un fallo de
 * escritura quedaba silenciado en consola, nunca se revertía ni se
 * avisaba). Ésta aplica el resultado de la clase a CADA alumno por
 * separado con `updateStudentProfile` (que ya espera la escritura real y
 * revierte ese perfil puntual si falla) y, si CUALQUIER alumno falla a
 * mitad de una clase grupal, revierte TODOS los perfiles ya aplicados en
 * este mismo intento (no sólo el que falló) antes de relanzar el error —
 * nunca deja a un alumno actualizado y a otro no por el mismo evento.
 *
 * Corrección P0 2026-08-21 (a pedido de Joaquín — PROMEDIOS REALES): antes
 * recibía un `outcome` por alumno y lo aplicaba de forma INCREMENTAL con
 * `applyLessonOutcomeToProfileSnapshot` — la misma causa raíz de los
 * promedios corrompidos (denominador de "clases dictadas" mezclado con
 * "clases calificadas"), sólo que en el camino de ALTA en vez del de
 * edición. Ahora recibe la lista COMPLETA de `SavedLesson` (ya incluida la
 * recién guardada) y usa `recomputeStudentLessonDerivedFields` — la MISMA
 * función pura que ya usa `useEditRegisteredLesson.ts` — así que alta y
 * edición quedan sobre un único cálculo, nunca dos.
 */
export async function applyLessonOutcomesToProfiles(
  studentIds: string[],
  lessons: SavedLesson[]
): Promise<void> {
  const previousByStudent = new Map<string, StudentProfile>();
  const appliedStudentIds: string[] = [];
  try {
    for (const studentId of studentIds) {
      const current = profileStore[studentId];
      if (!current) continue;
      previousByStudent.set(studentId, current);
      const next = recomputeStudentLessonDerivedFields(current, studentId, lessons);
      await updateStudentProfile(next);
      syncLessonOutcomeProjection(next);
      appliedStudentIds.push(studentId);
    }
  } catch (error) {
    for (const studentId of appliedStudentIds) {
      const previous = previousByStudent.get(studentId);
      if (!previous) continue;
      await updateStudentProfile(previous).catch(() => undefined);
      syncLessonOutcomeProjection(previous);
    }
    throw error;
  }
}

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: ciclo real de
 * tareas pendientes): `applyLessonOutcomeToProfileSnapshot` (incremental,
 * una clase a la vez) ya no decide `pendingHomework` — no tiene
 * visibilidad de las revisiones de OTRAS clases. Después de aplicar una
 * clase nueva (flujo de creación, `useSaveClass.ts`), se proyecta el
 * estado canónico real con el historial COMPLETO (`SavedLesson[]`, ya
 * incluyendo la clase recién guardada) para cada alumno afectado. Sólo
 * escribe si el valor realmente cambió, para no generar una escritura de
 * perfil de más en cada clase que no toca tareas de nadie.
 */
export async function syncPendingHomeworkForStudents(
  studentIds: string[],
  lessons: SavedLesson[]
): Promise<void> {
  // Mismo patrón de rollback autocontenido que `applyLessonOutcomesToProfiles`
  // (el catch externo de `useSaveClass.ts` sólo revierte el store de
  // clases, nunca perfiles — cada función que escribe perfiles es
  // responsable de revertir SU PROPIO alcance si falla a mitad de camino).
  const previousByStudent = new Map<string, StudentProfile>();
  const updatedStudentIds: string[] = [];
  try {
    for (const studentId of studentIds) {
      const current = profileStore[studentId];
      if (!current) continue;
      const pendingHomework = projectPendingHomeworkSummary(studentId, lessons);
      if (current.pendingHomework === pendingHomework) continue;
      previousByStudent.set(studentId, current);
      const next = { ...current, pendingHomework };
      await updateStudentProfile(next);
      syncLessonOutcomeProjection(next);
      updatedStudentIds.push(studentId);
    }
  } catch (error) {
    for (const studentId of updatedStudentIds) {
      const previous = previousByStudent.get(studentId);
      if (!previous) continue;
      await updateStudentProfile(previous).catch(() => undefined);
      syncLessonOutcomeProjection(previous);
    }
    throw error;
  }
}

/**
 * Corrección P0 2026-08-21, segunda ronda (a pedido de Joaquín — "el
 * problema del promedio sigue sin resolverse en múltiples alumnos"): causa
 * raíz real de la recurrencia del bug — la corrección anterior arregló el
 * CÁLCULO (`recomputeStudentLessonDerivedFields`/`calculateAverageGrade`),
 * pero ese cálculo sólo corre cuando se crea o edita una clase. Un alumno
 * cuyo `averageGrade` ya había quedado mal calculado ANTES de esa
 * corrección (con la vieja media ponderada incorrecta) queda con ese valor
 * incorrecto persistido para siempre, porque nada lo recalculaba
 * retroactivamente — de ahí que Amparo/Emma/Guadalupe/etc. siguieran
 * mostrando 2.3/4.2/5.0 aunque el código nuevo ya fuera correcto.
 *
 * Reparación NO destructiva, en la hidratación de la app: recalcula
 * ÚNICAMENTE el campo derivado `averageGrade` de cada alumno, desde el
 * historial real de `SavedLesson` (misma función pura que ya usa
 * alta/edición) — nunca toca totalClasses/horas/asistencia/nivel/pagos ni
 * ningún otro campo, y sólo escribe si el valor recalculado difiere del
 * persistido (una corrida repetida sobre datos ya correctos no genera
 * ninguna escritura). Mismo criterio ya aprobado para `nextClassAt`
 * (`repairStaleNextClassAtOnAppStart`, `calendarNextClassAtSync.ts`).
 */
export async function repairStaleAverageGradeOnAppStart(): Promise<string[]> {
  await hydrateSavedLessons();
  const lessons = getSavedLessons();
  const repairedStudentIds: string[] = [];
  for (const [studentId, profile] of Object.entries(profileStore)) {
    const canonicalAverageGrade = calculateStudentAverageGradeFromLessons(studentId, lessons);
    if (canonicalAverageGrade === profile.averageGrade) continue;
    const next = { ...profile, averageGrade: canonicalAverageGrade };
    await updateStudentProfile(next);
    syncLessonOutcomeProjection(next);
    repairedStudentIds.push(studentId);
  }
  return repairedStudentIds;
}

/**
 * Corrección 2026-09-03 (a pedido de Joaquín — ERROR FINANCIERO: algunos
 * alumnos "Vencido", otros "Pendiente" el 03/09/2026 — ver
 * `planMonthlyBillingPlanDueDayNormalization` en `studentBillingPlan.ts`
 * para la causa raíz completa): normaliza, en el arranque/foreground de la
 * app (y tras restaurar un respaldo), todo `billingPlan.dueDay === 1` ya
 * persistido al vencimiento real de la profesora
 * (`DEFAULT_MONTHLY_DUE_DAY`). Idempotente: sólo escribe si el plan
 * realmente cambia; una corrida repetida sobre perfiles ya normalizados no
 * genera ninguna escritura. Nunca toca `amount`/`pendingAmount`/
 * `startPeriod`/ningún otro campo del perfil. DEBE correr ANTES que
 * `runAutomaticMonthlyDueDateRepair` (financialReconciliationService.ts) —
 * ese repara el `dueDate` de los CARGOS ya generados leyendo el `dueDay`
 * VIGENTE del plan; si corriera antes de esta normalización, seguiría
 * viendo el `dueDay: 1` viejo y no corregiría nada.
 */
export async function repairMonthlyBillingPlanDueDayOnAppStart(): Promise<string[]> {
  const repairedStudentIds: string[] = [];
  for (const [studentId, profile] of Object.entries(profileStore)) {
    const normalization = planMonthlyBillingPlanDueDayNormalization({ studentId, billingPlan: profile.billingPlan });
    if (!normalization) continue;
    await updateStudentProfile({ ...profile, billingPlan: normalization.normalizedPlan });
    repairedStudentIds.push(studentId);
  }
  return repairedStudentIds;
}

// BUGFIX (punto 2): Perfil mantiene su propia copia de `nextClassAt`
// (en profileStore), separada de la de `studentStore`. Sin esto, crear
// una clase desde Calendario actualizaba Lista de alumnos pero nunca
// el Perfil. Se llama junto con `updateStudent` cada vez que se agenda
// una clase futura.
export function syncNextClassAt(
  studentId: string,
  nextClassAt: string | null,
  nextClassEndAt: string | null = null
): void {
  const current = profileStore[studentId];
  if (!current) return;
  profileStore[studentId] = { ...current, nextClassAt, nextClassEndAt };
  persistProfiles();
}

export async function removeStudentProfile(studentId: string): Promise<void> {
  if (!profileStore[studentId]) return;
  delete profileStore[studentId];
  await saveProfiles(profileStore);
}

export function getStudentProfilesSnapshot(): Record<string, StudentProfile> {
  return Object.fromEntries(
    Object.entries(profileStore).map(([id, profile]) => [id, { ...profile }])
  );
}

export function replaceStudentProfilesStore(
  profiles: Record<string, StudentProfile>
): void {
  Object.keys(profileStore).forEach((id) => delete profileStore[id]);
  Object.entries(profiles).forEach(([id, profile]) => {
    profileStore[id] = normalizeProfileRecord(profile);
  });
}

// STUB solo para este chequeo de tipos — en el proyecto real del usuario
// esta función ya existe (se ve por el hecho de que el flujo no rompe
// antes de mostrar el Alert de éxito). No se modificó como parte de esta
// corrección de bugs.
export async function addStudentProfile(profile: StudentProfile): Promise<void> {
  profileStore[profile.id] = profile;
  await saveProfiles(profileStore);
}
