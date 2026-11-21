import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyChain, type BitacoraRow } from "@/lib/audit";
import { fmt } from "@/lib/estados";
import { intentarAlterar } from "./actions";

export default async function Bitacora({ searchParams }: { searchParams: { alterar?: string } }) {
  await requireStaff(["eira_admin", "auditoria"]);
  const v = verifyChain();
  const rows = db().prepare("SELECT * FROM bitacora ORDER BY id DESC LIMIT 300").all() as BitacoraRow[];
  return (
    <div className="space-y-4">
      <h1 className="h1">Bitácora inmutable</h1>
      <div className={`card flex flex-wrap items-center gap-4 ${v.ok ? "border-emerald-300 bg-emerald-50" : "border-red-400 bg-red-50"}`}>
        <div className="text-lg font-bold">{v.ok ? "Cadena de hashes íntegra" : `Cadena ROTA en el registro #${v.rotoEn}`}</div>
        <div className="text-sm">{v.total} registros verificados (SHA-256 encadenado; solo inserción, protegido por triggers)</div>
        <form action={intentarAlterar} className="ml-auto"><button className="btn-secondary">Intentar alterar un registro</button></form>
      </div>
      {searchParams.alterar && <p className="rounded bg-slate-900 p-3 font-mono text-sm text-emerald-300">Base de datos: {searchParams.alterar}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead><tr><th>#</th><th>Fecha</th><th>Actor</th><th>Acción</th><th>Estudio</th><th>Hash</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td className="whitespace-nowrap text-xs">{fmt(r.creado_en)}</td>
                <td className="text-xs">{r.actor_nombre ?? r.actor_tipo}</td>
                <td className="text-xs font-semibold">{r.accion}{r.detalle && <div className="break-all font-mono font-normal text-slate-500">{r.detalle}</div>}</td>
                <td className="text-xs">{r.estudio_id ? <Link className="underline" href={`/staff/estudios/${r.estudio_id}`}>{r.estudio_id}</Link> : "—"}</td>
                <td className="font-mono text-xs">{r.hash.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
