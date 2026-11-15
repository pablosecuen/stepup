// La lista de Alumnos no tiene menú de tres puntos: la tarjeta móvil y la fila de escritorio son el acceso directo a la ficha, donde viven todas las acciones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

test("la lista de Alumnos ya no ofrece el menú de tres puntos ni reserva su espacio", () => {
  assert.ok(!existsSync(join(root, "components/students/row-actions-menu.tsx")), "el componente del menú ya no existe");
  assert.ok(!existsSync(join(root, "lib/students/row-actions.ts")), "ni su lista de acciones");
  const card = read("components/students/student-card.tsx");
  for (const gone of ["StudentRowActionsMenu", "row-actions-menu", "EllipsisVertical", "Acciones de", "w-14 text-right", "pr-1 pt-1.5"]) assert.ok(!card.includes(gone), `no queda «${gone}»`);
  assert.ok(!card.includes('<span className="sr-only">Acciones</span>'), "la tabla no tiene columna de acciones");
});

test("el acceso al alumno y la transición del nombre se conservan en la tarjeta y en la fila", () => {
  const card = read("components/students/student-card.tsx");
  assert.equal((card.match(/href=\{`\/alumnos\/\$\{student\.id\}`\}/g) ?? []).length, 2, "tarjeta móvil y fila de escritorio abren la ficha");
  assert.equal((card.match(/data-tf-shared-name data-tf-shared-id=\{student\.id\}/g) ?? []).length, 2);
  assert.equal((card.match(/viewTransitionName: `tf-student-\$\{student\.id\}`/g) ?? []).length, 2);
  assert.ok(card.includes("Abrir perfil de ${student.name}"), "un solo enlace accesible por fila");
});

test("las acciones que tenía el menú siguen disponibles dentro de la ficha", () => {
  const resumen = read("components/students/profile/resumen-tab.tsx");
  assert.ok(resumen.includes("/registro/nuevo?alumno="), "registrar clase");
  assert.ok(resumen.includes("/editar"), "editar alumno");
  assert.ok(resumen.includes("reprogramarAlumno"), "reprogramar la próxima clase");
  assert.ok(read("components/students/profile/student-profile-view.tsx").includes('id="cambiar-estado"'), "cambiar estado");
  assert.ok(read("components/students/profile/profile-header.tsx").includes("/editar"));
});
