// Contenido de la notificación de «Clase en curso». Mismo título y mismo texto que la notificación de Android del original: el texto sale de `buildClassSessionNotificationBody` (copia idéntica).
import { buildClassSessionNotificationBody } from "../payments/engine/features/dashboard/utils/activeClassTiming.ts";
import type { LiveClassSession } from "./live-class.ts";

export const LIVE_CLASS_NOTIFICATION_TAG = "active-class-session";
/** Cadencia de actualización del original (mientras la app está abierta). */
export const LIVE_CLASS_NOTIFICATION_REFRESH_MS = 30_000;

export function buildLiveClassNotification(session: Pick<LiveClassSession, "studentNames" | "startedAt" | "scheduledDurationMinutes">, now: Date): { title: string; body: string } {
  return {
    title: `Clase en curso — ${session.studentNames.join(", ")}`,
    body: buildClassSessionNotificationBody(session.startedAt, session.scheduledDurationMinutes, now),
  };
}
