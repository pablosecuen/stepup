"use client";

import { useState } from "react";
import PrivateLink from "@/components/nav/private-link";
import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const STEPS = [
  { title: "Creá tus clases", text: "Elegí una fecha, horario, modalidad y repetición. Después podés administrar la clase desde el calendario.", href: "/calendario/nueva", action: "Crear una clase" },
  { title: "Organizá tu semana", text: "Usá la vista semanal para organizarte y tocá un día para ver todos sus horarios.", href: "/calendario", action: "Abrir Calendario" },
  { title: "Tus alumnos", text: "Desde Alumnos podés consultar su historial, pagos y reportes, y editar sus datos.", href: "/alumnos", action: "Ver Alumnos" },
  { title: "Registrá lo importante", text: "Después de una clase podés guardar asistencia, contenido, tareas y observaciones. Los cobros se administran según el plan de cada alumno.", href: "/registro", action: "Abrir Registro" },
  { title: "Tus datos en tu cuenta", text: "La web guarda los cambios en tu cuenta cuando hay conexión. Esperá la confirmación de guardado antes de salir. Sin conexión no se confirma ningún cambio.", href: "/inicio", action: "Ir a Inicio" },
] as const;

/** Tutorial reabrible: no modifica datos de cuenta ni vuelve a activar el alta. */
export function Tutorial() {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  return <Card><p className="text-sm text-textMuted" aria-live="polite">Paso {index + 1} de {STEPS.length}</p><h2 className="mt-3 font-display text-[28px] font-semibold">{step.title}</h2><p className="mt-3 text-base text-textSecondary">{step.text}</p><PrivateLink href={step.href} className={`mt-4 ${buttonClass({ variant: "secondary" })}`}>{step.action}</PrivateLink><div className="mt-6 flex flex-wrap items-center justify-between gap-3"><Button variant="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Anterior</Button>{index < STEPS.length - 1 ? <Button onClick={() => setIndex(index + 1)}>Siguiente</Button> : <PrivateLink href="/inicio" className={buttonClass()}>Terminar</PrivateLink>}</div><PrivateLink href="/inicio" className={`mt-3 ${buttonClass({ variant: "ghost" })}`}>Salir del tutorial</PrivateLink></Card>;
}
