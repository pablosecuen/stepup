"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { guardNetwork } from "@/lib/actions/network-guard";
import { domainErrorMessage } from "@/lib/errors/domain-error-message";
import { addMaterialAction, prepareAttachmentUploadAction, prepareMaterialUploadAction, registerAttachmentAction, removeAttachmentAction, setAttachmentCaptionAction } from "@/lib/actions/lesson-files";
import { checkPickedFile, cleanFileName, IMAGE_MAX_BYTES, IMAGE_PICK_MAX_BYTES, MAX_CAPTION_LENGTH, type AttachmentKind } from "@/lib/lessons/attachments";
import { SignedUploadError, uploadToSignedUrl } from "@/lib/lessons/signed-upload";
import { prepareImageForUpload } from "@/lib/images/client-prepare";
import { UnreadablePhotoError } from "@/lib/images/photo-validity";
import type { LessonContentAttachment, LibraryMaterial } from "@/lib/repositories/lesson-content-mapping";
import { availabilityLabel } from "@/lib/repositories/lesson-content-mapping";
import { LessonPhotoThumbnail } from "./lesson-photo-thumbnail";
import { LessonPhotoViewer } from "./lesson-photo-viewer";
import { OpenLessonFileButton } from "./open-lesson-file-button";

const LABEL = "text-sm font-semibold text-textSecondary";

function uploadErrorMessage(error: unknown): string {
  // Foto que no se puede leer (no es una foto, o un HEIC inválido): el texto ya está escrito para la persona.
  if (error instanceof UnreadablePhotoError) return error.message;
  if (error instanceof SignedUploadError) return error.status === 413 ? "El archivo es demasiado grande." : "No se pudo subir el archivo. Probá de nuevo.";
  // Una falla de red (el pedido no llegó a destino) se explica con el texto de red de siempre.
  if (error instanceof TypeError) return domainErrorMessage(error);
  return "No se pudo subir el archivo. Probá de nuevo.";
}

type Phase = { text: string } | null;

/**
 * Descripciones de fotos que se guardan al soltar el campo (`onBlur`). En iOS tocar un botón NO suelta el campo que está enfocado, así que un guardado del registro podía irse sin la
 * descripción recién escrita: cada fila se registra acá y los guardados del registro llaman `flushPendingCaptions()` (guarda ya lo que falta y espera a que termine).
 */
const captionFlushers = new Set<() => Promise<void>>();

export async function flushPendingCaptions(): Promise<void> {
  await Promise.all([...captionFlushers].map((flush) => flush()));
}

function AttachmentRow({ attachment, ownerLabel, onChange, onRemoved }: { attachment: LessonContentAttachment; ownerLabel: string | null; onChange: (a: LessonContentAttachment) => void; onRemoved: (id: string) => void }) {
  const id = useId();
  const [caption, setCaption] = useState(attachment.caption ?? "");
  const [savedCaption, setSavedCaption] = useState(attachment.caption ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El servidor no pudo leer esta foto (p. ej. una HEIC inválida subida antes): no se presenta como foto utilizable.
  const [unreadable, setUnreadable] = useState(false);

  const inflight = useRef<Promise<void> | null>(null);
  async function persistCaption() {
    if (caption.trim() === savedCaption.trim()) return;
    setError(null);
    const result = await guardNetwork(() => setAttachmentCaptionAction(attachment.id, caption));
    if (result.error) {
      setError(result.error);
      return;
    }
    setSavedCaption(caption.trim());
    onChange({ ...attachment, caption: caption.trim() || null });
  }
  // Un solo guardado a la vez: soltar el campo y guardar el registro casi juntos no envían la misma descripción dos veces.
  function saveCaption(): Promise<void> {
    if (inflight.current) return inflight.current;
    const promise = persistCaption().finally(() => {
      inflight.current = null;
    });
    inflight.current = promise;
    return promise;
  }
  const saveRef = useRef(saveCaption);
  useEffect(() => {
    saveRef.current = saveCaption;
  });
  useEffect(() => {
    const flush = () => saveRef.current();
    captionFlushers.add(flush);
    return () => {
      captionFlushers.delete(flush);
    };
  }, []);

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await guardNetwork(() => removeAttachmentAction(attachment.id));
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onRemoved(attachment.id);
  }

  return (
    <li className="min-w-0 space-y-2 rounded-md border-[1.5px] border-border bg-surface2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {attachment.kind === "image" && attachment.availability === "disponible" && <LessonPhotoThumbnail id={attachment.id} name={attachment.name} onUnreadable={() => setUnreadable(true)} />}
          <p className="min-w-0 text-[15px] font-medium [overflow-wrap:anywhere]">
            {attachment.name} <span className="text-[13px] font-normal text-textMuted">· {attachment.kind === "image" ? "Foto" : "PDF"}</span>
            {ownerLabel && <span className="block text-[13px] font-normal text-textMuted">Para: {ownerLabel}</span>}
            {attachment.availability !== "disponible" && <span className="block text-[13px] font-normal text-textMuted">{availabilityLabel(attachment.availability)}</span>}
            {unreadable && (
              <span role="alert" className="block text-[13px] font-semibold text-bad">
                Esta foto no se puede abrir ni usar en reportes. Quitala y subí otra; el original sigue guardado.
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {attachment.availability === "disponible" && !unreadable && (attachment.kind === "image" ? <LessonPhotoViewer id={attachment.id} name={attachment.name} /> : <OpenLessonFileButton kind="attachment" id={attachment.id} label={`Abrir el archivo ${attachment.name}`} />)}
          {unreadable && (
            <a href={`/api/archivos/adjunto/${encodeURIComponent(attachment.id)}?descargar=1`} download className={buttonClass({ variant: "secondary" })} aria-label={`Descargar el original de ${attachment.name}`}>
              Descargar el original
            </a>
          )}
          {!confirming && (
            <Button variant="ghost" onClick={() => setConfirming(true)} aria-label={`Quitar ${attachment.kind === "image" ? "la foto" : "el archivo"} ${attachment.name}`}>
              Quitar
            </Button>
          )}
        </div>
      </div>
      {confirming && (
        <div role="group" aria-label="Confirmar quitar" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-textSecondary">¿Quitarlo de la clase? El archivo queda guardado en tu cuenta.</span>
          <Button variant="danger" busy={busy} onClick={remove}>
            Sí, quitar
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            No
          </Button>
        </div>
      )}
      <Field label="Descripción (opcional)" htmlFor={`${id}-caption`}>
        <TextInput id={`${id}-caption`} value={caption} maxLength={MAX_CAPTION_LENGTH} onChange={(e) => setCaption(e.target.value)} onBlur={saveCaption} />
      </Field>
      {error && (
        <p role="alert" className="text-[13px] text-bad">
          {error}
        </p>
      )}
    </li>
  );
}

function MaterialsPicker({ library, selected, onSelectedChange, onAdded }: { library: LibraryMaterial[]; selected: string[]; onSelectedChange: (ids: string[]) => void; onAdded: (m: LibraryMaterial) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const known = new Set(library.map((m) => m.legacyId));
  const orphans = selected.filter((legacyId) => !known.has(legacyId));

  function toggle(legacyId: string) {
    onSelectedChange(selected.includes(legacyId) ? selected.filter((x) => x !== legacyId) : [...selected, legacyId]);
  }

  function pickFile(next: File | null) {
    setError(null);
    if (!next) return setFile(null);
    const check = checkPickedFile({ name: next.name, type: next.type, size: next.size }, "pdf");
    if (!check.ok) {
      setError(check.message);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setFile(next);
  }

  async function save() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("Ponele un nombre al material antes de guardarlo.");
    setBusy(true);
    try {
      const materialId = crypto.randomUUID();
      let attachment: { name: string; mimeType: string; size: number; path: string } | null = null;
      if (file) {
        const prepared = await guardNetwork(() => prepareMaterialUploadAction({ materialId, name: file.name, type: file.type, size: file.size }));
        if (prepared.error || !prepared.data) return setError(prepared.error ?? "No se pudo preparar la subida.");
        setProgress(0);
        await uploadToSignedUrl({ signedUrl: prepared.data.signedUrl, file, mimeType: prepared.data.mimeType, onProgress: setProgress });
        attachment = { name: cleanFileName(file.name), mimeType: prepared.data.mimeType, size: file.size, path: prepared.data.path };
      }
      const result = await guardNetwork(() => addMaterialAction({ materialId, name: trimmed, note: note.trim() || null, attachment }));
      if (result.error || !result.data) return setError(result.error ?? "No se pudo guardar el material.");
      onAdded({ id: result.data.id, legacyId: result.data.legacyId, name: trimmed, note: note.trim() || null, hasFile: attachment !== null, availability: attachment ? "disponible" : "sin_archivo" });
      onSelectedChange([...selected, result.data.legacyId]);
      setName("");
      setNote("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setOpen(false);
    } catch (e) {
      setError(uploadErrorMessage(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className={LABEL}>Materiales utilizados</legend>
      <p className="text-sm text-textMuted">Opcional. Se reutilizan en cualquier clase futura, de cualquier alumno.</p>
      {(library.length > 0 || orphans.length > 0) && (
        <ul className="flex flex-wrap gap-2">
          {library.map((material) => {
            const checked = selected.includes(material.legacyId);
            return (
              <li key={material.legacyId}>
                <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border-[1.5px] px-3.5 text-sm font-[650] ${checked ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary"}`}>
                  <input type="checkbox" className="h-4 w-4 accent-ink" checked={checked} onChange={() => toggle(material.legacyId)} />
                  <span className="[overflow-wrap:anywhere]">{material.name}</span>
                  {material.hasFile && <span className="text-[12px] font-normal opacity-80">· PDF</span>}
                </label>
              </li>
            );
          })}
          {orphans.map((legacyId) => (
            <li key={legacyId}>
              <label className="flex min-h-11 items-center gap-2 rounded-pill border-[1.5px] border-borderMid bg-surface px-3.5 text-sm text-textMuted">
                <input type="checkbox" className="h-4 w-4 accent-ink" checked onChange={() => toggle(legacyId)} />
                <span>Material sin identificar (todavía no se trasladó)</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)} aria-label="Agregar material nuevo a la biblioteca">
          + Agregar material nuevo
        </Button>
      ) : (
        <div className="space-y-3 rounded-md border-[1.5px] border-border bg-surface2 p-3">
          <Field label="Nombre del material" htmlFor={`${id}-name`}>
            <TextInput id={`${id}-name`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Nota (opcional)" htmlFor={`${id}-note`}>
            <TextArea id={`${id}-note`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="PDF (opcional)" htmlFor={`${id}-file`} hint="Hasta 20 MB.">
            <input id={`${id}-file`} ref={fileInput} type="file" accept="application/pdf,.pdf" className="text-sm" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </Field>
          {progress !== null && <p role="status" className="text-sm text-textSecondary">Subiendo el PDF… {Math.round(progress * 100)} %</p>}
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" busy={busy} onClick={save}>
              Guardar material
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}

/**
 * «Evidencias y materiales de la clase»: fotos y PDF adjuntos (con descripción, abrir y quitar) y la biblioteca de materiales. Es lo que la app anterior permitía al registrar o editar una clase.
 * Los archivos se guardan en cuanto se suben (no esperan al botón de guardar de la clase); «Quitar» sólo oculta el adjunto, nunca borra el archivo. Los materiales elegidos viajan con el contenido de la clase.
 */
export function LessonFilesEditor({
  registrationId,
  attachments: initialAttachments,
  library: initialLibrary,
  materialIds,
  onMaterialIdsChange,
  participants = [],
}: {
  registrationId: string;
  attachments: LessonContentAttachment[];
  library: LibraryMaterial[];
  materialIds: string[];
  onMaterialIdsChange: (ids: string[]) => void;
  /** Clase grupal: los participantes, para que cada archivo pueda pertenecer a uno (o a toda la clase). */
  participants?: { studentId: string; name: string }[];
}) {
  const targetId = useId();
  const [target, setTarget] = useState("");
  const [attachments, setAttachments] = useState(initialAttachments);
  const [library, setLibrary] = useState(initialLibrary);
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState<string | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  /** Sube UN archivo; devuelve `null` si quedó guardado o el motivo si no (varias fotos elegidas juntas se suben de a una: una que falla no descarta las demás). */
  async function upload(picked: File, expect: AttachmentKind, prefix = "", studentId: string | null = null): Promise<string | null> {
    const fail = (message: string) => `${prefix}${message}`;
    // Una foto que pasa del tope todavía puede reducirse a JPEG en el navegador: acá sólo se revisan el tipo y un tope de seguridad; el tamaño final se revisa después de preparar.
    if (expect === "image" && picked.size > IMAGE_PICK_MAX_BYTES) return fail(`La foto pesa demasiado (${Math.round(picked.size / (1024 * 1024))} MB). Elegí una más liviana.`);
    const first = checkPickedFile({ name: picked.name, type: picked.type, size: expect === "image" ? Math.min(picked.size, IMAGE_MAX_BYTES) : picked.size }, expect);
    if (!first.ok) return fail(first.message);
    const attachmentId = crypto.randomUUID();
    try {
      // Foto HEIC o demasiado pesada: se convierte a JPEG antes de subir cuando el navegador sabe (como la app anterior); si no, se sube la original.
      if (expect === "image") setPhase({ text: "Preparando la foto…" });
      const file = expect === "image" ? await prepareImageForUpload(picked) : picked;
      const check = checkPickedFile({ name: file.name, type: file.type, size: file.size }, expect);
      if (!check.ok) return fail(expect === "image" && file.size > IMAGE_MAX_BYTES ? `${check.message} No pudimos reducirla desde este navegador: probá con una foto más liviana.` : check.message);
      setPhase({ text: "Preparando la subida…" });
      const prepared = await guardNetwork(() => prepareAttachmentUploadAction({ registrationId, attachmentId, name: file.name, type: file.type, size: file.size }));
      if (prepared.error || !prepared.data) return fail(prepared.error ?? "No se pudo preparar la subida.");
      setPhase({ text: "Subiendo… 0 %" });
      await uploadToSignedUrl({ signedUrl: prepared.data.signedUrl, file, mimeType: prepared.data.mimeType, onProgress: (f) => setPhase({ text: `Subiendo… ${Math.round(f * 100)} %` }) });
      setPhase({ text: "Guardando…" });
      const registered = await guardNetwork(() => registerAttachmentAction({ registrationId, attachmentId, name: file.name, kind: prepared.data!.kind, mimeType: prepared.data!.mimeType, size: file.size, path: prepared.data!.path, caption: null, studentId }));
      if (registered.error || !registered.data) return fail(registered.error ?? "No se pudo guardar el archivo.");
      setAttachments((current) => [...current, { id: registered.data!.id, name: cleanFileName(file.name), kind: prepared.data!.kind, caption: null, studentId, availability: "disponible" }]);
      return null;
    } catch (e) {
      return fail(uploadErrorMessage(e));
    } finally {
      setPhase(null);
    }
  }

  // Se elige el archivo y el campo se vacía enseguida: así se puede volver a elegir el mismo archivo. La galería admite varias fotos a la vez: se suben una tras otra y las que fallan se avisan
  // por nombre, sin descartar las demás.
  async function picked(event: React.ChangeEvent<HTMLInputElement>, expect: AttachmentKind) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const studentId = target === "" ? null : target;
    const failures: string[] = [];
    setError(null);
    for (const file of files) {
      const failure = await upload(file, expect, files.length > 1 ? `${cleanFileName(file.name)}: ` : "", studentId);
      if (failure) failures.push(failure);
    }
    if (failures.length > 0) setError(files.length > 1 ? `${files.length - failures.length} de ${files.length} se guardaron. ${failures.join(" ")}` : failures[0]);
  }

  const busy = phase !== null;
  return (
    <div className="space-y-5">
      <fieldset className="min-w-0 space-y-2">
        <legend className={LABEL}>Evidencias y materiales de la clase</legend>
        {attachments.length > 0 && (
          <ul className="space-y-2">
            {attachments.map((attachment) => (
              <AttachmentRow key={attachment.id} attachment={attachment} ownerLabel={participants.length > 1 ? (attachment.studentId ? `Sólo ${participants.find((p) => p.studentId === attachment.studentId)?.name ?? "un participante"}` : "Toda la clase") : null} onChange={(next) => setAttachments((current) => current.map((a) => (a.id === next.id ? next : a)))} onRemoved={(id) => setAttachments((current) => current.filter((a) => a.id !== id))} />
            ))}
          </ul>
        )}
        {participants.length > 1 && (
          <Field label="Los archivos que agregues son para" htmlFor={targetId} hint="Una foto de un alumno sólo puede salir en el reporte de ese alumno. «Toda la clase» sale en el de todos.">
            <SelectInput id={targetId} value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Toda la clase</option>
              {participants.map((p) => (
                <option key={p.studentId} value={p.studentId}>
                  Sólo {p.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => pdfInput.current?.click()} aria-label="Adjuntar PDF">
            Adjuntar PDF
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => photoInput.current?.click()} aria-label="Elegir foto">
            Elegir foto
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => cameraInput.current?.click()} aria-label="Tomar foto">
            Tomar foto
          </Button>
        </div>
        <input ref={pdfInput} aria-label="Archivo PDF a adjuntar" type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void picked(event, "pdf")} />
        <input ref={photoInput} aria-label="Foto a adjuntar" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void picked(event, "image")} />
        <input ref={cameraInput} aria-label="Foto tomada con la cámara" type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void picked(event, "image")} />
        <p className="text-[13px] text-textMuted">PDF hasta 20 MB; fotos hasta 10 MB (JPG, PNG, WebP o HEIC).</p>
        {phase && (
          <p role="status" className="text-sm text-textSecondary">
            {phase.text}
          </p>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
      </fieldset>
      <MaterialsPicker library={library} selected={materialIds} onSelectedChange={onMaterialIdsChange} onAdded={(m) => setLibrary((current) => [...current, m])} />
    </div>
  );
}
