# 07 · Bloque 2 — Inicio (cerrado y aprobado)

Misma rama local `v1-web` / worktree `C:\Users\joaqu\tf-web-v1`, a continuación del cierre del Bloque 1. Aprobado visualmente por Joaquín (commit `787a145`). La rama `v1-web` se publica sin force y separada de la rama de Production; **sin deploy**.

## Alcance

Sólo presentación de `/inicio`: `components/dashboard/home-view.tsx`, `first-steps.tsx` y el nuevo `home-error.tsx` (más el uso de este último en `app/(app)/inicio/page.tsx`). **No cambia** `lib/dashboard/*` (consultas, etapas, saludo), la recuperación B0 (`redirect(SESSION_RECOVERY_PATH)`), ni agrega `loading.tsx` a `/inicio` (lo fija `home-welcome.test.ts`).

## Estados reales implementados

| Estado | Cuándo |
|---|---|
| Cuenta nueva sin alumnos | `resolveHomeStage` = `empty`: saludo + Primeros pasos (0 de 2); sin tarjeta de Cobros. |
| Con alumnos, sin clases | `students-only`: Primeros pasos (1 de 2 listos, paso 2 habilitado) + tarjeta de Cobros. |
| Con actividad | `active`: «Nueva clase», resumen del día, agenda, por registrar, Cobros, Recordatorios. |
| Clase en curso / próxima | Tarjeta destacada (`nextClass`) y marca «En curso» / «Sigue» en la agenda. |
| Clases de hoy | Lista con hora de inicio y fin, avatar (inicial, o ícono si es grupal/sin alumnos), título y modalidad. |
| Clases por registrar | Hasta 3, con avance de las grupales; «Ver todas (n)» si hay más. Sin pendientes: mensaje en texto. |
| Resumen actual de Cobros | Sólo las dos cantidades que Inicio ya cargaba («N vencen hoy · M vencidos»). |
| Clases sin alumnos | Aviso con las primeras 3 y «Revisar en Series». |
| Recordatorios existentes | Campana (como siempre) + tarjeta con las categorías reales y su cantidad. |
| Carga | Sin `loading.tsx` (B0). |
| Error | `HomeLoadError`: tres mensajes existentes (general, sesión todavía no reconocida, sesión vencida) con «Reintentar». |
| Vacío | «No hay clases agendadas para hoy.» y «No hay clases pendientes de registrar.». |

## Diferencias inevitables frente al prototipo (falta de datos o funciones)

| Prototipo | Implementado | Motivo |
|---|---|---|
| Frase «Hoy tenés 6 clases: 1 transcurrida, 1 en curso y 4 por delante» | «Hoy tenés N clases.» | Inicio no carga la hora actual ni el estado de cada clase; sólo `nextClass`. |
| Marca «Transcurrida» y barra de segmentos en «Clases de hoy» | No están | Mismo motivo. «En curso»/«Sigue» salen de `nextClass`. |
| 4 KPIs (incluye «Vencen hoy» y «Vencidos» con importes) | 3: Clases de hoy, Por registrar, Recordatorios | Los importes no se cargan; los dos conteos de cobros viven en la tarjeta Cobros. |
| Tarjeta Cobros con nombres, tipo, vencimiento e importe por alumno | Dos cantidades | «No mostrar nombres ni importes si Inicio no los carga». |
| Fila de accesos «Nuevo alumno / Registro de clases / Cobros» y cuadrícula de 4 accesos en móvil | Sólo «Nueva clase» | Se conservan los accesos actuales; los demás destinos están en la navegación. |
| «Hoy vas a ver a N alumnos» con avatares | No está | Las clases grupales sólo traen cantidad de participantes, no sus nombres. |
| Tarjeta «Mañana, jueves 8» | No está | Requiere ampliar datos. |
| Botón «Registrar»/«Continuar» en cada clase por registrar | Filas sin botón | Hoy no hay acceso por fila; se conserva «Ver todas». |
| Tarjetas «Lo que vas a ver acá» y «Tus alumnos» en Primeros pasos; frase «Tu cuenta está lista para empezar» | No están | Copy y datos nuevos (nombres de alumnos no cargados). |
| Contador de Registro/Cobros en la barra lateral, tarjeta «En curso» y botón flotante | No están | Ver `04-propuestas-y-limites.md`. |
| Campana con panel desplegable | Campana que navega a `/recordatorios` | El panel es «Propuesta». |
| Filas de la agenda y del resumen como enlaces al calendario | Sin enlace | Inicio no tenía ese acceso; se conservan los existentes. |
| Avatares de grupo apilados con iniciales de cada alumno | Un ícono de grupo | No se cargan los nombres de los participantes. |

## Verificación

- Estados probados con datos de ejemplo ficticios (rutas temporales de demostración, no versionadas): cuenta nueva, con alumnos, con actividad, clase en curso, próxima clase, contenido mínimo, sin clases hoy, perfil sin nombre, **12 clases con nombres y títulos largos**, **9 por registrar**, 52 recordatorios, 5 clases sin alumnos, errores (general, sesión no reconocida, sesión vencida).
- 1440, 390 y 320 px sin desborde horizontal; objetivos táctiles ≥ 44 px; un solo `<h1>`; encabezados sin el contador pegado.
- Pruebas nuevas en `lib/ui/__tests__/block2-home.test.ts` (sin azul heredado ni colores del semáforo, sin campos nuevos de `HomeData`, sin nombres/importes de cobros, textos sin truncar, B0 intacto, error con componente propio).
