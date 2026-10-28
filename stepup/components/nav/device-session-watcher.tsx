"use client";

import { useEffect, useRef } from "react";
import { checkDeviceSessionAction } from "@/lib/actions/device-session";

const CHECK_EVERY_MS = 60_000;

/**
 * Revisa cada minuto y al volver a la pestaña que este navegador conserve uno de los dos lugares y renueva su autorización.
 * Si otro dispositivo tomó la cuenta, lleva a «Tu cuenta se abrió en otro dispositivo». Un fallo de red o del servidor NUNCA cierra la sesión: se reintenta en la próxima revisión
 * (sin conexión no hay forma de saber que otro dispositivo la tomó, igual que en la app original).
 */
export function DeviceSessionWatcher() {
  const running = useRef(false);

  useEffect(() => {
    let stopped = false;
    async function check() {
      if (stopped || running.current || document.visibilityState === "hidden") return;
      running.current = true;
      try {
        const result = await checkDeviceSessionAction();
        if (!stopped && result.status !== "authorized" && result.status !== "unavailable") window.location.assign(result.status === "taken-elsewhere" ? "/dispositivo?motivo=otro" : "/dispositivo");
      } catch {
        // Sin conexión o error del servidor: se reintenta luego.
      } finally {
        running.current = false;
      }
    }
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return null;
}
