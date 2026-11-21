import QRCode from "qrcode";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { clientIp, requireStaff } from "@/lib/auth";
import { db, type Paciente } from "@/lib/db";
import { emitirLlavero } from "@/core/reto4/llavero";
import Grabar from "./Grabar";

export const dynamic = "force-dynamic";

/** Emite un llavero nuevo para la paciente y muestra el enlace para grabarlo en la etiqueta NFC. */
export default async function LlaveroPaciente({ params }: { params: { id: string } }) {
  const u = await requireStaff(["eira_admin", "captura"]);
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(params.id) as Paciente | undefined;
  if (!p) notFound();
  const { ruta } = emitirLlavero({ usuario: u, ip: clientIp() }, p.id);
  const h = headers();
  const base = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const url = `${base}${ruta}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="h1">Llavero NFC de {p.id_eira}</h1>
      <div className="card space-y-3">
        <p>Este enlace es lo único que se graba en el llavero. No contiene nombre ni resultado, y se muestra una sola vez: si recargas se genera otro y el anterior deja de servir.</p>
        <p className="break-all rounded bg-slate-900 p-3 font-mono text-sm text-emerald-300">{url}</p>
        <Grabar url={url} />
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR del llavero" width={160} height={160} />
          <p className="text-sm text-slate-600">Respaldo: imprime este QR en el talón. Funciona igual que el llavero cuando el celular no tiene NFC.</p>
        </div>
      </div>
    </div>
  );
}
