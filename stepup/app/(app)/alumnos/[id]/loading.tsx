import { ProfileLoadingSkeleton } from "@/components/nav/profile-loading-skeleton";

// Esqueleto de la pantalla mientras el servidor la prepara. Sale del registro único de pantallas (lib/nav/screens.ts): el mismo que se dibuja al hacer clic, con el contenedor y la
// geometría de la pantalla final; lleva el nombre pulsado para la transición compartida del nombre.
export default function Loading() {
  return <ProfileLoadingSkeleton path="/alumnos/_" />;
}
