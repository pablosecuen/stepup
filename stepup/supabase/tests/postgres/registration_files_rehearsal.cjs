// Adjuntos (PDF / fotos) y biblioteca de materiales: escritura desde la web. Postgres REAL aislado, datos SINTÉTICOS, ninguna conexión a Production.
//
//   • «agregar adjunto»: sólo con el archivo realmente subido (objeto en el almacenamiento) bajo la carpeta de la cuenta, del tamaño declarado, de un tipo permitido y dentro de los topes (PDF 20 MB, foto 10 MB);
//   • idempotente: el mismo identificador nunca duplica; descripción editable; «quitar» sólo oculta (la fila y el archivo siguen);
//   • material nuevo de la biblioteca con o sin PDF; los materiales de la clase viajan con el contenido (guardar borrador, finalizar y editar con historial);
//   • aislamiento entre cuentas y rechazo de anónimos; los llamadores anteriores (sin `material_ids`) no cambian nada.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/registration_files_rehearsal.cjs
const assert = require("node:assert/strict");
const { start } = require("./load.cjs");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const S1 = "cccccccc-0000-4000-8000-000000000001";
const S2 = "cccccccc-0000-4000-8000-000000000002";
const R = "dddddddd-0000-4000-8000-000000000001";
const RB = "dddddddd-0000-4000-8000-000000000002";
const att = (n) => `1000000${n}-0000-4000-8000-00000000000${n}`;
const MB = 1024 * 1024;

const content = (extra = {}) => ({ topics: [], objectives: [], activities: ["Book page 72"], activity_notes: "notas", internal_notes: "", ...extra });

(async () => {
  const pg = await start({ port: 5459 });
  const clients = [];
  let checks = 0;
  const ok = (name) => { checks += 1; console.log(`OK ${name}`); };
  const check = (name, fn) => { fn(); checks += 1; console.log(`OK ${name}`); };
  const rejects = async (promise, re, name) => { await assert.rejects(promise, re, name); checks += 1; console.log(`OK ${name}`); };
  try {
    assert.deepEqual(pg.failures, [], "Todas las migraciones, incluida la nueva, deben aplicarse.");
    const { admin } = pg;
    const { attachmentStoragePath, materialStoragePath } = await import("../../../lib/lessons/attachments.ts");
    await admin.query("insert into auth.users (id,email) values ($1,'a@example.invalid'),($2,'b@example.invalid')", [A, B]);
    for (const [id, owner, name] of [[S1, A, "alumna uno"], [S2, A, "alumna dos"]]) await admin.query("insert into public.students (id,owner_id,name,status,category,modality,billing_type,date_joined) values ($1,$2,$3,'activo','otro','online','por_clase','2026-10-01')", [id, owner, name]);
    await admin.query("insert into public.students (id,owner_id,name,status,category,modality,billing_type,date_joined) values ('cccccccc-0000-4000-8000-0000000000b1',$1,'alumna ajena','activo','otro','online','por_clase','2026-10-01')", [B]);
    await admin.query("insert into public.lesson_registrations (id,owner_id,status,material_ids) values ($1,$2,'in_progress','{legacy_material_sin_biblioteca}'),($3,$4,'in_progress','{}')", [R, A, RB, B]);
    await admin.query("insert into public.lesson_registration_students (owner_id,lesson_registration_id,student_id,participant_status) values ($1,$2,$3,'pending')", [A, R, S1]);
    const a = await pg.session(A); const b = await pg.session(B); const anon = await pg.session(null, "anon");
    clients.push(a, b, anon);
    const rpc = (client, name, ...args) => client.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args.map((x) => (x !== null && typeof x === "object" ? JSON.stringify(x) : x)));
    const putObject = async (path, size, owner = A) => { await admin.query("delete from storage.objects where bucket_id = 'lesson-files' and name = $1", [path]); await admin.query("insert into storage.objects (bucket_id, name, owner, metadata) values ('lesson-files', $1, $2, $3::jsonb)", [path, owner, JSON.stringify({ size })]); };
    const attachmentsOf = async () => (await admin.query("select * from public.lesson_attachments where lesson_registration_id=$1 order by created_at", [R])).rows;
    const fp = async () => JSON.stringify((await admin.query("select count(*)::int n, md5(coalesce(string_agg((to_jsonb(x) - 'updated_at' - 'created_at')::text, '|' order by id), '')) h from public.lesson_registrations x where id <> $1", [R])).rows[0]);
    const unrelatedBefore = await fp();

    // ── Adjuntos ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const photoId = att(1);
    const photoPath = attachmentStoragePath(A, R, photoId, "image/heic");
    const photo = { id: photoId, name: "IMG_0001.heic", kind: "image", mime_type: "image/heic", size_bytes: 3 * MB, caption: "Pizarrón", storage_path: photoPath };
    await rejects(rpc(a, "add_lesson_attachment", R, photo), /todavía no se subió/, "sin el objeto subido no se registra el adjunto");
    await putObject(photoPath, 3 * MB);
    const added = (await rpc(a, "add_lesson_attachment", R, photo)).rows[0].r;
    check("con el objeto subido, el adjunto queda registrado y disponible", () => assert.equal(added.deduplicated, false));
    let rows = await attachmentsOf();
    check("la fila guarda nombre, tipo, tamaño, descripción, ruta y estado «disponible»", () => {
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].name, rows[0].kind, rows[0].mime_type, Number(rows[0].size_bytes), rows[0].caption, rows[0].storage_path, rows[0].file_status, rows[0].removed_at, rows[0].student_id], ["IMG_0001.heic", "image", "image/heic", 3 * MB, "Pizarrón", photoPath, "disponible", null, null]);
      assert.equal(rows[0].legacy_mobile_id, `web_${photoId}`);
    });
    const again = (await rpc(a, "add_lesson_attachment", R, photo)).rows[0].r;
    check("repetir el mismo adjunto no lo duplica (idempotente)", () => assert.equal(again.deduplicated, true));
    check("…y sigue habiendo una sola fila", () => assert.equal(rows.length, 1));

    const bad = async (patch, re, name, size = 1 * MB) => {
      const id = att(2);
      const path = patch.storage_path ?? attachmentStoragePath(A, R, id, patch.mime_type ?? "application/pdf");
      if (patch.__put !== false) await putObject(path, patch.__stored ?? size);
      const { __put, __stored, ...rest } = patch;
      await rejects(rpc(a, "add_lesson_attachment", R, { id, name: "x.pdf", kind: "pdf", mime_type: "application/pdf", size_bytes: size, storage_path: path, ...rest }), re, name);
    };
    await bad({ kind: "image", mime_type: "application/pdf" }, /Tipo de archivo|foto/i, "un PDF no puede registrarse como foto");
    await bad({ mime_type: "image/gif", kind: "image" }, /La foto debe ser/, "tipos de foto no permitidos (GIF) se rechazan");
    await bad({ kind: "image", mime_type: "image/jpeg" }, /supera los 10 MB/, "una foto de más de 10 MB se rechaza", 11 * MB);
    await bad({ kind: "pdf", mime_type: "application/pdf" }, /supera los 20 MB/, "un PDF de más de 20 MB se rechaza", 21 * MB);
    await bad({ __stored: 2 * MB }, /tamaño del archivo subido no coincide/, "el tamaño subido tiene que coincidir con el declarado");
    await bad({ storage_path: `${B}/web/${R}/${att(2)}.pdf`, __put: false }, /ruta del archivo no es válida/, "la ruta tiene que estar bajo la carpeta de la propia cuenta");
    await bad({ storage_path: `${A}/web/${R}/otra-cosa.pdf`, __put: false }, /ruta del archivo no es válida/, "la ruta tiene que corresponder a ESTE registro y a ESTE adjunto");
    await bad({ storage_path: `${A}/web/${R}/${att(2)}.pdf/../../x`, __put: false }, /ruta del archivo no es válida/, "una ruta con «..» se rechaza");
    await bad({ student_id: "cccccccc-0000-4000-8000-0000000000b1" }, /no forma parte de este registro/, "un alumno que no es del registro se rechaza");
    await bad({ name: "   " }, /nombre del archivo/, "el nombre no puede estar vacío");
    rows = await attachmentsOf();
    check("ninguno de los rechazos dejó filas", () => assert.equal(rows.length, 1));
    await rejects(rpc(b, "add_lesson_attachment", R, { ...photo, id: att(3), storage_path: attachmentStoragePath(B, R, att(3), "image/heic") }), /Registro no encontrado/, "otra cuenta no puede adjuntar a un registro ajeno");
    await rejects(rpc(anon, "add_lesson_attachment", R, photo), /permission denied/, "un anónimo no puede adjuntar");

    // alumno del registro: adjunto propio de un alumno
    const pdfId = att(4);
    const pdfPath = attachmentStoragePath(A, R, pdfId, "application/pdf");
    await putObject(pdfPath, 5 * MB);
    await rpc(a, "add_lesson_attachment", R, { id: pdfId, name: "ejercicios.pdf", kind: "pdf", mime_type: "application/pdf", size_bytes: 5 * MB, student_id: S1, storage_path: pdfPath });
    rows = await attachmentsOf();
    check("un PDF de 5 MB de un alumno del registro se registra con su alumno", () => { assert.equal(rows.length, 2); assert.equal(rows[1].student_id, S1); });

    // descripción
    const photoRow = rows[0];
    await rpc(a, "set_lesson_attachment_caption", photoRow.id, "  Nueva descripción  ");
    rows = await attachmentsOf();
    check("la descripción se edita (sin espacios sobrantes)", () => assert.equal(rows[0].caption, "Nueva descripción"));
    await rpc(a, "set_lesson_attachment_caption", photoRow.id, "   ");
    rows = await attachmentsOf();
    check("una descripción vacía queda sin descripción", () => assert.equal(rows[0].caption, null));
    await rejects(rpc(b, "set_lesson_attachment_caption", photoRow.id, "robo"), /Adjunto no encontrado/, "otra cuenta no puede editar la descripción");
    await rejects(rpc(a, "set_lesson_attachment_caption", photoRow.id, "x".repeat(501)), /demasiado larga/, "una descripción de más de 500 letras se rechaza");

    // quitar
    await rejects(rpc(b, "remove_lesson_attachment", photoRow.id), /Adjunto no encontrado/, "otra cuenta no puede quitar un adjunto ajeno");
    await rpc(a, "remove_lesson_attachment", photoRow.id);
    rows = await attachmentsOf();
    check("«quitar» sólo oculta: la fila y la ruta del archivo siguen, con removed_at", () => { assert.equal(rows.length, 2); assert.notEqual(rows[0].removed_at, null); assert.equal(rows[0].storage_path, photoPath); });
    ok("el objeto del almacenamiento sigue ahí (nada se borra)");
    assert.equal((await admin.query("select count(*)::int n from storage.objects where bucket_id='lesson-files' and name=$1", [photoPath])).rows[0].n, 1);
    await rpc(a, "remove_lesson_attachment", photoRow.id);
    ok("quitar dos veces no falla ni cambia la fecha");
    await rejects(rpc(a, "set_lesson_attachment_caption", photoRow.id, "ya quitado"), /Adjunto no encontrado/, "no se edita la descripción de un adjunto quitado");

    // ── Materiales ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const m1 = att(5), m2 = att(6);
    const m1Path = materialStoragePath(A, m1);
    const mat1 = (await rpc(a, "add_material_library_item", { id: m1, name: "Libro Unit 5", note: "página 72", attachment: null })).rows[0].r;
    check("material sin archivo: queda «sin archivo» y con id de la web", () => assert.equal(mat1.legacy_id, `web_${m1}`));
    let lib = (await admin.query("select * from public.material_library_items where owner_id=$1 order by created_at", [A])).rows;
    check("fila del material: nombre, nota y estado", () => assert.deepEqual([lib[0].name, lib[0].note, lib[0].file_status, lib[0].storage_path], ["Libro Unit 5", "página 72", "sin_archivo", null]));
    await rejects(rpc(a, "add_material_library_item", { id: m2, name: "Con PDF", attachment: { name: "unit.pdf", mime_type: "application/pdf", size_bytes: 2 * MB, storage_path: materialStoragePath(A, m2) } }), /todavía no se subió/, "un material con PDF exige el archivo subido");
    await putObject(materialStoragePath(A, m2), 2 * MB);
    const mat2 = (await rpc(a, "add_material_library_item", { id: m2, name: "Con PDF", note: null, attachment: { name: "unit.pdf", mime_type: "application/pdf", size_bytes: 2 * MB, storage_path: materialStoragePath(A, m2) } })).rows[0].r;
    lib = (await admin.query("select * from public.material_library_items where owner_id=$1 order by created_at", [A])).rows;
    check("material con PDF: disponible con su ruta", () => { assert.equal(lib[1].file_status, "disponible"); assert.equal(lib[1].storage_path, materialStoragePath(A, m2)); assert.equal(lib[1].attachment_kind, "pdf"); });
    check("repetir el mismo material no lo duplica", () => assert.equal(lib.length, 2));
    await rpc(a, "add_material_library_item", { id: m1, name: "Libro Unit 5", attachment: null });
    assert.equal((await admin.query("select count(*)::int n from public.material_library_items where owner_id=$1", [A])).rows[0].n, 2);
    await rejects(rpc(a, "add_material_library_item", { id: att(7), name: "   " }), /nombre al material/, "el material necesita un nombre");
    await rejects(rpc(a, "add_material_library_item", { id: att(7), name: "Foto", attachment: { name: "f.jpg", mime_type: "image/jpeg", size_bytes: MB, storage_path: materialStoragePath(A, att(7)) } }), /no es un PDF/, "un material sólo admite PDF");
    await rejects(rpc(anon, "add_material_library_item", { id: att(7), name: "x" }), /permission denied/, "un anónimo no puede agregar materiales");
    ok("la biblioteca de otra cuenta no ve estos materiales");
    assert.equal((await b.query("select count(*)::int n from public.material_library_items")).rows[0].n, 0);

    // materiales dentro del contenido de la clase
    const reg = async () => (await admin.query("select * from public.lesson_registrations where id=$1", [R])).rows[0];
    await rpc(a, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: content() });
    ok("sin `material_ids` el guardado NO toca los materiales (llamadores anteriores)");
    assert.deepEqual((await reg()).material_ids, ["legacy_material_sin_biblioteca"]);
    await rpc(a, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: content({ material_ids: ["legacy_material_sin_biblioteca", `web_${m1}`, `web_${m2}`] }) });
    ok("el borrador guarda los materiales elegidos (y conserva uno importado que todavía no está en la biblioteca)");
    assert.deepEqual([...(await reg()).material_ids].sort(), [`web_${m1}`, `web_${m2}`, "legacy_material_sin_biblioteca"].sort());
    await rejects(rpc(a, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: content({ material_ids: ["material_inventado"] }) }), /no está en tu biblioteca/, "un material que no es de la biblioteca ni de la clase se rechaza");
    assert.equal((await reg()).activity_notes, "notas");
    await rejects(rpc(a, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: content({ material_ids: [""] }) }), /Revisá los materiales/, "un material vacío se rechaza");
    const rbContent = { lesson_registration_id: RB, pedagogical_content: content({ material_ids: [`web_${m1}`] }) };
    await rejects(rpc(b, "save_lesson_content_draft", rbContent), /no está en tu biblioteca/, "otra cuenta no puede usar los materiales ajenos");
    await rpc(a, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: content({ material_ids: [`web_${m2}`] }) });
    assert.deepEqual((await reg()).material_ids, [`web_${m2}`]);
    ok("quitar un material de la clase lo saca sólo de esa clase (la biblioteca lo conserva)");
    assert.equal((await admin.query("select count(*)::int n from public.material_library_items where owner_id=$1", [A])).rows[0].n, 2);

    // finalizar y editar con historial
    await rpc(a, "save_participant_registration", { lesson_registration_id: R, student_id: S1, participant_status: "completed", attendance: { status: "presente", late_minutes: null }, evaluation: null, homework_reviews: [], pedagogical_content: content({ material_ids: [`web_${m1}`, `web_${m2}`] }) });
    await rpc(a, "finalize_lesson_registration", { lesson_registration_id: R, pedagogical_content: content({ material_ids: [`web_${m1}`, `web_${m2}`] }) });
    assert.deepEqual([...(await reg()).material_ids].sort(), [`web_${m1}`, `web_${m2}`].sort());
    const op = "eeeeeeee-0000-4000-8000-000000000001";
    await rpc(a, "edit_completed_lesson_registration", { lesson_registration_id: R, edit_operation_id: op, participants: [], pedagogical_content: content({ material_ids: [`web_${m1}`] }) });
    assert.deepEqual((await reg()).material_ids, [`web_${m1}`]);
    const history = (await admin.query("select previous_snapshot from public.lesson_registration_edit_history where lesson_registration_id=$1", [R])).rows;
    check("la edición de un registro finalizado cambia los materiales y el historial conserva los anteriores", () => { assert.equal(history.length, 1); assert.deepEqual([...history[0].previous_snapshot.registration.material_ids].sort(), [`web_${m1}`, `web_${m2}`].sort()); });
    await rpc(a, "edit_completed_lesson_registration", { lesson_registration_id: R, edit_operation_id: "eeeeeeee-0000-4000-8000-000000000002", participants: [], homework_description: "tarea" });
    ok("un llamador anterior (sin contenido) no borra los materiales");
    assert.deepEqual((await reg()).material_ids, [`web_${m1}`]);
    // adjuntar a un registro ya finalizado
    const lateId = att(8);
    const latePath = attachmentStoragePath(A, R, lateId, "image/jpeg");
    await putObject(latePath, 800 * 1024);
    await rpc(a, "add_lesson_attachment", R, { id: lateId, name: "pizarron.jpg", kind: "image", mime_type: "image/jpeg", size_bytes: 800 * 1024, storage_path: latePath });
    ok("también se puede adjuntar a un registro ya finalizado");
    assert.equal((await attachmentsOf()).length, 3);


    // clase grupal: cada participante puede tener sus propios archivos; el reporte de uno nunca ofrece los del otro
    const { attachmentBelongsToStudent } = await import("../../../lib/lessons/attachment-scope.ts");
    await rejects((async () => { const id = att(9); const path = attachmentStoragePath(A, R, id, "image/jpeg"); await putObject(path, MB); return rpc(a, "add_lesson_attachment", R, { id, name: "de-alumna-dos.jpg", kind: "image", mime_type: "image/jpeg", size_bytes: MB, student_id: S2, storage_path: path }); })(), /no forma parte de este registro/, "un archivo para un alumno que todavía no es participante del registro se rechaza");
    await admin.query("insert into public.lesson_registration_students (owner_id,lesson_registration_id,student_id,participant_status) values ($1,$2,$3,'pending')", [A, R, S2]);
    const groupAdd = async (n, name, studentId) => { const id = att(n); const path = attachmentStoragePath(A, R, id, "image/jpeg"); await putObject(path, MB); return (await rpc(a, "add_lesson_attachment", R, { id, name, kind: "image", mime_type: "image/jpeg", size_bytes: MB, student_id: studentId, storage_path: path })).rows[0].r; };
    await groupAdd(9, "de-alumna-dos.jpg", S2);
    await groupAdd(7, "comun-a-la-clase.jpg", null);
    const visibleTo = async (studentId) => (await admin.query("select name, student_id from public.lesson_attachments where lesson_registration_id=$1 and removed_at is null and file_status='disponible' order by name", [R])).rows.filter((row) => attachmentBelongsToStudent(row.student_id, studentId)).map((row) => row.name);
    { const all = await attachmentsOf(); check("el archivo de la alumna dos queda guardado con su alumna y el común sin alumno", () => { assert.equal(all.find((x) => x.name === "de-alumna-dos.jpg").student_id, S2); assert.equal(all.find((x) => x.name === "comun-a-la-clase.jpg").student_id, null); }); }
    const forS1 = await visibleTo(S1);
    const forS2 = await visibleTo(S2);
    check("el reporte de la alumna uno ofrece lo común y lo suyo, NUNCA lo de la alumna dos", () => { assert.ok(forS1.includes("comun-a-la-clase.jpg") && forS1.includes("ejercicios.pdf") && !forS1.includes("de-alumna-dos.jpg")); });
    check("el reporte de la alumna dos ofrece lo común y lo suyo, NUNCA lo de la alumna uno", () => { assert.ok(forS2.includes("comun-a-la-clase.jpg") && forS2.includes("de-alumna-dos.jpg") && !forS2.includes("ejercicios.pdf")); });
    const dosRow = (await attachmentsOf()).find((x) => x.name === "de-alumna-dos.jpg");
    await rpc(a, "remove_lesson_attachment", dosRow.id);
    { const all = await attachmentsOf(); check("quitar el archivo de un participante sólo oculta ese archivo (la fila sigue, los demás no cambian)", () => { assert.notEqual(all.find((x) => x.id === dosRow.id).removed_at, null); assert.equal(all.filter((x) => x.removed_at === null && (x.name === "comun-a-la-clase.jpg" || x.name === "ejercicios.pdf")).length, 2); }); }
    assert.deepEqual(await visibleTo(S2), ["comun-a-la-clase.jpg", "pizarron.jpg"]);
    ok("…y la alumna dos deja de verlo; lo común a la clase sigue");
    assert.ok((await visibleTo(S1)).includes("ejercicios.pdf") && (await visibleTo(S1)).includes("comun-a-la-clase.jpg"));
    ok("…y la alumna uno conserva sus archivos");

    assert.equal(await fp(), unrelatedBefore);
    ok("ningún otro registro de la base cambió");
    console.log(`\n${checks} comprobaciones correctas contra PostgreSQL aislado. Ninguna conexión a Production.`);
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    await pg.stop();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
