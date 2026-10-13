# 11 · Bloque 6 — Configuración, Respaldo e Importación (implementado, en revisión visual)

Misma rama `v1-web`, a continuación del Bloque 5. **Sin deploy.** No se tocaron acciones de cuenta, autenticación, sesiones, importación, validación, deshacer, RPC, Supabase ni migraciones: sólo presentación y la retirada del azul heredado de interfaz.

> Nota: el alcance se tomó de `05-plan-de-bloques.md` y del mapa de pantallas (`03-mapa-de-pantallas.md`: «Configuración» y «Respaldo»): Configuración, Respaldo e Importación, historial, deshacer, eliminar cuenta y retiro del azul heredado.

## Alcance

| Pieza | Archivo |
|---|---|
| Piezas compartidas (secciones, filas, enlaces con ícono, índice, ruta «Configuración / Respaldo», aviso de guardado) y los cuatro estilos de botón, ahora los del sistema | `components/account/settings-ui.tsx` |
| Página y vista de Configuración (Cuenta con avatar, Preferencias, Sesión y datos, Acciones sensibles) | `app/(app)/configuracion/page.tsx`, `components/account/configuration-view.tsx` |
| Nombre visible, contraseña, distribución 50/30/20 | `teacher-profile-form.tsx`, `change-password-button.tsx`, `budget-distribution-form.tsx` |
| Dispositivo autorizado y «Cerrar esa sesión remotamente» (ahora diálogo) | `active-session-card.tsx` |
| «Eliminar cuenta» (ahora diálogo) | `delete-account-button.tsx` |
| Respaldo: página, asistente de tres pasos, historial y confirmaciones de deshacer | `app/(app)/configuracion/respaldo/page.tsx`, `components/backup/import-wizard.tsx`, `import-history.tsx`, `import-ui.tsx` |

## Qué cambia (y qué no)

- **Configuración.** Títulos de sección en serifa; encabezado de la cuenta con avatar por iniciales, nombre y correo (los dos datos que la pantalla ya carga); índice lateral con íconos en escritorio y fila de pastillas desplazable en móvil; filas de enlace con ícono; formularios con campos de 46 px y botones del sistema. La distribución 50/30/20 suma una barra apilada decorativa (los porcentajes están escritos en cada control) y conserva los colores reservados del plan: sólo este formulario usa `dataNeeds`, lavanda y salvia.
- **Acciones sensibles.** «Cerrar esa sesión remotamente», «Eliminar cuenta», «Ya no necesito poder deshacerla» y la revisión de «deshacer» pasan de paneles en línea a **diálogos del sistema** (hoja inferior en móvil, foco atrapado, Escape, foco devuelto al botón). Las reglas son las mismas: la palabra ELIMINAR **y** la contraseña, el CAPTCHA si está activo, el servidor revalida todo, la contraseña no queda en pantalla tras un intento fallido, y nada se ejecuta al abrir un diálogo. El foco entra al primer campo de «Eliminar cuenta».
- **Respaldo.** Página ancha; el asistente dentro de una tarjeta, con indicador de pasos en tinta. En «Revisar y decidir», «Antes de confirmar» queda **a la derecha y fija** en escritorio y, en móvil, al final (en el DOM sigue después del contenido: el orden de tabulación no cambia). Casillas y opciones en filas de ≥ 44 px; avisos con ícono + palabra + tono; el aviso de posible duplicado en ámbar con las tres decisiones y «No importar» por defecto; la confirmación fuerte («IMPORTAR») con el botón deshabilitado hasta escribirla.
- **Historial.** Cada importación es una tarjeta con la fecha en serifa, la insignia de estado (Aplicada / Deshecha), los conteos y el plazo. El estado vacío, la carga y el error son los de siempre (se separó `ImportHistoryList` como pieza de presentación; `ImportHistory` sigue cargando igual).

## Retirada del azul heredado

`brandBlue` y `brandBlueDark` se quitaron de `tailwind.config.ts`: ninguna pantalla los usa (Configuración y Respaldo eran las últimas). El azul con significado de dato (**Necesidades** del plan 50/30/20) se conserva como `dataNeeds`. Los tokens del semáforo de cobro (`status*`) siguen definidos y reservados; ninguna pantalla los usa hoy. Las pruebas de contraste pasaron a verificar tinta y terracota (botón principal, botón de acento, anillo de foco).

## Estados implementados

- **Configuración:** normal, nombre y correo largos, sin nombre cargado, sin dispositivo autorizado, cuenta sin conexión (aviso con «Reintentar»), carga, nombre guardado (aviso del guardado), guardando y error al guardar el perfil, diálogo de cerrar sesión remota (y su error), eliminar cuenta (vacío, lista para confirmar, error, eliminando).
- **Respaldo:** inicio (qué va a pasar), «no hay copia en la nube» y «copia demasiado grande», analizando, revisar (sin diferencias, con diferencias y posible duplicado, con casillas marcadas, confirmación fuerte sin y con la palabra, nombres largos, revisión vencida), importando, resultado (completada, ya aplicada antes, sin novedades, deshecha, opción de deshacer quitada, error al deshacer), diálogos de deshacer (seguro y bloqueado) y de quitar la opción; historial con importaciones, vacío, cargando y con error.

## Diferencias frente al prototipo (justificadas por el comportamiento real)

| Prototipo | Implementado | Motivo |
|---|---|---|
| «Políticas de cobro» con insignias «Vence hoy» / «Pago vencido» y su explicación | Sólo el texto actual | Es contenido nuevo; la pantalla real sólo dice que los recargos están desactivados. |
| Campana con contador en la barra superior | Sin campana | Propuesta del shell (`04-propuestas-y-limites.md`). |
| «Simular que escribí la palabra» (botón del prototipo) | No existe | Era un atajo de la maqueta. |
| Los conteos «Aplicada / Deshecha» sólo como insignia | Insignia y fecha; el texto «App móvil x.y.z» queda debajo de la fecha | Los datos son los de siempre. |
| Pantalla «Cuenta sin conexión» como tarjeta propia | Aviso con salida («Reintentar») | Es lo que hace la pantalla real. |

## Verificación

- Datos ficticios con un arnés local temporal (`zz-demo-b6`) sobre los componentes reales; archivado fuera del repositorio y borrado antes del commit. Para las pantallas con contraseña sólo se usaron valores locales de prueba, nunca credenciales reales; ninguna acción de cuenta se ejecutó contra datos reales (el arnés no tiene Supabase).
- 1440, 390 y 320 px (111 comprobaciones): sin desborde horizontal, un solo `<h1>`, todos los controles con nombre accesible y ≥ 44 px de alto (incluidos los controles deslizantes), contraste AA calculado sobre cada texto visible y ningún texto técnico visible.
- Teclado en los tres anchos: recorrido completo de Configuración (índice → formularios → controles → enlaces → acciones sensibles) y de Respaldo con foco de 2 px en cada control; los diálogos de cerrar sesión remota, eliminar cuenta y quitar la opción de deshacer atrapan el foco, Escape los cierra y el foco vuelve al botón que los abrió; «Eliminar cuenta» enfoca el primer campo; con decisiones fuertes «Confirmar e importar» queda deshabilitado hasta escribir la palabra.
- Pruebas: `lib/ui/__tests__/block6-settings-backup.test.ts` (sin colores heredados, token retirado, páginas que sólo resuelven datos, confirmaciones en diálogo con las mismas reglas, manejadores y límites del asistente, orden de «Antes de confirmar», guardas de formateadores). Se actualizaron las pruebas B9 y B10 que fijaban el marcado anterior, sin relajar lo que verifican.
- `typecheck`, `lint`, `build` y suite completa sobre copia LF; `git diff --check` sin errores.

## Notas

- En el arnés, el error de una acción muestra «Supabase no está configurado en este entorno»: es un texto del arnés local; en la aplicación real el mensaje es el que devuelve la acción.
- «Contraseña: enlace enviado» necesita la respuesta real del servidor; su aspecto es el del aviso de éxito del sistema (ícono + texto) y se verificó con la prueba de código, no con una captura.
