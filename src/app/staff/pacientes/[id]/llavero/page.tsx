import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db, type Paciente } from "@/lib/db";
import Emitir from "./Emitir";

export const dynamic = "force-dynamic";

/** Pantalla para emitir el llavero de la paciente y grabar su enlace en la etiqueta NFC. */
export default async function LlaveroPaciente({ params }: { params: { id: string } }) {
  await requireStaff(["eira_admin", "captura"]);
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(params.id) as Paciente | undefined;
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="h1">Llavero NFC de {p.id_eira}</h1>
      <div className="card space-y-3">
        <p>El enlace es lo único que se graba en el llavero. No contiene nombre ni resultado, y se muestra una sola vez: al emitir otro, el anterior deja de servir.</p>
        <Emitir pacienteId={p.id} base={process.env.APP_URL?.replace(/\/$/, "") || null} />
      </div>
    </div>
  );
}
