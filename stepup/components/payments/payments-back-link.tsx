"use client";

import { useSyncExternalStore } from "react";
import { BackLink } from "@/components/ui/page-header";
import { readPerStudentMemory } from "@/components/payments/per-student-memory";

const subscribe = () => () => {};

/**
 * «Volver a Cobros» desde la ficha de un alumno abierta desde Cobros. Si se llegó desde «Por alumno» (esta pestaña guardó esa lista para ESTE mismo alumno hace poco),
 * vuelve a esa pestaña con su búsqueda, filtro, orden y posición; si no, al Centro de cobros. En el servidor y en el primer dibujo es siempre `/cobros` (sin diferencias de hidratación).
 */
export function PaymentsBackLink({ studentId }: { studentId: string }) {
  const href = useSyncExternalStore(
    subscribe,
    () => {
      const memory = readPerStudentMemory();
      return memory && memory.studentId === studentId ? memory.href : "/cobros";
    },
    () => "/cobros",
  );
  return <BackLink href={href}>Volver a Cobros</BackLink>;
}
