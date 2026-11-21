import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db, type Paciente } from "@/lib/db";
import { kv } from "@/lib/kv";
import { PORTAL_URL } from "@/lib/notify";
import { fmtDate } from "@/lib/estados";
import PrintButton from "./PrintButton";

export default async function Talon({ params }: { params: { id: string } }) {
  const u = await requireStaff(["eira_admin"]);
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(params.id) as Paciente | undefined;
  if (!p) notFound();
  const store = await kv();
  const pin = await store.get(`pinview:${u.id}:${p.id}`);
  await store.del(`pinview:${u.id}:${p.id}`);
  const url = `${PORTAL_URL}?folio=${encodeURIComponent(p.id_eira)}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 180 });
  return (
    <div className="space-y-4">
      <div className="no-print flex items-center gap-3">
        <PrintButton />
        <span className="text-sm text-slate-600">El PIN se muestra una sola vez. Si recargas la página ya no aparece; se guarda solo su hash.</span>
      </div>
      <div className="mx-auto max-w-md rounded-xl border-2 border-dashed border-slate-400 bg-white p-6">
        <div className="flex items-center justify-between">
          <span className="text-2xl font-black tracking-widest text-rose-600">EIRA</span>
          <span className="text-xs text-slate-500">Comprobante de consulta</span>
        </div>
        <p className="mt-3 text-sm">Con este talón puedes consultar tu documento cuando esté listo. Te avisaremos o te llamaremos.</p>
        <div className="mt-4 flex gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR del portal" className="h-36 w-36" />
          <div className="space-y-2 text-sm">
            <div><div className="text-xs text-slate-500">Folio EIRA</div><div className="font-mono text-lg font-bold">{p.id_eira}</div></div>
            <div><div className="text-xs text-slate-500">PIN personal</div><div className="font-mono text-2xl font-black tracking-widest">{pin ?? "••••••"}</div></div>
            <div className="text-xs text-slate-500">Tu fecha de nacimiento: {fmtDate(p.fecha_nacimiento).replace(/\d{2}\/\d{2}/, "••/••")}</div>
          </div>
        </div>
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">
          <li>Escanea el QR o entra a <b>{PORTAL_URL.replace("https://", "")}</b></li>
          <li>Escribe tu folio, tu fecha de nacimiento y el PIN</li>
          <li>¿Sin internet? Llama al 341 410 8111 o acude a EIRA con este talón</li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">No compartas tu PIN. Vigencia: 60 días. Este talón no contiene información médica.</p>
      </div>
    </div>
  );
}
