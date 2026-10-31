import { ProfileLoadingSkeleton } from "@/components/nav/profile-loading-skeleton";

// Esqueleto de la ficha de cobros del alumno (con el nombre pulsado, para la transición compartida del nombre).
export default function Loading() {
  return <ProfileLoadingSkeleton path="/cobros/alumnos/_" />;
}
