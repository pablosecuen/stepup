# Aviso de «Clase en curso»: qué hace el original, qué puede hacer el navegador y qué se implementó

Estado: circuito **implementado**; las capacidades por plataforma son las **documentadas** por los navegadores. **Nada fue probado en dispositivos físicos**: queda como pendiente de prueba real (no se declara confirmado).

## 1. Qué hace el original (verificado en `classSessionNotification.ts` y `useActiveClassSession.ts`)

- **Sólo Android.** En iPhone no hace nada (decisión previa: las Live Activities necesitan una extensión nativa).
- Notificación persistente (`sticky`, prioridad alta, visible en pantalla de bloqueo), con el **mismo identificador** para actualizarla sin duplicarla.
- Título `Clase en curso — <alumnos>`; texto `Quedan mm:ss de N min` o `Tiempo extra: +mm:ss`.
- Se reescribe **cada 30 s mientras la app está en primer plano**. El propio código aclara que si el sistema pausa la app en segundo plano, queda **el último dato conocido**. Es decir: el original tampoco actualiza de forma garantizada con la app cerrada o dormida.
- Pide permiso al comenzar; sin permiso la clase funciona igual.

## 2. Qué permite el navegador (según la documentación de los navegadores)

| Plataforma | Página abierta | Pestaña en segundo plano | Página/navegador cerrados | Permisos |
|---|---|---|---|---|
| Escritorio (Chrome, Edge, Firefox) | Sí: `showNotification` desde el service worker; mismo `tag` reemplaza la anterior | Sí, pero el navegador puede demorar los temporizadores de pestañas ocultas (actualización irregular) | La notificación ya mostrada **queda con el último dato**; no se actualiza (haría falta una notificación Push enviada desde un servidor) | Se pide con un toque; el usuario puede bloquear |
| Android (Chrome) | Sí, **sólo** vía service worker (el constructor `Notification` no funciona en Chrome para Android) | Igual que arriba | Queda el último dato | Idem |
| iPhone / iPad (Safari ≥ 16.4) | **Sólo si TeacherFlow está instalada en la pantalla de inicio** | Igual | Queda el último dato; actualizar requiere Push de servidor | Idem; en Safari sin instalar no existe |
| API de «Notification Triggers» (programar sin servidor) | — | — | — | Experimental: estado actual **no verificado**; no se usa |

Fuentes consultadas: MDN y web.dev (comportamiento de notificaciones, `showNotification`, `tag`), documentación de Chrome sobre Notification Triggers. Los datos de Safari 16.4 provienen de tablas de compatibilidad espejadas y **deben confirmarse con Apple/WebKit** antes de afirmarlos ante usuarias.

## 3. Qué se implementó

- `public/sw.js`: service worker **sólo de notificaciones** (sin caché ni `fetch`: no puede servir información vieja). Al tocar el aviso, enfoca TeacherFlow o abre Inicio.
- `LiveClassNotifier`: con permiso concedido, muestra el aviso al comenzar y lo **refresca cada 30 s mientras TeacherFlow está abierto en Inicio**, con el **mismo título y texto** que el original (`buildClassSessionNotificationBody` es la copia idéntica del original). Lleva la hora de la última actualización (`timestamp`) para que un dato viejo se note. Se quita al finalizar o descartar, y se limpia en Inicio si quedó uno de una clase ya terminada.
- El permiso se pide con el toque de «Comenzar clase»; si se rechaza, la clase comienza igual y la tarjeta explica cómo activarlo (o por qué no está disponible). Nunca se informa sólo con color.

## 4. Diferencias demostradas frente al original

1. **Con la pestaña en otra pantalla o cerrada, el aviso queda con el último dato** (el original tiene la misma limitación cuando el sistema pausa la app, pero en la web ocurre apenas se sale de Inicio). Cerrarla del todo y seguir actualizando exige Push desde servidor (claves VAPID, suscripciones guardadas y un proceso periódico): **no se implementó** porque agrega infraestructura y un proceso automático que no estaba pedido.
2. **Cobertura distinta:** el original sólo existe en Android; la web además cubre escritorio y iPhone *instalado*.
3. **Requiere permiso del navegador** y, en iPhone, instalación; sin eso no hay aviso (la tarjeta de Inicio sigue mostrando el contador).
4. **Estado de la clase en la nube:** la clase en curso vive en el servidor (se ve desde otro navegador); el aviso, en cambio, sólo aparece en el dispositivo donde se concedió el permiso.

## 5. Pruebas

- Automáticas (circuito web): contenido idéntico al del original, cadencia de 30 s, `tag` único, service worker sin `fetch`/caché, limpieza al finalizar/descartar.
- **Pendientes de prueba física** (no se dan por hechas): Android con la página abierta/en segundo plano/cerrada; iPhone instalado; escritorio con la pestaña oculta; permiso denegado y luego concedido.
