"use client";

import { RouteSkeleton } from "@/components/nav/screen-skeleton";
import { readSharedNameMatching } from "@/lib/nav/pending-destination";

/** Fichas de alumno: `/alumnos/:id` y `/cobros/alumnos/:id`. */
const PROFILE_PATH = /^\/(?:cobros\/)?alumnos\/[^/]+$/;

/**
 * Esqueleto de `loading.tsx` de una ficha. Se dibuja dentro de la transición de la propia navegación, así que lleva el NOMBRE del alumno pulsado (y su nombre de transición) en el
 * encabezado: la transición compartida del nombre aterriza ahí aunque los datos tarden, y el encabezado real lo reemplaza con el mismo texto y la misma posición, sin saltos.
 * Sin clic previo (carga directa, recarga) no hay nombre y se dibuja el bloque de siempre.
 */
export function ProfileLoadingSkeleton({ path }: { path: string }) {
  return <RouteSkeleton path={path} sharedName={readSharedNameMatching(PROFILE_PATH)} />;
}
