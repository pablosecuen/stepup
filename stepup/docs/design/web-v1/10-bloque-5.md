# 10 · Bloque 5 — Dinero, recordatorios y reportes (implementado, en revisión visual)

Misma rama `v1-web`, a continuación del Bloque 4. **Sin deploy.** No se tocaron cálculos, saldos, vencimientos, estados, generación de cargos, pagos, asignaciones, cuotas ni conciliación; tampoco consultas, RPC, escrituras, Supabase ni migraciones.

## Alcance

Sólo presentación de `/cobros`, `/recordatorios`, `/resumen-financiero` y de la pestaña Reportes del perfil del alumno. Las páginas siguen resolviendo los datos exactamente igual (mismas funciones, mismo orden); las vistas nuevas sólo los dibujan.

| Pieza | Archivo |
|---|---|
| Cobros globales (tabla en escritorio, tarjetas en móvil) y su estado de error | `components/payments/collections-view.tsx`, `app/(app)/cobros/page.tsx` |
| «Registrar pago» / «Anular cobro» (diálogos reales; variante compacta para la fila) | `components/payments/charge-actions.tsx` |
| Recordatorios (cuatro categorías reales) y su estado de error | `components/reminders/reminders-view.tsx`, `reminder-icons.ts` (compartido con Inicio), `app/(app)/recordatorios/page.tsx` |
| Resumen financiero (período, cifras, actividad, valor de la hora, demanda, alumnos) y su estado de error | `components/finance/financial-overview-view.tsx`, `app/(app)/resumen-financiero/page.tsx` |
| Reportes del alumno (lista, generación, vista previa, descarga, eliminación) | `components/students/profile/reportes-tab.tsx` (ya rediseñada en el Bloque 3; se verificó y se capturó entera, sin cambios de código) |

## Qué muestra cada pantalla (sólo datos que ya carga)

- **Cobros.** Por obligación: alumno (avatar con iniciales + nombre, enlace al perfil), concepto, vencimiento, estado, saldo pendiente y —si hay un pago parcial— «de $ original · ya pagó $ …». Estados con texto + ícono + tono: *Pago vencido*, *Vence hoy*, *Vence pronto*, *Pago pendiente* (mismos textos y criterio que antes). Escritorio (≥ 820 px): tabla con encabezado fijo; móvil: una tarjeta por cobro con el saldo en serifa y las dos acciones. Vacío («No hay cobros pendientes.»), error con «Reintentar» y carga (esqueleto del Bloque 1). Los diálogos conservan el contexto del Bloque 3 (alumno · concepto, vencimiento, importe original, saldo) y se abren como hoja inferior en móvil.
- **Recordatorios.** Cada categoría real con ícono, título en serifa y contador; cada fila con el título y el subtítulo que ya traía. «Todo al día» cuando no queda nada; error con «Reintentar». Las filas son informativas: hoy no existe una acción para resolver un recordatorio (uno resuelto desaparece), así que no se agregó ninguna.
- **Resumen financiero.** Selector de período (cinco períodos, `aria-current`), cuatro cifras principales con la variación contra el período anterior sólo en «Mes actual», actividad (clases, horas, canceladas, reprogramadas) con la distribución por modalidad (barras decorativas: el valor está escrito), valor programado de la hora, demanda y alumnos del año. Sin datos: las mismas tarjetas en cero y «Sin datos suficientes» donde corresponde. Error con «Reintentar». Todo con los formateadores únicos de dinero, porcentajes, horas y meses.
- **Reportes.** Lista del historial, selección de meses, vista previa editable, «Generar PDF» con estado ocupado, descarga, regeneración y eliminación con diálogo de confirmación que nombra el reporte y el alumno. El contenido del reporte y del PDF no cambió.

## Diferencias frente al prototipo (justificadas por el comportamiento real)

| Prototipo | Implementado | Motivo |
|---|---|---|
| Barra de resumen por estado (vencidos, vencen hoy, …) y filtros «Todos / Vencidos / …» en Cobros | Sin barra ni filtros | Propuesta (`04-propuestas-y-limites.md`): hoy la pantalla no los muestra. |
| Botón «Detalle» y diálogo «Detalle del cobro» | Sin ese botón | No existe un detalle del cobro en la aplicación real. |
| Contadores de Cobros y Registro en la barra lateral | Sin contadores | Propuesta del shell. |
| Botones «Registrar» / «Registrar pago» / «Asignar alumnos» en cada recordatorio y chips de estado («Vencido», «Hoy») | Filas informativas | Propuesta: no existe una acción para resolver recordatorios, y la lista no trae un estado por fila. |
| Gráfico «Ingresos por mes», barra «Saldos pendientes», conteo de cobros por cifra y «Altas por mes» | No se dibujan | La pantalla real sólo carga totales del período; no hay serie mensual ni cantidad de cobros en cada total. |
| Plan 50/30/20 y proyección anual | No existe en la web | Es una función del móvil; el Resumen web no la tiene hoy. |
| Plantilla del PDF con el aspecto de la web | Sin cambios | El PDF mantiene sus formatos; no adopta el shell visual. |
| Aviso «Registro finalizado» (toast) | No aplica | Es de Registro (Bloque 4). |

## Verificación

- Datos ficticios con un arnés local temporal (`zz-demo-b5`, más el del Bloque 3 para Reportes), sobre los componentes reales; archivado fuera del repositorio y borrado antes del commit.
- 1440, 390 y 320 px (32 pantallas × 3 anchos = 96 comprobaciones): sin desborde horizontal, un solo `<h1>`, todos los controles con nombre accesible y ≥ 44 px de alto, contraste AA calculado sobre cada texto visible, y ningún texto técnico visible (fecha ISO, UUID, `NaN`, `undefined`, `null`, nombres de tabla o de restricción).
- Estados: Cobros con muchos, pocos, uno y ningún elemento; nombres y conceptos largos; importes con centavos y pagos parciales; carga y error. Pago y anulación en escritorio y como hoja inferior móvil, con importe inválido, motivo faltante y «Guardando…»/«Anulando…» (la respuesta del servidor se detuvo a propósito para fijar el estado de procesamiento). Recordatorios con varias categorías, una sola, nombres largos, «Todo al día», carga y error. Resumen con datos, otros períodos, sin datos, carga y error. Reportes con historial, vacío, vista previa, selección de meses, «Calculando…», eliminación con confirmación y «Eliminando…».
- Teclado en los tres anchos: el orden de Tab recorre alumno → Registrar pago → Anular cobro fila por fila; los diálogos de pago, anulación y eliminar reporte atrapan el foco, Escape los cierra y el foco vuelve al botón que los abrió; el contorno de foco es de 2 px.
- Pruebas: `lib/ui/__tests__/block5-money-reports.test.ts` (sin colores heredados, páginas que sólo resuelven datos, textos y criterios de estado de Cobros, ausencia de lo que no existe —filtros, detalle, acciones de recordatorios, gráficos—, formateadores únicos y flujo/idempotencia de Reportes).
- `typecheck`, `lint`, `build` y suite completa sobre copia LF; `git diff --check` sin errores.

## Notas

- El mensaje del error de «Previsualizar» que aparece en una de las capturas de Reportes («Supabase no está configurado en este entorno») es del arnés local, que no tiene base de datos; en la aplicación real el mensaje es el que devuelve la acción.
- El azul heredado y los colores del semáforo de cobro ya no se usan en estas pantallas; quedan en Configuración, que es el Bloque 6.
