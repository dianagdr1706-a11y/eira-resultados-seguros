import { redirect } from "next/navigation";
import { getPaciente } from "@/lib/auth";
import { db, type Estudio } from "@/lib/db";
import { fmtDate } from "@/lib/estados";
import { salirPortal } from "../actions";
import Escuchar from "./Escuchar";
import EnviarBriar from "./EnviarBriar";

export default async function Resultados({ searchParams }: { searchParams: { error?: string } }) {
  const s = await getPaciente();
  if (!s) redirect("/portal?error=sesion");
  const p = s.paciente;
  const estudios = db().prepare(
    `SELECT * FROM estudios WHERE paciente_id = ? AND estado IN ('autorizado_digital','notificado','consultado','autorizado_acompanado','entregado_asistido') ORDER BY fecha_toma DESC`,
  ).all(p.id) as Estudio[];
  const nombreCorto = p.nombre.split(" ")[0];
  const texto = `Hola ${nombreCorto}. Aquí puedes ver los documentos que ya revisó un médico de EIRA. Presiona el botón Ver documento para abrirlo. Si tienes dudas llama al 3 4 1 4 1 0 8 1 1 1.`;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">Hola, {nombreCorto}</h1>
        <div className="flex gap-2">
          <Escuchar texto={texto} />
          <form action={salirPortal}><button className="btn-secondary">Salir</button></form>
        </div>
      </div>
      <p className="text-lg text-slate-600">Tu sesión se cierra sola después de 15 minutos sin uso.</p>
      {searchParams.error && <p className="rounded bg-red-50 p-3 text-red-700">Ese documento no está disponible.</p>}
      {estudios.length === 0 && <p className="card text-lg">Aún no tienes documentos disponibles. Te avisaremos cuando estén listos.</p>}
      {estudios.map((e) => (
        <div key={e.id} className="card space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Estudio de citología (Papanicolaou)</div>
              <div className="text-slate-600">Toma: {fmtDate(e.fecha_toma)} · {e.sede_jornada}</div>
            </div>
            {e.estado === "consultado" && <span className="badge bg-green-100 text-green-800">Ya consultado</span>}
          </div>
          {e.estado === "autorizado_acompanado" ? (
            <div className="rounded-lg bg-rose-50 p-4 text-lg">
              Tu documento está listo. <b>Queremos entregártelo en persona</b> y explicarte todo con calma.
              Te llamaremos para agendar o llama al <b>341 410 8111</b>.
            </div>
          ) : e.estado === "entregado_asistido" ? (
            <p className="text-lg">Este documento ya se te entregó en persona.</p>
          ) : (
            <>
              <p className="text-lg">Tu documento fue revisado por un médico de EIRA. Si algo no te queda claro, llámanos, con gusto te orientamos.</p>
              <form method="post" action="/api/portal/solicitar">
                <input type="hidden" name="estudio_id" value={e.id} />
                <button className="btn-primary w-full py-3 text-lg">Ver documento</button>
              </form>
              <EnviarBriar estudioId={e.id} />
              <p className="text-xs text-slate-500">El enlace dura 2 minutos y solo funciona con tu sesión; no se puede compartir.</p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
