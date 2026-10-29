import { RouteSkeleton } from "@/components/nav/screen-skeleton";

// Esqueleto de la pantalla mientras el servidor la prepara. Sale del registro único de pantallas (lib/nav/screens.ts): el mismo que se dibuja al
// hacer clic, con el contenedor y la geometría de la pantalla final.
export default function Loading() {
  return <RouteSkeleton path="/calendario/disponibilidad" />;
}
