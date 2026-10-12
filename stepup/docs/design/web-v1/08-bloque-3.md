# 08 · Bloque 3 — Alumnos y perfil del alumno (cerrado y aprobado, con dos correcciones finales de UX)

Misma rama `v1-web`, a continuación de los Bloques 1 y 2 aprobados. **Sin deploy.** La rama está publicada (sin force) separada de la rama de Production.

## Alcance

Sólo presentación de las pantallas de `/alumnos`: lista, nuevo, editar y las siete pestañas del perfil, más los componentes que esas pantallas usan (acciones de cobro por obligación y por pago, cambio de estado, reportes). **No cambia** Supabase, migraciones, repositorios, consultas ni Server Actions; cada página sigue cargando exactamente lo mismo (y la del perfil, sólo lo de la pestaña activa).

Estructura nueva (las páginas siguen resolviendo los datos; las vistas sólo dibujan):

| Pieza | Archivo |
|---|---|
| Encabezado de página, «Volver», anchos de contenido | `components/ui/page-header.tsx` |
| Lista (encabezado, filtros, tabla/tarjetas, vacíos) | `components/students/students-list-view.tsx` |
| Filtros (formulario GET + hoja inferior móvil) | `components/students/students-filters-form.tsx` |
| Fila en tabla y tarjeta móvil, chip de nivel | `components/students/student-card.tsx` |
| Marco de Nuevo/Editar alumno | `components/students/student-form-page.tsx` |
| Perfil (encabezado, pestañas, contenido) | `components/students/profile/*` (`student-profile-view.tsx`, `profile-header.tsx`, `*-tab.tsx`) |
| Obligación y pago: registrar, anular | `components/payments/charge-actions.tsx`, `void-payment-button.tsx` (ahora con diálogos) |

Nuevo en el sistema de componentes: variante de botón `dangerGhost` (acción destructiva de poco peso), tamaño de avatar `profile`, ayudante `avatarInitials` (hasta dos iniciales).

## Dónde está cada acción (principal / secundaria / destructiva)

| Pantalla | Principal (una) | Secundarias | Destructivas |
|---|---|---|---|
| Lista | «Nuevo alumno» (tinta, arriba a la derecha) | «Aplicar filtros» (contorno), «Limpiar» (enlace), «Filtros» en móvil (contorno), paginación (contorno) | — |
| Nuevo alumno | «Guardar alumno» (tinta, al final del formulario) | «Cancelar» (sin borde); en el aviso de duplicado: «Revisar alumno existente» y «Volver y editar los datos» (contorno) y, de menor peso, «Es otra persona, crear igualmente» (sin borde) | — |
| Editar alumno | «Guardar cambios» (tinta) | «Cancelar» (sin borde, vuelve a la ficha) | — (el cambio de estado vive en el Resumen del perfil) |
| Perfil — encabezado | — (la pantalla informa; no hay acción dominante) | «Editar alumno» (contorno), «Volver a Alumnos» (enlace de texto) | — |
| Perfil — Resumen | — | «Aplicar cambio de estado» (contorno) en su propia tarjeta al final | Al elegir «Archivado» el botón pasa a contorno rojo y queda bloqueado hasta elegir la agenda futura |
| Perfil — Cobros | — | «Registrar pago» (contorno) por obligación | «Anular cobro» (texto rojo, al otro extremo de la fila) y «Anular» por pago (texto rojo); ambos abren un diálogo |
| Perfil — Reportes | «Generar PDF» (acento, en la vista previa) | «Previsualizar», «Ver / Descargar» (contorno), «Regenerar», «Crear otro reporte», «Reintentar limpieza pendiente» (sin borde) | «Eliminar» (texto rojo, al otro extremo) → diálogo de confirmación |

En móvil los botones de las filas se reparten en renglones (nunca una fila de botones imposible de usar) y los diálogos son hojas inferiores con la acción principal arriba y a ancho completo.

## Estados implementados

- **Lista:** completa (24 por página, paginación), pocos alumnos, vacío inicial, sin resultados por filtros, búsqueda, filtro por modalidad, activos/pausados/inactivos/archivados (insignia con texto), nombres y niveles largos, niveles personalizados (abierto y renombrando), hoja de filtros móvil con chips de filtros aplicados, error de carga, no encontrado, carga (esqueleto del Bloque 1).
- **Nuevo alumno:** formulario completo, error del servidor, sin conexión, procesando, posible duplicado (uno y varios candidatos), «los duplicados cambiaron» y confirmación «es otra persona». Clave de operación por borrador, bloqueo mientras envía y reintento idempotente: sin cambios.
- **Editar alumno:** datos actuales, error, guardando, textos largos.
- **Perfil:** las siete pestañas con datos, vacías y con textos extremadamente largos (nombre, niveles, importes de 12 cifras, observaciones, correo); alumno pausado, inactivo y archivado; sin próxima clase; cambio de estado y archivado con elección de agenda; diálogos de registrar pago, anular cobro, anular pago y eliminar reporte; vista previa del reporte; error de carga y alumno no encontrado.

## Diferencias inevitables frente al prototipo (falta de datos o de funciones)

| Prototipo | Implementado | Motivo |
|---|---|---|
| Contador «Tareas 2» en la pestaña | Sin contador | Las tareas sólo se cargan en Resumen y Tareas; mostrarlo en las demás exigiría una consulta nueva. |
| Fecha corta «Mié 14 oct · 09:00» | «miércoles, 14 de octubre, 09:00» | Se conserva el formato de fecha ya establecido. |
| Etiqueta «Vence pronto» y «Pago vencido» | «Pendiente» / «Vencido» (los textos existentes) | «Vence pronto» es un estado nuevo; no cambia la lógica de vencimientos. |
| Ayudas bajo los campos («Máximo: el saldo pendiente», «No puede ser futura», «día/mes/año», precio de referencia, niveles propios) | Sin esas ayudas | Texto nuevo; las restricciones siguen aplicándose como antes. |
| Errores por campo en Nuevo alumno | Los errores existentes (cuadro de error del servidor) | Propuesta (`04-propuestas-y-limites.md`): no se inventan validaciones. |
| Diálogo de confirmación antes de archivar | Elección explícita de la agenda futura (como antes) | Confirmaciones nuevas son «Propuesta». |
| «Previsualizar de nuevo» | «Previsualizar» | Copy nuevo. |
| Vacíos de la lista con título y una segunda línea («Probá con otro nombre o quitá algún filtro», «Agregá a tu primer alumno…») | Un solo mensaje existente + la acción | Copy nuevo; el vacío conserva su texto y su acción («Limpiar filtros» / «Agregar alumno»). |
| Barra superior móvil con flecha y nombre del alumno, campana con panel, contadores y tarjeta «En curso» de la barra lateral | La barra del Bloque 1 | Pertenecen al shell (propuestas). |
| Fila de la lista clicable en toda su superficie (escritorio) | Nombre y avatar son el enlace; en móvil, toda la tarjeta | Un enlace por fila evita tablas con filas interactivas poco accesibles. |

## Correcciones finales de UX (tras la revisión del Bloque 3)

1. **Contexto en los diálogos de Cobros.** «Registrar pago», «Anular cobro» y «Anular pago» muestran, dentro del propio diálogo, qué se está modificando: *alumno · concepto*, *vence …* e *importe original* y *saldo pendiente* (cobros), o *importe · método · fecha* y el alumno (pagos). Sólo se usa lo que cada llamador ya tenía (la pestaña Cobros del perfil: alumno y cobro/pago cargados; Cobros global: la entrada del centro de cobros); lo que falta se omite y no se agregó ninguna consulta (`components/payments/dialog-context.tsx`). El saldo ya no se repite como párrafo aparte. Los dos llamadores y los diálogos de Cobros global comparten los mismos componentes.
2. **«Volver y editar los datos» en el aviso de posible duplicado.** Botón común (no envía) que cierra el aviso y devuelve el foco al campo «Nombre completo». No dispara ninguna Server Action, no crea alumno, no rota ni borra la clave por borrador y no limpia lo escrito (el formulario no se desmonta). El aviso se oculta sólo para ese estado: un envío nuevo lo vuelve a mostrar (`lib/students/duplicate-review.ts`). «Es otra persona, crear igualmente» sigue siendo una confirmación explícita y pasó a ser la acción de menor peso (sin borde).

## Verificación

- Datos ficticios con un arnés local temporal (rutas `zz-demo-b3`, no versionadas) sobre los componentes reales; el arnés se borró antes del commit.
- 1440, 390 y 320 px: sin desborde horizontal en ninguna de las 161 capturas; un solo `<h1>` por pantalla; ningún objetivo táctil de menos de 44 px de alto; todos los controles con nombre accesible; la pestaña activa del perfil queda dentro de la pantalla en móvil.
- Teclado: la hoja de filtros y los diálogos atrapan el foco, se cierran con Escape y devuelven el foco al control que los abrió; el foco visible (anillo de tinta) se ve en enlaces, botones y pestañas.
- `typecheck`, `lint`, `build` y la suite completa sobre copia LF. Pruebas nuevas: `lib/ui/__tests__/block3-students.test.ts` (sin azul heredado ni colores reservados, vistas sin acceso a datos, idempotencia y confirmación de duplicado, una sola acción principal, diálogos, textos largos). Se actualizaron cuatro pruebas que fijaban dónde estaba el marcado (`b4-states`, `profile-overview`, `design-tokens`), sin relajar lo que verifican.
