import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { esNeutro, proveedorCaido } from "@/lib/notify";
import { fmt } from "@/lib/estados";

type N = { id: number; canal: string; destino_enmascarado: string; asunto: string | null; mensaje: string; estado: string; tipo: string; creado_en: string; id_eira: string | null };

export default async function Bandeja() {
  await requireStaff(["eira_admin", "medico", "auditoria"]);
  const rows = db().prepare(
    "SELECT n.*, p.id_eira FROM notificaciones n LEFT JOIN pacientes p ON p.id = n.paciente_id ORDER BY n.id DESC LIMIT 100",
  ).all() as N[];
  return (
    <div className="space-y-4">
      <h1 className="h1">Bandeja simulada de SMS y correo</h1>
      <p className="text-sm text-slate-600">
        En producción, estos mensajes salen por un proveedor transaccional (AWS SNS/SES, Twilio, etc.) detrás de un adaptador intercambiable. Cada aviso se valida para que no contenga términos clínicos.
        Estado de proveedores: SMS <b>{proveedorCaido("sms") ? "CAÍDO" : "OK"}</b> · Correo <b>{proveedorCaido("correo") ? "CAÍDO" : "OK"}</b>
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((n) => (
          <div key={n.id} className={`card ${n.estado === "fallido" ? "border-red-300 bg-red-50" : ""}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="badge bg-slate-800 text-white">{n.canal.toUpperCase()}</span>
              <span className={`badge ${n.estado === "fallido" ? "bg-red-600 text-white" : "bg-emerald-100 text-emerald-800"}`}>{n.estado === "fallido" ? "FALLÓ: se usó el siguiente canal" : "enviado (simulado)"}</span>
              <span className="badge bg-slate-100">{n.tipo}</span>
              {n.tipo !== "otp" && esNeutro(`${n.asunto ?? ""} ${n.mensaje}`) && <span className="badge bg-sky-100 text-sky-800">Sin términos clínicos</span>}
              <span className="ml-auto text-slate-500">{fmt(n.creado_en)}</span>
            </div>
            <div className="text-xs text-slate-500">Para: {n.destino_enmascarado} · {n.id_eira}</div>
            {n.asunto && <div className="mt-1 font-semibold">{n.asunto}</div>}
            <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{n.mensaje}</pre>
            {n.canal === "sms" && <div className="mt-1 text-xs text-slate-400">{n.mensaje.length} caracteres</div>}
          </div>
        ))}
        {rows.length === 0 && <p className="text-slate-500">Aún no hay mensajes.</p>}
      </div>
    </div>
  );
}
