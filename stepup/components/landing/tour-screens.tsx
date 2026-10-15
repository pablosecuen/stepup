"use client";

import { Monitor } from "@/components/landing/frame";
import { ScreenCalendarioSemana, ScreenCobros, ScreenPerfil, ScreenResumen } from "@/components/landing/screens";

/** Pantallas del recorrido que no viajan en el HTML inicial (fragmento aparte, pedido al elegirlas). */
export function TourCalendario() {
  return (
    <Monitor path="calendario">
      <ScreenCalendarioSemana />
    </Monitor>
  );
}
export function TourPerfil() {
  return (
    <Monitor path="alumnos/perfil">
      <ScreenPerfil />
    </Monitor>
  );
}
export function TourCobros() {
  return (
    <Monitor path="cobros">
      <ScreenCobros />
    </Monitor>
  );
}
export function TourResumen() {
  return (
    <Monitor path="resumen-financiero">
      <ScreenResumen />
    </Monitor>
  );
}
