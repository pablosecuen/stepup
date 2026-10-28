"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, PencilSquareIcon, UserIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { correctLiveClassStartAction, discardLiveClassAction, finishLiveClassAction } from "@/lib/actions/live-class";
import { guardNetwork } from "@/lib/actions/network-guard";
import { describeArrival, liveClassClock, type LiveClassSession } from "@/lib/live-class/live-class";
import { instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { useTickingNow } from "@/lib/ui/use-ticking-now";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { closeLiveClassNotification } from "@/components/dashboard/live-class-notifier";

/**
 * «Clase en curso» (puerto de `ActiveClassCard`): reemplaza a «Próxima clase» mientras hay una clase comenzada. Muestra los alumnos, la hora de comienzo, la cuenta regresiva de los minutos asignados
 * (pasa a «tiempo extra» si se excede, siempre con texto además del color), la puntualidad y las acciones. «Finalizar clase» cierra la sesión, guarda cuándo empezó y terminó de verdad y lleva al
 * registro, que ya viene con la duración real.
 */
export function ActiveClassCard({ session, nowIso }: { session: LiveClassSession; nowIso: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"correct" | "discard" | null>(null);
  // Hasta hidratar se usa la hora del servidor: el primer dibujo coincide con el HTML y después avanza cada segundo.
  const tick = useTickingNow();
  const now = new Date(tick ?? Date.parse(nowIso));
  const clock = liveClassClock(session, now);

  function run<T extends { error?: string }>(action: () => Promise<T>, onOk: (result: T) => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      const result = await action();
      inFlight.current = false;
      if (result.error) {
        setError(result.error);
        return;
      }
      onOk(result);
    });
  }

  function finish() {
    run(
      () => guardNetwork(() => finishLiveClassAction()),
      (result) => {
        if (!result.data) return;
        void closeLiveClassNotification();
        router.push(`/registro/${result.data.calendarLessonId}`);
      },
    );
  }

  return (
    <section aria-label="Clase en curso" data-enter="2" className="tf-enter rounded-xl bg-side px-5 py-4 text-white shadow-card nav:px-6">
      <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-sideText">
        <span aria-hidden className="h-2 w-2 rounded-pill bg-sideAccent" />
        Clase en curso
      </p>
      <p className="mt-1.5 font-display text-[21px] font-semibold leading-tight [overflow-wrap:anywhere]">{session.studentNames.join(", ")}</p>
      <p className="mt-1 text-[14px] text-sideText">
        Comenzada a las {instantTimeLabel(session.startedAt)}
        {session.startSource === "manual_correction" ? " (hora corregida)" : ""}
      </p>

      <p className="mt-3 font-display text-[40px] font-medium leading-none tracking-tight tf-num" aria-live="off">
        {clock.countdown}
      </p>
      <p className="mt-1 text-[14px] text-sideText">{clock.isOvertime ? "Tiempo extra" : `de ${session.scheduledDurationMinutes} min asignados`}</p>
      <div
        role="progressbar"
        aria-label="Avance de la clase"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clock.progress * 100)}
        aria-valuetext={clock.isOvertime ? "Clase en tiempo extra" : `${Math.round(clock.progress * 100)} % del tiempo asignado`}
        className="mt-3 h-2 overflow-hidden rounded-pill bg-white/20"
      >
        <div className={`h-full rounded-pill ${clock.isOvertime ? "bg-warnLine" : "bg-sideAccent"}`} style={{ width: `${Math.round(clock.progress * 100)}%` }} />
      </div>
      <p className="mt-3 text-[14px] text-sideText">{describeArrival(session.studentArrival)}</p>

      {!session.lessonStillScheduled && (
        <div className="mt-3">
          <Notice tone="warn">Esta clase ya no figura como agendada (se canceló o se movió mientras estaba en curso). Podés descartarla: no se registra nada.</Notice>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {session.lessonStillScheduled && (
          <Button variant="secondary" busy={pending} onClick={finish} aria-label="Finalizar clase" className="min-h-11">
            <CheckIcon className="h-4 w-4" aria-hidden />
            Finalizar clase
          </Button>
        )}
        {session.primaryStudentId && (
          <PrivateLink href={`/alumnos/${session.primaryStudentId}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-[14px] font-[650] text-white hover:underline">
            <UserIcon className="h-4 w-4" aria-hidden />
            Ver alumno
          </PrivateLink>
        )}
        {session.lessonStillScheduled && (
          <button type="button" onClick={() => setDialog("correct")} disabled={pending} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-[14px] font-[650] text-white hover:underline disabled:opacity-60">
            <PencilSquareIcon className="h-4 w-4" aria-hidden />
            Corregir hora de inicio
          </button>
        )}
        <button type="button" onClick={() => setDialog("discard")} disabled={pending} className="inline-flex min-h-11 items-center rounded-md px-3 text-[14px] text-sideText hover:underline disabled:opacity-60">
          Descartar clase en curso
        </button>
      </div>



      {dialog === "correct" && (
        <CorrectStartDialog
          session={session}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
      {dialog === "discard" && (
        <Dialog
          title="Descartar clase en curso"
          size="sm"
          placement="center"
          onClose={() => setDialog(null)}
          onBeforeClose={() => !pending}
          busy={pending}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setDialog(null)}>
                Volver
              </Button>
              <Button
                variant="danger"
                busy={pending}
                onClick={() =>
                  run(
                    () => guardNetwork(() => discardLiveClassAction()),
                    () => {
                      void closeLiveClassNotification();
                      setDialog(null);
                      router.refresh();
                    },
                  )
                }
              >
                Descartar
              </Button>
            </>
          }
        >
          <p className="text-[14.5px] text-textSecondary">No se registra nada: la clase queda como estaba y la podés comenzar o registrar de nuevo.</p>
          {error && <Notice tone="bad">{error}</Notice>}
        </Dialog>
      )}
    </section>
  );
}

function CorrectStartDialog({ session, onClose, onSaved }: { session: LiveClassSession; onClose: () => void; onSaved: () => void }) {
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [time, setTime] = useState(() => instantTimeLabel(session.startedAt));
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => correctLiveClassStartAction({ time }));
      inFlight.current = false;
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <Dialog
      title="Corregir hora de inicio"
      size="sm"
      placement="center"
      onClose={onClose}
      onBeforeClose={() => !pending}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" busy={pending} onClick={save}>
            Guardar hora
          </Button>
        </>
      }
    >
      <p className="text-[14.5px] text-textSecondary">Si te olvidaste de tocar «Comenzar clase» a tiempo, indicá a qué hora empezó de verdad. El horario de la clase no cambia.</p>
      {error && <Notice tone="bad">{error}</Notice>}
      <Field label="Hora de inicio" htmlFor={`${uid}-start`} hint="Hora de Argentina, de hoy.">
        <TextInput id={`${uid}-start`} type="time" value={time} onChange={(event) => setTime(event.target.value)} />
      </Field>
    </Dialog>
  );
}
