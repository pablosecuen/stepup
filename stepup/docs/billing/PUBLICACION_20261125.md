# Publicación de la facturación de Rebill — preparación (25/11/2026)

**Estado:** PREPARADA, **no ejecutada**. El despliegue a Production sigue pendiente de una autorización explícita de Joaquín (la negativa anterior no se interpreta como concedida por ningún mensaje posterior). Mientras no se publique, Production corre el despliegue anterior (portada con «Para profesores e instituciones», recorrido y anclas, piloto de contratación, control de acceso inexistente).

## Qué se publicaría y qué NO cambia

- Base: la punta de `parity-codex`, que **ya contiene** todo lo anterior (portada, recorrido, anclas, etiqueta «Para profesores e instituciones» de `55ae502`, tarifa por hora, clases consecutivas). El commit `031c6b1` y los posteriores se apoyan sobre esa punta: no hay ninguna rama remota con trabajo que `parity-codex` no tenga, salvo `teacherflow-web` (una línea anterior, del 28/10, con 22 commits que `parity-codex` no tiene: no es la línea publicada y no se usa como base).
- Cambia: textos de Términos y de Condiciones de la suscripción (fuente única), soporte por el correo del titular, estado `defaulted`, búsqueda de pagos con `sort: updated_at`, guarda de escrituras y aviso de modo limitado (**apagados**), scripts y documentación.
- NO cambia: precios, portada, `BILLING_PILOT_OWNER_IDS` (el piloto se conserva), `BILLING_ENFORCEMENT_ENABLED` (sin definir = apagado), `BILLING_GRANDFATHER_CUTOFF` (sin definir), `BILLING_LEGAL_REVIEWED` (sin definir: el aviso de borrador sigue visible).
- Variable ya cargada y sin efecto mientras el control esté apagado: `BILLING_STATE_COOKIE_SECRET`.
- **Aviso de procedencia:** el despliegue vigente (`dpl_2usPmoD91zW76UEUzrhqiqvQG8nM`) se subió como salida ya compilada (contiene `src/label-*.tgz`), no desde un commit: su origen exacto no se puede probar commit a commit. Por eso la publicación se hace desde la punta de `parity-codex` (que contiene `55ae502`) y se **verifica la portada después** (etiqueta y recorrido).

## Antes de publicar (sólo lectura)

1. `git fetch origin` y comprobar que `origin/parity-codex` es el commit esperado y que contiene a `55ae502` y a `7ea8439` (`git merge-base --is-ancestor`).
2. `git diff 55ae502..<punta> --stat` debe mostrar sólo archivos de facturación, textos legales, pruebas y documentación (ninguno de `components/landing/*`, ni de precios).
3. Árbol limpio en el worktree de despliegue (`git status --short` vacío) y `.vercel` enlazado al proyecto `teacherflow-web`.
4. Variables de Production (sólo nombres): `BILLING_PILOT_OWNER_IDS` presente; `BILLING_ENFORCEMENT_ENABLED`, `BILLING_GRANDFATHER_CUTOFF` y `BILLING_LEGAL_REVIEWED` **ausentes**.
5. Suite completa, `tsc`, lint y build en verde sobre ese commit.

## Publicar (SOLO con la autorización explícita)

Desde el worktree limpio, en `stepup/`: `vercel deploy --prod --yes`.

## Después de publicar (sin pagar, sin tocar configuración)

- `/` : etiqueta «Para profesores e instituciones», recorrido de 5 vistas en un marco, `Cómo funciona` sin salto.
- `/planes`: los 4 botones siguen diciendo «Crear cuenta» (piloto activo); importes 25.900 / 69.900 / 131.400 / 238.800.
- `/terminos-y-condiciones`: el texto dice «La contratación online está en preparación» (porque el piloto sigue activo) y trae el titular y el correo de `public-profile.ts`.
- Con la cuenta QA: `/facturacion/condiciones` sin «[A DEFINIR]» y con el aviso «Texto en revisión»; `/facturacion/planes` igual que antes.
- Webhook sin firma → 401; cron sin secreto → 401; registros de `process` y `reconcile` sin errores; `scripts/rebill-verify.mjs` sin cambios (0 pagos).
- Inicio con la cuenta QA: sin aviso de modo limitado (el control está apagado) y escritura normal.

## Reversión

Re-desplegar el despliegue anterior (`vercel rollback` o promover `dpl_2usPmoD91zW76UEUzrhqiqvQG8nM`). La publicación no ejecuta migraciones ni cambia datos.

## Agregado el 25/11/2026 (después de preparar esta publicación)

- **Interfaz (efecto sólo con el control de acceso encendido):** el bloqueo muestra un mensaje breve con acceso a Facturación y el aviso del encabezado se actualiza solo al volver a la pestaña; **y, con o sin control de acceso**, tras un error devuelto por el servidor (validación, conflicto…) los formularios conservan lo escrito (antes se vaciaban los campos de texto: React 19 los resetea tras cualquier error devuelto). Cambio general en `lib/actions/network-guard.ts`; las claves nunca se reponen.
- **Migración `20261125130000_billing_write_gate.sql`: NO se aplica con la publicación** (Vercel no ejecuta migraciones; se aplicaría aparte, con aviso, y queda apagada). Detalle y activación: `COMPUERTA_EN_LA_BASE.md`.
