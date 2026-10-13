# 12 · Bloque 7 — Integración, regresión y despliegue final

Cierre del rediseño visual v1. **Sin pantallas nuevas ni rediseños**: sólo integración, verificación y publicación de los Bloques 1–6 (rama `v1-web`). No se tocó Supabase, ninguna migración, RPC ni dato real.

## 7.1 Línea base (antes de integrar)

| Dato | Valor |
|---|---|
| Rama de Production (`origin/teacherflow-web`) | `815ace5` (sin avances desde la base del rediseño) |
| Deployment de Production anterior (rollback) | `dpl_E6gofhxGbXaY754gZtYqCxpwJmkM` · `teacherflow-70yi0uc0e-teacherflow.vercel.app` · `Ready` · 07/10/2026 19:58 (hora de Argentina) |
| Commit desplegado en ese deployment | `91e5913` (R8). `815ace5` sólo agrega documentación y guiones de regresión encima: el código de la aplicación es el mismo |
| Aliases al deployment anterior | `teacherflowapp.com`, `teacherflow-web.vercel.app`, `teacherflow-web-teacherflow.vercel.app` |
| `v1-web` respecto de `teacherflow-web` | 12 commits adelante, 0 atrás → integración por **fast-forward** |
| Diferencia | 161 archivos: 76 en `components/`, 43 en `app/`, 29 en `lib/` (de ellos 17 son pruebas), 12 en `docs/` y `tailwind.config.ts` |

Auditoría de la diferencia: ninguna ruta bajo `supabase/` (cero migraciones, RPC o cambios de base), ningún `.env`, `.vercel`, imagen, PDF, captura, arnés (`zz-demo*`) ni secreto. En `lib/` los cambios que no son pruebas son: `calendar/layout.ts` (geometría de la grilla), `students/duplicate-review.ts` y `ui/avatar-tone.ts` (presentación), `backup/import-copy.ts` y `actions/backup.ts` (textos de los errores del asistente; el código interno ya no sale del servidor y se registra en el log seguro) y un comentario de `security/security-headers.mjs`. `app/manifest.ts` sólo cambia el color de tema.

## 7.2 Auditoría visual integrada

635 comprobaciones sobre el build integrado (24 rutas públicas y privadas reales, Inicio con sus 6 estados y todos los estados de los Bloques 3–6) a 1440, 390 y 320 px:

| Control | Resultado |
|---|---|
| Desbordes horizontales | 0 |
| Un solo `<h1>` por pantalla | 635 / 635 (las pantallas de carga son esqueletos transitorios sin título, como desde el Bloque 1) |
| Objetivos de ≥ 44 px / nombres accesibles | 0 incumplimientos |
| Texto técnico visible (fecha ISO, UUID, `NaN`, `undefined`, `null`, tablas, constraints, slugs, «Código para soporte») | 0 |
| Formatos argentinos (dd/mm/aaaa, 24 h, miles con punto y coma decimal) | 0 incumplimientos |
| Azul heredado (`#0A64D2` / `#004BA8`) fuera del color de datos «Necesidades» | 0 |
| Promesas o funciones inexistentes (próximamente, premium, suscripción, Mobbex…) | 0 |
| Shell | Cinco destinos en escritorio y en la barra inferior móvil; entrada activa correcta en Inicio, Alumnos, Calendario, Registro y Cobros (Recordatorios, Resumen y Configuración no marcan ninguna por decisión del Bloque 1); salto al contenido en todas las páginas; `lang="es"` |
| Contraste AA | Todo texto visible llega a 4,5:1 (3:1 en texto grande) (la excepción de las tarjetas «Cancelada» se corrigió; ver «Limitaciones») |
| Teclado | Recorrido completo, foco de 2 px y diálogos con foco atrapado, Escape y foco devuelto en Cobros, Calendario (incluidos carriles de clases simultáneas), Reportes, Configuración y Respaldo, en los tres anchos |

## 7.3 Regresión funcional

Suite completa sobre copia LF: **1175 / 1175** (incluye autenticación y recuperación B0, cookies y redirecciones seguras, aislamiento entre propietarias, alumnos e idempotencia, calendario, series y división, registro de clases, cobros/pagos/saldos y generación de cargos, recordatorios, reportes y PDF, presupuesto 50/30/20, sesiones, respaldo/importación/reintento/deshacer, cuotas y límites, retención y purga, eliminación de cuenta y paginación). Además `typecheck`, `lint`, `build` de producción, las pruebas estructurales del sistema visual (`block2` a `block6`, `design-tokens`, `b8`–`b11`), `npm audit --omit=dev` (0 vulnerabilidades) y `git diff --check`. Como la diferencia no toca `supabase/`, las suites de base de datos no se vuelven a ejecutar ni se hicieron importaciones reales.

## Limitaciones conocidas

1. ~~Contraste de la línea secundaria de las tarjetas «Cancelada» del calendario: 4,4955:1~~ — **corregido** antes del cierre, con autorización de Joaquín: el texto secundario pasa de `#9A6200` a `#7A4B00` (6,5373:1 sobre `#FFF1B8`, cálculo sin redondear). Fondo, borde, significado y geometría no cambian; `lib/ui/__tests__/calendar-card-contrast.test.ts` impide volver por debajo de 4,5:1.
2. **Vista previa sin Supabase configurado:** `AuthNotConfigured` anida un segundo `<main>` dentro del shell. Sólo aparece en un entorno sin variables de Supabase (nunca en Production).
3. Las pantallas de carga (esqueletos) no tienen título.

## Rollback

Para volver al deployment anterior sin reconstruir nada, desde una carpeta vinculada al proyecto:

    npx vercel rollback dpl_E6gofhxGbXaY754gZtYqCxpwJmkM

(equivale a reasignar los alias al deployment `teacherflow-70yi0uc0e-teacherflow.vercel.app`). El código anterior es el commit `815ace5` de `teacherflow-web`; el nuevo es el último de `v1-web`. Si hiciera falta volver también la rama: `git push origin 815ace5:teacherflow-web --force-with-lease=teacherflow-web:<commit nuevo>` sólo con autorización expresa.
