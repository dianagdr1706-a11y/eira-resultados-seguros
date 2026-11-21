import { requireStaff } from "@/lib/auth";
import { subirPdf } from "../actions";
import { PACIENTES_DEMO } from "@/lib/seed";

const ERR: Record<string, string> = { datos: "Falta el archivo o el folio de muestra.", pdf: "El archivo no es un PDF válido." };

export default async function Cargar({ searchParams }: { searchParams: { error?: string } }) {
  await requireStaff(["laboratorio", "eira_admin"]);
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <form action={subirPdf} className="card space-y-4 md:col-span-2">
        <h1 className="h1">Cargar resultado escaneado (PDF)</h1>
        <p className="text-sm text-slate-600">El archivo se guarda en almacenamiento privado (nunca en una URL pública) y se calcula su huella SHA-256. La asociación con la paciente la confirma EIRA en el siguiente paso.</p>
        {searchParams.error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{ERR[searchParams.error]}</p>}
        <div>
          <label className="label" htmlFor="pdf">Archivo PDF</label>
          <input className="input" id="pdf" name="pdf" type="file" accept="application/pdf" required />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="folio_muestra">Número citológico / folio</label>
            <input className="input" id="folio_muestra" name="folio_muestra" placeholder="CIT-2026-1002" required />
          </div>
          <div>
            <label className="label" htmlFor="fecha_toma">Fecha de toma</label>
            <input className="input" id="fecha_toma" name="fecha_toma" type="date" />
          </div>
          <div>
            <label className="label" htmlFor="sede_jornada">Sede / jornada</label>
            <input className="input" id="sede_jornada" name="sede_jornada" placeholder="Jornada Tuxpan" />
          </div>
        </div>
        <button className="btn-primary">Cargar PDF</button>
      </form>
      <div className="card">
        <h2 className="h2 mb-2">PDFs sintéticos para la demo</h2>
        <p className="mb-3 text-xs text-slate-500">Descarga uno y súbelo. Todos los datos son ficticios.</p>
        <ul className="space-y-2 text-sm">
          {PACIENTES_DEMO.map((p, i) => (
            <li key={p.id_eira}>
              <a className="text-rose-700 underline" href={`/api/staff/muestra?i=${i}&bethesda=${i === 2 ? "5" : "1"}`}>
                {p.nombre} ({p.fecha_nacimiento.slice(0, 4)}){i === 2 ? " · HSIL" : ""}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
