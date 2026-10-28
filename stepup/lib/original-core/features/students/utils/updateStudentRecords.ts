// Puerto VERBATIM del original (`src/features/students/utils/updateStudentRecords.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentProfile } from '../../student-profile/types/index.ts';
import { getStudentProfile, updateStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import type { StudentListItem } from '../types/index.ts';
import { getStudentsStore, updateStudentPersisted } from '../hooks/studentStore.ts';

export async function updateStudentRecords(
  listItem: StudentListItem,
  profile: StudentProfile
): Promise<void> {
  if (listItem.id !== profile.id) throw new Error('Los registros pertenecen a alumnos distintos.');
  const previousProfile = getStudentProfile(profile.id);
  const previousListItem = getStudentsStore().find((item) => item.id === listItem.id);
  if (!previousProfile || !previousListItem) throw new Error('No se encontró el alumno completo.');

  await updateStudentProfile(profile);
  try {
    await updateStudentPersisted(listItem);
  } catch (error) {
    await updateStudentProfile(previousProfile);
    throw error;
  }
}
