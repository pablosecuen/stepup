// Puerto VERBATIM del original (`src/features/students/hooks/studentStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentListItem } from '../types/index.ts';
import { loadStudents, saveStudents } from '../../../shared/storage/teacherFlowStorage.ts';
import { normalizeLevelsList } from '../utils/studentLevelsCore.ts';

/**
 * Corrección (a pedido de Joaquín — niveles combinables): un alumno
 * guardado antes de esta corrección tiene `level: string` (un único valor)
 * en vez de `levels: string[]` en el JSON crudo de AsyncStorage/un
 * respaldo. Se normaliza ACÁ, en el único punto real de entrada masiva de
 * datos de alumnos al store en memoria (hidratación local Y restauración
 * de respaldo vía `replaceStudentsStore` — nunca sólo uno de los dos),
 * para que ningún alumno viejo aparezca sin nivel ni rompa `.includes()`
 * en ningún lado. Nunca pierde un nivel real ya guardado.
 */
function normalizeStudentRecord(raw: unknown): StudentListItem {
  const record = raw as StudentListItem & { level?: unknown };
  return { ...record, levels: normalizeLevelsList(record.levels, record.level) };
}

type StudentsListener = () => void;

const listeners = new Set<StudentsListener>();

function isoInDays(
  days: number,
  hour: number,
  minute: number
): string {
  const date = new Date();

  date.setDate(
    date.getDate() + days
  );

  date.setHours(
    hour,
    minute,
    0,
    0
  );

  return date.toISOString();
}

function isoDaysAgo(
  days: number
): string {
  const date = new Date();

  date.setDate(
    date.getDate() - days
  );

  return date.toISOString();
}

const LEGACY_DEMO_STUDENTS: StudentListItem[] = [
  {
    id: 's1',
    name: 'Martina Gómez',
    levels: ['B1'],
    status: 'activo',
    modality: 'presencial',
    nextClassAt: isoInDays(0, 14, 0),
    paymentStatus: 'verde',
    averageGrade: 8.6,
    classesThisMonth: 6,
    lastPaymentAt: isoDaysAgo(4),
    isFeatured: true,
    isNew: false,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: true,
  },
  {
    id: 's2',
    name: 'Lucas Pérez',
    levels: ['A2'],
    status: 'activo',
    modality: 'online',
    nextClassAt: isoInDays(0, 16, 30),
    paymentStatus: 'amarillo',
    averageGrade: 7.2,
    classesThisMonth: 5,
    lastPaymentAt: isoDaysAgo(19),
    isFeatured: false,
    isNew: false,
    hasOverduePayment: false,
    hasPendingReport: true,
    hasPendingHomework: false,
  },
  {
    id: 's3',
    name: 'Ian Torres',
    levels: ['A2'],
    status: 'pausado',
    modality: 'online',
    nextClassAt: isoInDays(0, 16, 30),
    paymentStatus: 'naranja',
    averageGrade: 6.8,
    classesThisMonth: 5,
    lastPaymentAt: isoDaysAgo(27),
    isFeatured: false,
    isNew: true,
    hasOverduePayment: true,
    hasPendingReport: false,
    hasPendingHomework: false,
  },
  {
    id: 's4',
    name: 'Valentina Ruiz',
    levels: ['C1'],
    status: 'activo',
    modality: 'presencial',
    nextClassAt: isoInDays(0, 18, 0),
    paymentStatus: 'verde',
    averageGrade: 9.1,
    classesThisMonth: 7,
    lastPaymentAt: isoDaysAgo(2),
    isFeatured: true,
    isNew: false,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: false,
  },
  {
    id: 's5',
    name: 'Bautista Fernández',
    levels: ['B2'],
    status: 'archivado',
    modality: 'mixta',
    nextClassAt: isoInDays(1, 10, 0),
    paymentStatus: 'rojo',
    averageGrade: 6.1,
    classesThisMonth: 3,
    lastPaymentAt: isoDaysAgo(38),
    isFeatured: false,
    isNew: false,
    hasOverduePayment: true,
    hasPendingReport: true,
    hasPendingHomework: true,
  },
  {
    id: 's6',
    name: 'Emilia Castro',
    levels: ['C2'],
    status: 'activo',
    modality: 'online',
    nextClassAt: isoInDays(2, 15, 0),
    paymentStatus: 'verde',
    averageGrade: 9.4,
    classesThisMonth: 8,
    lastPaymentAt: isoDaysAgo(6),
    isFeatured: false,
    isNew: false,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: false,
  },
  {
    id: 's7',
    name: 'Tomás Alegre',
    levels: ['A1'],
    status: 'inactivo',
    modality: 'presencial',
    nextClassAt: null,
    paymentStatus: 'verde',
    averageGrade: 7.9,
    classesThisMonth: 4,
    lastPaymentAt: isoDaysAgo(1),
    isFeatured: false,
    isNew: true,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: false,
  },
  {
    id: 's8',
    name: 'Catalina Nuñez',
    levels: ['B1'],
    status: 'activo',
    modality: 'mixta',
    nextClassAt: isoInDays(3, 17, 0),
    paymentStatus: 'amarillo',
    averageGrade: 8,
    classesThisMonth: 5,
    lastPaymentAt: isoDaysAgo(20),
    isFeatured: false,
    isNew: false,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: true,
  },
];

// Las instalaciones nuevas comienzan vacías. Los ejemplos antiguos se
// conservan arriba sólo para poder reconocerlos y limpiarlos de instalaciones previas.
const studentsStore: StudentListItem[] = [];

export const LEGACY_DEMO_STUDENT_IDS = new Set(
  LEGACY_DEMO_STUDENTS.map((student) => student.id)
);

let hydrationPromise: Promise<void> | null = null;

function persistStudents(): void {
  void saveStudents(studentsStore).catch((error) => {
    console.error('No se pudieron guardar los alumnos', error);
  });
}

export function hydrateStudentsStore(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = loadStudents<StudentListItem[]>().then((stored) => {
      if (Array.isArray(stored)) {
        studentsStore.splice(0, studentsStore.length, ...stored.map(normalizeStudentRecord));
        notifyStudentsChanged();
      }
    });
  }
  return hydrationPromise;
}

function notifyStudentsChanged(): void {
  listeners.forEach(
    (listener) => listener()
  );
}

export function getStudentsStore(): StudentListItem[] {
  return studentsStore.map(
    (student) => ({
      ...student,
    })
  );
}

export function addStudent(
  student: StudentListItem
): void {
  const existingIndex =
    studentsStore.findIndex(
      (current) =>
        current.id === student.id
    );

  if (existingIndex >= 0) {
    studentsStore[
      existingIndex
    ] = {
      ...student,
    };
  } else {
    studentsStore.unshift({
      ...student,
    });
  }

  notifyStudentsChanged();
  persistStudents();
}

export function updateStudent(
  student: StudentListItem
): void {
  const index =
    studentsStore.findIndex(
      (current) =>
        current.id === student.id
    );

  if (index === -1) {
    addStudent(student);
    return;
  }

  studentsStore[index] = {
    ...student,
  };

  notifyStudentsChanged();
  persistStudents();
}

export async function updateStudentPersisted(student: StudentListItem): Promise<void> {
  const index = studentsStore.findIndex((current) => current.id === student.id);
  if (index === -1) throw new Error('No se encontró el alumno en la lista.');
  const previous = studentsStore[index];
  studentsStore[index] = { ...student };
  notifyStudentsChanged();
  try {
    await saveStudents(studentsStore);
  } catch (error) {
    studentsStore[index] = previous;
    notifyStudentsChanged();
    throw error;
  }
}

export function removeStudent(
  studentId: string
): void {
  const index =
    studentsStore.findIndex(
      (student) =>
        student.id === studentId
    );

  if (index === -1) {
    return;
  }

  studentsStore.splice(
    index,
    1
  );

  notifyStudentsChanged();
  persistStudents();
}

export function replaceStudentsStore(students: StudentListItem[]): void {
  studentsStore.splice(0, studentsStore.length, ...students.map(normalizeStudentRecord));
  notifyStudentsChanged();
}

/**
 * Corrección (a pedido de Joaquín — niveles personalizados, renombrar):
 * un nivel personalizado se persiste en `level` como texto libre (no un id
 * separado — ver `CustomLevel` en `types/index.ts`), así que renombrarlo
 * exige actualizar a TODOS los alumnos que hoy tienen ese texto exacto, en
 * UNA sola escritura (nunca una por alumno). Devuelve la cantidad real de
 * alumnos actualizados.
 */
export async function renameStudentsLevel(oldLevel: string, newLevel: string): Promise<number> {
  let changed = 0;
  for (let index = 0; index < studentsStore.length; index += 1) {
    const current = studentsStore[index];
    if (current.levels.includes(oldLevel)) {
      studentsStore[index] = {
        ...current,
        levels: current.levels.map((level) => (level === oldLevel ? newLevel : level)),
      };
      changed += 1;
    }
  }
  if (changed > 0) {
    notifyStudentsChanged();
    await saveStudents(studentsStore);
  }
  return changed;
}

/** Cantidad de alumnos (list item) que hoy tienen este nivel entre los suyos — usado para bloquear la eliminación de un nivel personalizado en uso. Por inclusión, no por igualdad exacta: un alumno combina varios niveles a la vez. */
export function countStudentsWithLevel(level: string): number {
  return studentsStore.filter((student) => student.levels.includes(level)).length;
}

export function subscribeStudents(
  listener: StudentsListener
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
