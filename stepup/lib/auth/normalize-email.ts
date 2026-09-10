// Mismo criterio EXACTO que móvil (`utils/normalizeEmail.ts`): aplicar
// siempre antes de cualquier llamada de auth. Documentado ahí como fix real
// de un bug (un correo con mayúsculas distintas rompía el login) — nunca
// tocar la contraseña de la misma forma.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
