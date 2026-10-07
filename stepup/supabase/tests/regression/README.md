# Regresión previa al rediseño (contra Production, con cuentas SINTÉTICAS)

Corre el código REAL de los repositorios de la web (`lib/repositories/*`, supabase-js) contra el proyecto de Supabase vinculado, con usuarios `@example.invalid` que
crea y BORRA al terminar (`finally`). **Nunca usa la cuenta real de la profesora.** Necesita la clave de servicio (sólo para crear/borrar las cuentas sintéticas y leer
filas de verificación): se baja a un archivo temporal con `supabase projects api-keys -o json` (nombres `anon` y `service_role`), se pasa en `KEYS_FILE` y se borra después.

    # desde la carpeta stepup (con supabase/.temp enlazado)
    set WEB_ROOT=%CD%
    set KEYS_FILE=<archivo temporal con {"anon": "...", "service_role": "..."}>
    set OUT_FILE=<resultado.json>
    node --import file:///<ruta>/supabase/tests/regression/loader.mjs supabase/tests/regression/pre_redesign_regression.mjs   (auth, alumnos, calendario, importación R6.1, limpieza)
    node --import file:///<ruta>/supabase/tests/regression/loader.mjs supabase/tests/regression/pre_redesign_pages.mjs        (páginas con una sesión por cookies, carrera de dos pestañas, cabeceras)

`loader.mjs`/`hooks.mjs` resuelven el alias `@/` y `server-only` para poder importar TypeScript de la web fuera de Next.js. Antes y después conviene comparar huellas de las
48 tablas (conteo + md5 por tabla) con una consulta de sólo lectura. No se envían correos: el alta y la recuperación usan enlaces generados por la API de administración.
