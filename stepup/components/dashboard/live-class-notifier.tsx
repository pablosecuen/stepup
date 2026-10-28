"use client";

import { useEffect, useSyncExternalStore } from "react";
import { BellAlertIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import type { LiveClassSession } from "@/lib/live-class/live-class";
import { buildLiveClassNotification, LIVE_CLASS_NOTIFICATION_REFRESH_MS, LIVE_CLASS_NOTIFICATION_TAG } from "@/lib/live-class/notification";

// Aviso de «Clase en curso» del navegador (equivalente web de la notificación persistente de Android del original). Capacidades reales, sin prometer más:
//  - Funciona sólo si el navegador permite notificaciones con service worker Y la profesora dio permiso (se pide con un toque, nunca solo).
//  - Se actualiza cada 30 s MIENTRAS TeacherFlow está abierto en Inicio. Con la pestaña en segundo plano los temporizadores del navegador pueden demorarse; con la pestaña cerrada o en otra
//    pantalla queda el último dato (la hora de la última actualización se ve en la propia notificación). Igual que el original, que no puede actualizarla si el sistema pausa la app.
//  - En iPhone/iPad sólo existe si TeacherFlow está instalada en la pantalla de inicio (iOS 16.4 o posterior).

type Permission = NotificationPermission | "unsupported" | "unknown";
const PERMISSION_EVENT = "teacherflow:notification-permission";

function readPermission(): Permission {
  if (typeof window === "undefined") return "unknown";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission;
}
function subscribePermission(onChange: () => void) {
  window.addEventListener(PERMISSION_EVENT, onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener(PERMISSION_EVENT, onChange);
    window.removeEventListener("focus", onChange);
  };
}
const serverPermission = (): Permission => "unknown";

/** Pide permiso (debe llamarse desde un toque). Nunca lanza; devuelve el estado final. */
export async function requestLiveClassNotificationPermission(): Promise<Permission> {
  try {
    if (readPermission() === "default") await Notification.requestPermission();
  } catch {
    // Sin permiso: la clase funciona igual, sin aviso.
  }
  window.dispatchEvent(new Event(PERMISSION_EVENT));
  return readPermission();
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    await navigator.serviceWorker.register("/sw.js");
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/** Quita el aviso de clase en curso (al finalizar o descartar). Nunca lanza. */
export async function closeLiveClassNotification(): Promise<void> {
  try {
    if (readPermission() === "unsupported" || readPermission() === "unknown") return;
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return;
    (await registration.getNotifications({ tag: LIVE_CLASS_NOTIFICATION_TAG })).forEach((notification) => notification.close());
  } catch {
    // Nunca lanza.
  }
}

async function presentLiveClassNotification(session: LiveClassSession): Promise<void> {
  try {
    const registration = await getRegistration();
    if (!registration) return;
    const { title, body } = buildLiveClassNotification(session, new Date());
    // Mismo `tag`: reemplaza la notificación anterior en lugar de apilar una nueva.
    await registration.showNotification(title, { body, tag: LIVE_CLASS_NOTIFICATION_TAG, requireInteraction: true, silent: true, timestamp: Date.now(), icon: "/icon.png" } as NotificationOptions);
  } catch {
    // Nunca lanza: la tarjeta de Inicio ya muestra el contador.
  }
}

/**
 * Con `session`: mantiene el aviso actualizado y muestra, si hace falta, cómo activarlo. Con `session = null` (Inicio sin clase en curso) sólo limpia un aviso que hubiera quedado de una clase
 * que ya terminó (por ejemplo, finalizada desde otro dispositivo).
 */
export function LiveClassNotifier({ session }: { session: LiveClassSession | null }) {
  const permission = useSyncExternalStore(subscribePermission, readPermission, serverPermission);
  const startedAt = session?.startedAt;
  const names = session?.studentNames.join("\u0000");
  const duration = session?.scheduledDurationMinutes;

  useEffect(() => {
    if (!startedAt || !names || !duration) {
      void closeLiveClassNotification();
      return;
    }
    if (permission !== "granted") return;
    const current = { studentNames: names.split("\u0000"), startedAt, scheduledDurationMinutes: duration } as LiveClassSession;
    void presentLiveClassNotification(current);
    const interval = setInterval(() => void presentLiveClassNotification(current), LIVE_CLASS_NOTIFICATION_REFRESH_MS);
    return () => clearInterval(interval);
  }, [startedAt, names, duration, permission]);

  if (!session || permission === "unknown") return null;
  if (permission === "default") {
    return (
      <div className="mt-3">
        <Button variant="ghost" onClick={() => void requestLiveClassNotificationPermission()} className="min-h-11 text-white">
          <BellAlertIcon className="h-4 w-4" aria-hidden />
          Activar aviso de clase en curso
        </Button>
      </div>
    );
  }
  if (permission === "denied") {
    return <p className="mt-3 text-[13.5px] text-sideText">El aviso de clase en curso está bloqueado en este navegador. Podés habilitarlo desde los permisos del sitio.</p>;
  }
  if (permission === "unsupported") {
    return <p className="mt-3 text-[13.5px] text-sideText">Este navegador no permite el aviso de clase en curso. En iPhone o iPad hace falta instalar TeacherFlow en la pantalla de inicio.</p>;
  }
  return <p className="mt-3 text-[13.5px] text-sideText">Aviso de clase en curso activo: se actualiza cada 30 segundos mientras TeacherFlow está abierto.</p>;
}
