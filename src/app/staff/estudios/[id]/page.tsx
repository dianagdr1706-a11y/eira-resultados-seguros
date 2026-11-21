import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db, type Documento, type Estudio, type Paciente } from "@/lib/db";
import { bitacoraDe } from "@/lib/audit";
import { BETHESDA, bethesdaLabel, sugerir } from "@/lib/bethesda";
import { ESTADOS, MODALIDADES, fmt, fmtDate } from "@/lib/estados";
import { maskEmail, maskPhone } from "@/lib/ids";
import { asociarPaciente, autorizacionClinica, registrarEntrega, reintentarNotificacion, revisionAdmin } from "../../actions";
import BethesdaSelector from "./BethesdaSelector";

const ERR: Record<string, string> = {
  VERIFICACION_INCOMPLETA: "Selecciona una paciente y confirma los 4 puntos de verificación.",
  MOTIVO_REQUERIDO: "Escribe el motivo de la devolución.",
  BETHESDA_REQUERIDA: "Selecciona la categoría Bethesda.",
  ACUSE_REQUERIDO: "Para registrar la entrega confirma la identidad y escribe el folio de acuse o el nombre de quien firma.",
  ESTADO_INVALIDO: "El estudio ya cambió de estado. Revisa la línea de tiempo.",
  SIN_PERMISO: "Tu rol no puede hacer esta acción.",
  verificacion: "Selecciona una paciente y confirma los 4 puntos de verificación.",
  motivo: "Escribe el motivo de la devolución.",
  bethesda: "Selecciona la categoría Bethesda.",
  acuse: "Para registrar la entrega confirma la identidad y escribe el folio de acuse o el nombre de quien firma.",
};

function norm(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export default async function EstudioPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const u = await requireStaff(["eira_admin", "medico", "auditoria"]);
  const d = db();
  const e = d.prepare("SELECT * FROM estudios WHERE id = ?").get(params.id) as Estudio | undefined;
  if (!e) notFound();
  const doc = d.prepare("SELECT * FROM documentos WHERE estudio_id = ? AND vigente = 1 ORDER BY subido_en DESC").get(e.id) as Documento | undefined;
  const p = e.paciente_id ? (d.prepare("SELECT * FROM pacientes WHERE id = ?").get(e.paciente_id) as Paciente) : null;
  const log = bitacoraDe(e.id);
  const entregas = d.prepare("SELECT * FROM entregas WHERE estudio_id = ? ORDER BY id").all(e.id) as { modalidad: string; resultado: string; observaciones: string; acuse: string; creado_en: string }[];
  const revs = d.prepare("SELECT r.*, u.nombre AS revisor FROM revisiones r LEFT JOIN usuarios u ON u.id = r.revisor_id WHERE estudio_id = ? ORDER BY r.id").all(e.id) as { etapa: string; decision: string; comentarios: string; revisor: string; creado_en: string }[];
  const asociando = ["cargado", "devuelto"].includes(e.estado) && u.rol === "eira_admin";

  let candidatos: Paciente[] = [];
  const q = searchParams.q ?? "";
  const dob = searchParams.dob ?? "";
  const ide = searchParams.ide ?? "";
  if (asociando && (q || dob || ide)) {
    const all = d.prepare("SELECT * FROM pacientes").all() as Paciente[];
    candidatos = all.filter((x) =>
      (!q || norm(x.nombre).includes(norm(q))) && (!dob || x.fecha_nacimiento === dob) && (!ide || norm(x.id_eira).includes(norm(ide))),
    );
  }
  const homonimas = new Set(
    candidatos.filter((c) => candidatos.some((o) => o.id !== c.id && norm(o.nombre) === norm(c.nombre))).map((c) => c.id),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/staff" className="text-sm text-rose-700 underline">← Panel</Link>
        <h1 className="h1 font-mono">{e.folio_muestra}</h1>
        <span className={`badge ${ESTADOS[e.estado]?.color}`}>{ESTADOS[e.estado]?.label}</span>
        {e.prioridad === "prioritario" && <span className="badge bg-red-600 text-white">PRIORITARIO</span>}
        {e.requiere_asistida === 1 && !e.cerrado_en && <span className="badge bg-rose-200 text-rose-900">Requiere entrega asistida</span>}
      </div>
      {searchParams.error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{ERR[searchParams.error] ?? searchParams.error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-2">
          {doc ? (
            <>
              <iframe title="PDF escaneado" src={`/api/staff/pdf/${doc.id}`} className="h-[640px] w-full rounded border" />
              <p className="mt-2 break-all px-2 text-xs text-slate-500">SHA-256: <span className="font-mono">{doc.sha256}</span> · {doc.nombre_original} · {Math.round(doc.tamano / 1024)} KB</p>
            </>
          ) : <p className="p-4">Sin documento</p>}
        </div>

        <div className="space-y-4">
          {p && (
            <div className="card">
              <h2 className="h2 mb-2">Paciente asociada</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Nombre</dt><dd className="font-semibold">{p.nombre}</dd>
                <dt className="text-slate-500">ID EIRA</dt><dd className="font-mono">{p.id_eira}</dd>
                <dt className="text-slate-500">Nacimiento</dt><dd>{fmtDate(p.fecha_nacimiento)}</dd>
                <dt className="text-slate-500">Municipio</dt><dd>{p.municipio}</dd>
                <dt className="text-slate-500">Teléfono</dt><dd>{maskPhone(p.telefono)}</dd>
                <dt className="text-slate-500">Correo</dt><dd>{maskEmail(p.correo)}</dd>
                <dt className="text-slate-500">Canal preferido</dt><dd>{p.canal_preferido}</dd>
                <dt className="text-slate-500">Toma / sede</dt><dd>{fmtDate(e.fecha_toma)} · {e.sede_jornada ?? "—"}</dd>
                {e.bethesda && (<><dt className="text-slate-500">Bethesda</dt><dd>{bethesdaLabel(e.bethesda)}</dd></>)}
              </dl>
            </div>
          )}

          {asociando && (
            <div className="card space-y-3">
              <h2 className="h2">1. Asociar con comprobación de identidad</h2>
              <p className="text-sm text-slate-600">Busca por varios datos. Nunca se asocia en automático por nombre.</p>
              <form className="grid gap-2 sm:grid-cols-4">
                <input className="input sm:col-span-2" name="q" placeholder="Nombre" defaultValue={q} />
                <input className="input" name="dob" type="date" defaultValue={dob} title="Fecha de nacimiento" />
                <input className="input" name="ide" placeholder="ID EIRA" defaultValue={ide} />
                <button className="btn-secondary sm:col-span-4">Buscar</button>
              </form>
              {(q || dob || ide) && (
                <form action={asociarPaciente} className="space-y-3">
                  <input type="hidden" name="estudio_id" value={e.id} />
                  {homonimas.size > 0 && (
                    <p className="rounded bg-amber-100 p-2 text-sm font-semibold text-amber-900">
                      Hay {homonimas.size} pacientes con el mismo nombre. Compara la fecha de nacimiento, el ID EIRA y el municipio con el PDF.
                    </p>
                  )}
                  <div className="space-y-2">
                    {candidatos.map((c) => (
                      <label key={c.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${homonimas.has(c.id) ? "border-amber-400 bg-amber-50" : ""}`}>
                        <input type="radio" name="paciente_id" value={c.id} required />
                        <div>
                          <div className="font-semibold">{c.nombre}</div>
                          <div className="text-slate-600">
                            Nac.: <b className={homonimas.has(c.id) ? "bg-amber-200 px-1" : ""}>{fmtDate(c.fecha_nacimiento)}</b> · ID: <b className={homonimas.has(c.id) ? "bg-amber-200 px-1" : ""}>{c.id_eira}</b> · {c.municipio} · {c.sede_ultima}
                          </div>
                        </div>
                      </label>
                    ))}
                    {candidatos.length === 0 && <p className="text-sm text-slate-500">Sin coincidencias.</p>}
                  </div>
                  {candidatos.length > 0 && (
                    <fieldset className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
                      <legend className="font-semibold">Verificación obligatoria (contra el PDF)</legend>
                      <label className="flex gap-2"><input type="checkbox" name="chk_nombre" /> El nombre en el PDF coincide con el expediente</label>
                      <label className="flex gap-2"><input type="checkbox" name="chk_nacimiento" /> La fecha de nacimiento coincide</label>
                      <label className="flex gap-2"><input type="checkbox" name="chk_folio" /> El ID EIRA / número citológico coincide</label>
                      <label className="flex gap-2"><input type="checkbox" name="chk_legible" /> El documento es legible y está completo</label>
                    </fieldset>
                  )}
                  {candidatos.length > 0 && <button className="btn-primary w-full">Confirmar asociación</button>}
                </form>
              )}
            </div>
          )}

          {e.estado === "revision_admin" && u.rol === "eira_admin" && (
            <form action={revisionAdmin} className="card space-y-3">
              <h2 className="h2">2. Revisión administrativa</h2>
              <p className="text-sm text-slate-600">Confirma calidad del escaneo, páginas completas y la asociación correcta.</p>
              <input type="hidden" name="estudio_id" value={e.id} />
              <textarea className="input" name="comentarios" placeholder="Comentarios (obligatorio si se devuelve)" />
              <div className="flex gap-2">
                <button name="decision" value="aprobar" className="btn-primary flex-1">Aprobar y enviar a médico</button>
                <button name="decision" value="devolver" className="btn-danger">Devolver</button>
              </div>
            </form>
          )}

          {e.estado === "pendiente_clinica" && u.rol === "medico" && (
            <form action={autorizacionClinica} className="card space-y-3">
              <h2 className="h2">3. Autorización clínica</h2>
              <input type="hidden" name="estudio_id" value={e.id} />
              <BethesdaSelector opciones={BETHESDA.map((b) => ({ id: b.id, label: b.label, sug: sugerir(b.id) }))} />
              <textarea className="input" name="comentarios" placeholder="Nota clínica interna (no se envía a la paciente)" />
              <div className="grid gap-2 sm:grid-cols-3">
                <button name="decision" value="digital" className="btn bg-emerald-600 text-white hover:bg-emerald-700">Autorizar entrega digital</button>
                <button name="decision" value="acompanado" className="btn bg-rose-600 text-white hover:bg-rose-700">Autorizar entrega acompañada</button>
                <button name="decision" value="devolver" className="btn-danger">Devolver</button>
              </div>
            </form>
          )}

          {["revision_admin", "pendiente_clinica"].includes(e.estado) && u.rol !== (e.estado === "revision_admin" ? "eira_admin" : "medico") && (
            <p className="card text-sm text-slate-600">
              En espera de {e.estado === "revision_admin" ? "revisión administrativa (rol EIRA)" : "autorización clínica (rol Médico)"}.
            </p>
          )}

          {p && ["autorizado_digital", "autorizado_acompanado", "notificado"].includes(e.estado) && ["eira_admin", "medico"].includes(u.rol) && (
            <div className="card space-y-3">
              <h2 className="h2">4. Entrega asistida / seguimiento</h2>
              {u.rol === "eira_admin" && (
                <form action={reintentarNotificacion}>
                  <input type="hidden" name="estudio_id" value={e.id} />
                  <button className="btn-secondary">{e.estado === "notificado" ? "Enviar recordatorio neutro" : "Reintentar notificación"}</button>
                </form>
              )}
              <form action={registrarEntrega} className="space-y-2 text-sm">
                <input type="hidden" name="estudio_id" value={e.id} />
                <select name="modalidad" className="input" defaultValue={e.estado === "autorizado_acompanado" ? "orientacion_medica" : "presencial_eira"}>
                  {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {p.tercero_autorizado && <p className="text-xs">Persona autorizada en expediente: <b>{p.tercero_autorizado}</b></p>}
                <select name="resultado" className="input" defaultValue="entregado">
                  <option value="entregado">Entregado (cierra el caso)</option>
                  <option value="no_contesta">Intento: no contesta</option>
                  <option value="cita_agendada">Intento: cita agendada</option>
                  <option value="numero_incorrecto">Intento: número incorrecto o de terceros</option>
                </select>
                <label className="flex gap-2"><input type="checkbox" name="chk_identidad" /> Verifiqué identidad (INE / fecha de nacimiento / ID EIRA) sin dar información a terceros</label>
                <input className="input" name="acuse" placeholder="Folio de acuse o nombre de quien firma de recibido" />
                <textarea className="input" name="observaciones" placeholder="Observaciones" />
                <button className="btn-primary w-full">Registrar</button>
              </form>
            </div>
          )}

          {revs.length > 0 && (
            <div className="card text-sm">
              <h2 className="h2 mb-2">Revisiones</h2>
              <ul className="space-y-1">{revs.map((r, i) => <li key={i}><b>{r.etapa}</b>: {r.decision} · {r.revisor} · {fmt(r.creado_en)}{r.comentarios ? `: “${r.comentarios}”` : ""}</li>)}</ul>
            </div>
          )}
          {entregas.length > 0 && (
            <div className="card text-sm">
              <h2 className="h2 mb-2">Entregas e intentos</h2>
              <ul className="space-y-1">{entregas.map((x, i) => <li key={i}>{MODALIDADES[x.modalidad]}: <b>{x.resultado}</b> · acuse: {x.acuse || "—"} · {fmt(x.creado_en)}</li>)}</ul>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="h2 mb-3">Línea de tiempo auditable</h2>
        <ol className="relative space-y-3 border-l-2 border-rose-200 pl-5 text-sm">
          {log.map((l) => (
            <li key={l.id}>
              <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-rose-500" />
              <div className="font-semibold">{l.accion}</div>
              <div className="text-xs text-slate-500">{fmt(l.creado_en)} · {l.actor_nombre ?? l.actor_tipo} {l.ip ? `· IP ${l.ip}` : ""} · hash {l.hash.slice(0, 12)}…</div>
              {l.detalle && <div className="break-all font-mono text-xs text-slate-600">{l.detalle}</div>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
