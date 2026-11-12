# Cierre de pendientes (12/11/2026, cuarta entrega)

Complementa `CIERRE_PENDIENTES_20261112.md`. «QA» = cuenta de pruebas; ningún dato real se tocó.

## 1. Lista de clases simultáneas (teléfono, semana)

* **Qué es un grupo:** exactamente el conjunto de clases que `layoutDayItems` reparte en carriles (campo nuevo `group`); no una aproximación por píxeles. `lib/calendar/simultaneous-groups.ts` (puro) lo calcula; `components/calendar/simultaneous-group.tsx` dibuja la marca y la lista; `real-calendar-grid.tsx` los conecta. El escritorio y la vista de un día no cambian (`isMobile && isWeek`).
* **Identificación:** contorno punteado (no sólo color) alrededor de la zona del grupo y, cuando no tapa a otra clase, la cantidad (insignia 16 px bajo el contorno). La marca es transparente: no tapa nombres.
* **Un solo control:** las clases del grupo quedan `inert` (sin toque ni foco: no hay controles superpuestos) y la marca es el único botón, con etiqueta accesible «3 clases a las 11:00: A, B y C. Abrir la lista.».
* **Lista:** hoja inferior con el diálogo común (Escape, foco atrapado, devolución del foco, fondo sin scroll); nombre completo en líneas (nunca recortado ni partido por letras), «11:00 a 12:00 · Online» y, si corresponde, «Cancelada»/«Reprogramada» en texto. Filas de ≥ 56 px. Tocar una fila abre el detalle REAL de esa clase.
* **Regreso:** nada se desmonta; al cerrar el detalle el foco vuelve a la marca y la semana, la vista y el desplazamiento quedan como estaban.
* **Laboratorio (Edge, grilla real, datos sintéticos, toques reales por CDP) a 375, 390 y 430 px:** 5 marcas con su cantidad y etiqueta; lista sin nombres cortados; la fila 2 abre su propia clase; Escape cierra y el foco vuelve a la marca; misma posición (`l`/`t`) y URL; teclado (Enter abre, foco dentro del diálogo, Escape cierra y vuelve); una clase suelta sigue abriendo su detalle directo. Capturas: `C:\Users\joaqu\tf-design\carga\capturas\grupo-real-{375,390,430}-*.png`.
* Pruebas: `lib/calendar/__tests__/simultaneous-groups.test.ts` (grupos exactos, cadenas no agrupan, dos grupos, zona, estados con texto, etiqueta accesible, insignia, cableado y reglas de accesibilidad).

**Nombres fuera de simultáneas (matriz `matriz-nombres.mjs`, sin cambios en el planificador):** completos en clases sueltas y consecutivas (11 → 10 px, nunca menos). Siguen sin caber: una palabra de ≥ 10 letras en una clase de 5–10 min («Maximiliano», 68–79 px), «Guadalupe» en cadena a 375 px y nombres de 5 palabras: se muestran con «…» y el nombre completo está en el detalle. No se declaran resueltos.

## 2. Guardar y regresar (Nueva clase)

QA, producción, 390 px: desde `?week=2026-11-23` con la grilla en 96/230 px → «Nueva clase» (lleva `volver`) → clase única de QA (24/11 10:00, 30 min) → **doble clic en Guardar** → vuelve a `/calendario?week=2026-11-23` con la grilla en **96/230**. Recargado: una sola tarjeta y **una sola fila** en la base. Cancelar (semana 16/11) ya se había comprobado: vuelve igual.

## 3. Doble pantalla y segunda carga — recorrido REAL (producción, datos de QA)

Condición real preparada con alumnos de QA nuevos (por clase → plan semanal sin cargo): al entrar a Cobros, `ChargeGenerationTrigger` crea el cargo y hace `router.refresh()`.

| Escenario | Resultado |
|---|---|
| Entrada normal a Cobros (cargo por generar) | Esqueleto **una** vez (`data-tf-skeleton` 1 → 0), una `main`, una cabecera, una barra; POST de generación → `router.refresh()` (un solo `GET _rsc`) → la fila nueva aparece en el sitio, **sin** segundo esqueleto, sin transición de vistas, sin reiniciar animaciones. |
| Página desplazada + red lenta (+1,5 s por respuesta) | Contenido a los ~6 s; desplazado a 300 px; POST 2,4 s, refresco 1,6 s; la fila aparece con la posición en **300 px** y sin esqueleto. |
| Instantáneas de la transición | Sólo `tf-route-content` (contenido saliente/entrante, cruce de 120/220 ms por diseño) y `root`; **cabecera y barra inferior no tienen capa propia** (no se duplican). |
| Cobros → Resumen financiero | Un esqueleto, una `main`, cabecera y barra siempre únicas. |
| Clics rápidos (Inicio → Cobros → Alumnos → Cobros), Atrás y Adelante | Gana el último destino; una sola `main`, cabecera y barra; sin esqueletos colgados. |

No se encontró doble aparición, reinicio del esqueleto ni pérdida de posición: **no se cambió el flujo** (la generación sigue idempotente y el refresco, necesario). Límite: Safari/iPhone (no hay forma de reproducirlo acá). Las navegaciones del panel integrado sólo avanzan al pedir cuadros, por eso la secuencia se registró con observadores (`MutationObserver`, `getAnimations`, `startViewTransition`) y no con video.

## 4. Pago: clave de operación protegida

* **Servidor** — migración `20261112100000_register_payment_operation_guard.sql` (reemplaza sólo `register_payment`; mismos permisos, `search_path` fijo, idempotencia atómica por `(owner_id, operation_id)`): misma clave y mismo contenido = misma fila, sin duplicar; misma clave con otro alumno, importe, método, fecha, notas, pago reemplazado o cobro = error 22023 «Esta operación ya se registró con otros datos…». Postgres real (`supabase/tests/postgres/register_payment_operation_guard.cjs`): **20/20 con la migración, 14/20 sin ella**: reintento exacto, 5 variantes rechazadas sin escribir, segundo pago con clave nueva (saldo 3.500), error de validación + reintento corregido con la misma clave, doble envío simultáneo (un solo pago), envíos simultáneos con distinto importe (uno entra, otro se rechaza), aislamiento entre cuentas. Aplicada a producción: función, ACL, `search_path` y los 204 pagos reales sin cambios (huella igual).
* **Pantalla:** tras un pago exitoso la clave se **rota**; un error de red o de validación la **conserva**; sólo el conflicto la rota y recarga los datos (sin reenviar solo).
