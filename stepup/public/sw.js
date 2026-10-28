// Service worker de TeacherFlow: SOLO para mostrar y abrir la notificación de «Clase en curso».
// Deliberadamente no tiene manejador `fetch` ni caché: nunca sirve páginas ni datos guardados (no puede mostrar información vieja).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/inicio");
    }),
  );
});
