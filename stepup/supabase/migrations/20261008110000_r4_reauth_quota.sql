-- R4 — Límite por ventana para el intento de reautenticación (contraseña) de las acciones críticas de la web.
--
-- Eliminar la cuenta exige volver a escribir la contraseña. Ese intento pasa por Supabase Auth, así que lo limita Auth, pero el límite por IP
-- de Auth ve la IP del servidor de Vercel (hallazgo de R3), no la de la persona. Este tope por CUENTA (la base, no la memoria de Vercel)
-- evita que alguien con una sesión robada pruebe contraseñas sin fin a través de la web: se consume ANTES de verificar y cuenta aciertos
-- y fallos. 10 por hora: una profesora real eliminando su cuenta necesita 1-3 intentos.
--
-- ADITIVA: una fila de configuración. `consume_action_quota` (R3) ya lee la tabla; la web anterior no la usa. Sin ella la web nueva
-- fallaría cerrada (acción no reconocida), por eso esta migración va ANTES del despliegue.
insert into public.action_quota_defaults (action_key, max_per_window, window_seconds, rationale) values
  ('account_reauth', 10, 3600, 'Reautenticación con contraseña para acciones críticas (eliminar la cuenta): 1-3 intentos reales; el tope frena la prueba de contraseñas con una sesión robada.')
on conflict (action_key) do nothing;
