# 05 · Plan de bloques de implementación

Base: remoto `815ace5` (regresión final previa al rediseño: 79/79, «LISTA para rediseño»). Cada bloque sale de un worktree limpio, se verifica (typecheck, lint, build, pruebas) y **se detiene para revisión visual** antes de seguir. Sin deploy hasta aprobación.

| Bloque | Alcance | Estado |
|---|---|---|
| **1 · Fundaciones y estructura** | Tokens, tipografías (`next/font`), fondo/bordes/sombras/foco; componentes base (botones, campos, tarjetas, avisos, insignias, tablas, menús, diálogos y hojas móviles); shell privado de escritorio; navegación móvil; menú de cuenta; landing; login; crear cuenta; recuperar contraseña; confirmación y errores de autenticación; estados globales de carga, error y no encontrado. | **Cerrado y aprobado** (rama local `v1-web`, commits 2491bb4 y 032a9ac; sin push ni deploy). Ver `06-bloque-1.md`. |
| 2 · Inicio | `/inicio` y sus estados reales, sin información nueva que cambie consultas. | Implementado en `v1-web` (sin push ni deploy); en revisión visual. Ver `07-bloque-2.md`. |
| 3 · Alumnos y perfil | Lista, alta, edición y las siete pestañas del perfil. | Pendiente. |
| 4 · Calendario y Registro | Semana/día (agenda en móvil), detalle y diálogos, nueva clase/serie, series, disponibilidad; clases por registrar y registro. **La escala de color del calendario no se toca.** | Pendiente. |
| 5 · Cobros, Recordatorios, Resumen financiero | Centro de cobros, recordatorios, resumen y plan 50/30/20. | Pendiente. |
| 6 · Configuración y cierre | Configuración, respaldo/importación, historial, deshacer, eliminar cuenta; retiro del azul heredado. | Pendiente. |

El orden de 2–6 es una propuesta de trabajo, ajustable tras cada revisión.

## Criterios de salida de cada bloque

1. `npm run typecheck`, `npm run lint`, `npm run build` sin errores.
2. Suite de pruebas completa en verde (sobre copia LF por el fallo conocido de CRLF en una prueba de fechas) y pruebas de B8 vigentes.
3. Verificación visual a 1440, 390 y 320 px sin desborde horizontal; capturas comparativas contra el prototipo, con la lista de diferencias.
4. Revisión de Joaquín (ubicación de botones, navegación, jerarquía) antes del siguiente bloque.
