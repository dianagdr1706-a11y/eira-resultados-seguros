import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db, type Paciente } from "@/lib/db";
import { maskEmail, maskPhone } from "@/lib/ids";
import { fmtDate } from "@/lib/estados";
import { generarPin } from "../actions";

export default async function Pacientes() {
  const u = await requireStaff(["eira_admin", "medico", "auditoria"]);
  const rows = db().prepare("SELECT * FROM pacientes ORDER BY nombre, fecha_nacimiento").all() as Paciente[];
  return (
    <div className="space-y-4">
      <h1 className="h1">Pacientes (expediente mínimo)</h1>
      <p className="text-sm text-slate-600">Solo los datos necesarios para identificar y avisar. Los contactos se muestran enmascarados.</p>
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead><tr><th>ID EIRA</th><th>Nombre</th><th>Nacimiento</th><th>Municipio</th><th>Teléfono</th><th>Correo</th><th>Canal</th><th>Talón PIN</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="font-mono">{p.id_eira}</td>
                <td>{p.nombre}</td>
                <td>{fmtDate(p.fecha_nacimiento)}</td>
                <td>{p.municipio}</td>
                <td>{maskPhone(p.telefono)}</td>
                <td>{maskEmail(p.correo)}</td>
                <td>{p.canal_preferido === "asistido" ? <span className="badge bg-rose-200 text-rose-900">asistido</span> : p.canal_preferido}</td>
                <td>
                  {u.rol === "eira_admin" ? (
                    <div className="flex flex-wrap gap-1">
                    <Link className="btn-secondary py-1 text-xs" href={`/staff/pacientes/${p.id}/llavero`}>Llavero NFC</Link>
                    <form action={generarPin}>
                      <input type="hidden" name="paciente_id" value={p.id} />
                      <button className="btn-secondary py-1 text-xs">{p.pin_hash ? "Regenerar talón" : "Generar talón"}</button>
                    </form>
                    </div>
                  ) : p.pin_hash ? "Activo" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">El talón impreso se entrega el día de la toma. Permite consultar desde un equipo prestado o un módulo comunitario sin recibir códigos en teléfonos de terceros. <Link className="underline" href="/portal">Ir al portal</Link></p>
    </div>
  );
}
