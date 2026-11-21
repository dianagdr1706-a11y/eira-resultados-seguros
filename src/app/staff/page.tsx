import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { listarEstudios, alertas } from "@/lib/consultas";
import { ESTADOS, fmt } from "@/lib/estados";
import { getSetting } from "@/lib/db";
import { kv } from "@/lib/kv";
import { avanzarReloj, reiniciarDemo, toggleProveedor } from "./actions";

const ORDEN = ["cargado", "revision_admin", "pendiente_clinica", "devuelto", "notificado", "autorizado_acompanado", "consultado", "entregado_asistido"];

export default async function Panel({ searchParams }: { searchParams: { estado?: string; error?: string; ok?: string } }) {
  const u = await requireStaff();
  const todos = listarEstudios();
  const visibles = u.rol === "laboratorio" ? todos.filter((e) => e.estado === "cargado") : todos;
  const filtrados = searchParams.estado
    ? searchParams.estado === "asistida"
      ? visibles.filter((e) => e.requiere_asistida && !e.cerrado_en)
      : visibles.filter((e) => e.estado === searchParams.estado)
    : visibles;
  const al = u.rol === "laboratorio" ? [] : alertas(todos);
  const count = (s: string) => todos.filter((e) => e.estado === s).length;
  const asistidas = todos.filter((e) => e.requiere_asistida && !e.cerrado_en).length;
  const store = await kv();
  const caidoSms = getSetting("fallo_sms") === "1";
  const caidoCorreo = getSetting("fallo_correo") === "1";

  return (
    <div className="space-y-6">
      {searchParams.error === "permiso" && <p className="rounded bg-red-50 p-3 text-sm text-red-700">Tu rol no tiene permiso para esa acción.</p>}
      {searchParams.ok === "cargado" && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-700">PDF cargado. EIRA hará la asociación y la revisión.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="h1">Panel de estados</h1>
        <div className="flex gap-2">
          {["laboratorio", "eira_admin"].includes(u.rol) && <Link href="/staff/cargar" className="btn-primary">+ Cargar PDF</Link>}
          {u.rol !== "laboratorio" && <a href="/api/staff/export?format=csv" className="btn-secondary">Exportar CSV</a>}
          {u.rol !== "laboratorio" && <a href="/api/staff/export?format=json" className="btn-secondary">JSON</a>}
        </div>
      </div>

      {u.rol !== "laboratorio" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {ORDEN.map((s) => (
            <Link key={s} href={`/staff?estado=${s}`} className={`card p-3 hover:ring-2 hover:ring-rose-200 ${searchParams.estado === s ? "ring-2 ring-rose-400" : ""}`}>
              <div className="text-2xl font-bold">{count(s)}</div>
              <div className="text-xs text-slate-600">{ESTADOS[s].label}</div>
            </Link>
          ))}
          <Link href="/staff?estado=asistida" className="card border-rose-300 bg-rose-50 p-3">
            <div className="text-2xl font-bold text-rose-700">{asistidas}</div>
            <div className="text-xs text-rose-700">Pendientes de entrega asistida</div>
          </Link>
        </div>
      )}

      {al.length > 0 && (
        <div className="card border-amber-300 bg-amber-50">
          <h2 className="h2 mb-2">Alertas de seguimiento ({al.length})</h2>
          <ul className="space-y-1 text-sm">
            {al.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className={`badge ${a.tipo === "prioritario" ? "bg-red-600 text-white" : a.tipo === "asistida" ? "bg-rose-200 text-rose-900" : "bg-amber-200 text-amber-900"}`}>
                  {a.tipo === "prioritario" ? "PRIORITARIO" : a.tipo === "asistida" ? "ASISTIDA" : "SEGUIMIENTO"}
                </span>
                <Link className="font-semibold text-rose-700 underline" href={`/staff/estudios/${a.estudio.id}`}>{a.estudio.folio_muestra}</Link>
                <span>{a.estudio.paciente_nombre}: {a.texto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead>
            <tr><th>Folio muestra</th><th>Paciente</th><th>Municipio</th><th>Estado</th><th>Prioridad</th><th>Creado</th><th></th></tr>
          </thead>
          <tbody>
            {filtrados.map((e) => (
              <tr key={e.id}>
                <td className="font-mono">{e.folio_muestra}</td>
                <td>{e.paciente_nombre ?? <span className="text-slate-400">Sin asociar</span>}<div className="text-xs text-slate-500">{e.id_eira}</div></td>
                <td>{e.municipio ?? "—"}</td>
                <td>
                  <span className={`badge ${ESTADOS[e.estado]?.color}`}>{ESTADOS[e.estado]?.label ?? e.estado}</span>
                  {e.requiere_asistida === 1 && !e.cerrado_en && <span className="badge ml-1 bg-rose-200 text-rose-900">asistida</span>}
                </td>
                <td>{e.prioridad === "prioritario" ? <span className="badge bg-red-600 text-white">prioritario</span> : "rutinario"}</td>
                <td className="text-xs">{fmt(e.creado_en)}</td>
                <td>{u.rol !== "laboratorio" && <Link className="text-rose-700 underline" href={`/staff/estudios/${e.id}`}>Abrir</Link>}</td>
              </tr>
            ))}
            {filtrados.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">Sin estudios</td></tr>}
          </tbody>
        </table>
      </div>

      {["eira_admin", "auditoria"].includes(u.rol) && (
        <div className="card no-print space-y-3 border-dashed">
          <h2 className="h2">Controles de demo (simulación)</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>Proveedor SMS:</span>
            <form action={toggleProveedor}>
              <input type="hidden" name="canal" value="sms" /><input type="hidden" name="valor" value={caidoSms ? "0" : "1"} />
              <button className={caidoSms ? "btn-danger" : "btn-secondary"}>{caidoSms ? "CAÍDO: restablecer" : "Simular bloqueo (como WhatsApp)"}</button>
            </form>
            <span>Proveedor correo:</span>
            <form action={toggleProveedor}>
              <input type="hidden" name="canal" value="correo" /><input type="hidden" name="valor" value={caidoCorreo ? "0" : "1"} />
              <button className={caidoCorreo ? "btn-danger" : "btn-secondary"}>{caidoCorreo ? "CAÍDO: restablecer" : "Simular caída"}</button>
            </form>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Reloj de demo:</span>
            {[1, 3, 7].map((d) => (
              <form key={d} action={avanzarReloj}><input type="hidden" name="dias" value={d} /><button className="btn-secondary py-1">+{d} días</button></form>
            ))}
            <form action={avanzarReloj}><input type="hidden" name="dias" value={0} /><button className="btn-secondary py-1">Reiniciar reloj</button></form>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>Almacén de sesiones y OTP: <b>{store.backend === "valkey" ? "Valkey conectado" : "memoria local (sin Valkey)"}</b></span>
            <form action={reiniciarDemo}><button className="btn-secondary py-1">Reiniciar datos de demo</button></form>
          </div>
        </div>
      )}
    </div>
  );
}
