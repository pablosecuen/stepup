"use client";

import { useSyncExternalStore } from "react";
import { BackLink } from "@/components/ui/page-header";
import { STUDENTS_LIST_MEMORY_KEY } from "@/lib/students/list-url";

/** Sólo se acepta una dirección de la propia lista de Alumnos (nunca un destino arbitrario guardado en la pestaña). */
const LIST_HREF_PATTERN = /^\/alumnos(\?[^#\s]*)?$/;

function rememberedListHref(): string {
  try {
    const remembered = window.sessionStorage.getItem(STUDENTS_LIST_MEMORY_KEY);
    return remembered && LIST_HREF_PATTERN.test(remembered) ? remembered : "/alumnos";
  } catch {
    return "/alumnos"; // sin almacenamiento de sesión: la lista sin filtros
  }
}

const subscribe = () => () => {};

/**
 * «Volver a Alumnos» desde un perfil: regresa a la lista tal como estaba (búsqueda, filtros, orden y página) si esta pestaña la mostró antes; si no, a la lista sin filtros.
 * En el servidor y en el primer dibujo del navegador es siempre `/alumnos` (sin diferencias de hidratación); la memoria de la pestaña se aplica enseguida después.
 */
export function StudentsBackLink() {
  const href = useSyncExternalStore(subscribe, rememberedListHref, () => "/alumnos");
  return <BackLink href={href}>Volver a Alumnos</BackLink>;
}
