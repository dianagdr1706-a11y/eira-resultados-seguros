import Link from "next/link";
import { getStaff } from "@/lib/auth";
import { ROLES } from "@/lib/estados";
import { logoutStaff } from "./actions";
import { offsetDays } from "@/lib/clock";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const u = await getStaff();
  const off = offsetDays();
  return (
    <div className="space-y-4">
      {u && (
        <nav className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-4 py-2">
          <div className="flex flex-wrap gap-1 text-sm font-medium">
            <Link className="rounded px-3 py-1.5 hover:bg-rose-50" href="/staff">Panel</Link>
            {["laboratorio", "eira_admin"].includes(u.rol) && <Link className="rounded px-3 py-1.5 hover:bg-rose-50" href="/staff/cargar">Cargar PDF</Link>}
            {u.rol !== "laboratorio" && <Link className="rounded px-3 py-1.5 hover:bg-rose-50" href="/staff/pacientes">Pacientes</Link>}
            {u.rol !== "laboratorio" && <Link className="rounded px-3 py-1.5 hover:bg-rose-50" href="/staff/bandeja">Bandeja SMS/Correo</Link>}
            {["eira_admin", "auditoria"].includes(u.rol) && <Link className="rounded px-3 py-1.5 hover:bg-rose-50" href="/staff/bitacora">Bitácora</Link>}
          </div>
          <div className="flex items-center gap-3 text-sm">
            {off !== 0 && <span className="badge bg-amber-100 text-amber-800">Reloj demo +{off} días</span>}
            <span>
              <b>{u.nombre}</b> <span className="text-slate-500">· {ROLES[u.rol]}</span>
            </span>
            <form action={logoutStaff}><button className="btn-secondary py-1">Salir</button></form>
          </div>
        </nav>
      )}
      {children}
    </div>
  );
}
