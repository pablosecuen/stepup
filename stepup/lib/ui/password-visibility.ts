/** Lógica pura del botón «Mostrar/Ocultar contraseña» (sin DOM: se prueba sin navegador). */
export function passwordFieldType(visible: boolean): "text" | "password" {
  return visible ? "text" : "password";
}

/** Nombre accesible del botón: dice lo que HARÁ al pulsarlo. */
export function passwordToggleLabel(visible: boolean): "Mostrar contraseña" | "Ocultar contraseña" {
  return visible ? "Ocultar contraseña" : "Mostrar contraseña";
}
