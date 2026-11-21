import QRCode from "qrcode";
import Link from "next/link";
import { headers } from "next/headers";
import { requireStaff } from "@/lib/auth";
import { fmt } from "@/lib/estados";
import { APPS_MALLA, listarAvisosMalla, rutasMalla } from "@/core/reto4/malla";
import { acuseMalla, entregaMalla } from "../actions";
import Copiar from "./Copiar";

const APP: Record<string, string> = { briar: "Briar", bridgefy: "Bridgefy", nearby: "Nearby / Multipeer" };
const ERR: Record<string, string> = { DATOS_INCOMPLETOS: "Escribe el nombre de quien llevó el aviso.", YA_ENTREGADO: "Ese aviso ya tenía una entrega registrada.", SIN_CLAVES: "No encontré ninguna clave. La respuesta debe decir RECIBIDO y la clave de 8 caracteres." };

export default async function Malla({ searchParams }: { searchParams: { error?: string; ok?: string; acuse?: string } }) {
  const u = await requireStaff(["eira_admin"]);
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  // Sin PORTAL_URL configurada y con un host público, el aviso apunta al portal del mismo sitio para que el enlace abra de verdad.
  const local = !host || /^(localhost|127(\.\d+){3}|\[::1\])(:\d+)?$/.test(host);
  const portal = process.env.PORTAL_URL || local ? undefined : `${h.get("x-forwarded-proto") ?? "https"}://${host}/portal`;
  const avisos = listarAvisosMalla({ usuario: u }, portal);
  const rutas = rutasMalla({ usuario: u }, portal);
  const qrs = await Promise.all(avisos.map((a) => QRCode.toDataURL(a.mensaje, { margin: 1, width: 150 })));
  return (
    <div className="space-y-4">
      <h1 className="h1">Malla sin internet</h1>
      <p className="text-sm text-slate-600">
        Avisos que el ciclo de contacto mandó a la malla porque la paciente no consultó por Telegram, SMS ni correo. Una voluntaria los lleva a la comunidad con
        <b> Briar</b> o <b>Bridgefy</b> (Bluetooth o Wi-Fi local, sin internet) y aquí se registra la entrega. Por la malla viaja solo este aviso neutro:
        nunca el PDF, el nombre ni el diagnóstico.
      </p>
      {searchParams.error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{ERR[searchParams.error] ?? "No se pudo registrar la entrega."}</p>}
      {searchParams.ok && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-800">Entrega registrada en la bitácora.</p>}
      {searchParams.acuse && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-800">Acuse procesado: {searchParams.acuse}</p>}

      <div className="card space-y-3 text-sm">
        <h2 className="h2">Ruta por Briar: ida y regreso</h2>
        <p className="text-slate-600">
          <b>Ida:</b> un solo mensaje por comunidad con todos sus avisos pendientes, para mandarlo por Briar a la promotora.
          <b> Regreso:</b> ella contesta en Briar <code>RECIBIDO</code> y la clave; al volver se pega su respuesta aquí y solo esos avisos quedan como entregados.
        </p>
        {rutas.map((r) => (
          <div key={r.punto} className="space-y-2 rounded border p-3">
            <div className="font-semibold">{r.punto} · {r.avisos.length} pendiente{r.avisos.length === 1 ? "" : "s"}</div>
            <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans">{r.mensaje}</pre>
            <Copiar texto={r.mensaje} etiqueta="Copiar ruta para Briar" />
          </div>
        ))}
        {rutas.length === 0 && <p className="text-slate-500">No hay avisos pendientes de entregar por malla.</p>}
        <form action={acuseMalla} className="space-y-2 border-t pt-3">
          <label className="block text-xs">Respuesta de la promotora (pégala tal cual desde Briar)
            <textarea name="texto" required rows={3} className="input mt-1 w-full" placeholder="RECIBIDO 4CAAF237" />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grow text-xs">Quién trajo el acuse
              <input name="portador" required minLength={3} className="input mt-1 w-full" placeholder="Nombre de la voluntaria" />
            </label>
            <button className="btn-primary py-1.5">Registrar acuse de Briar</button>
          </div>
        </form>
      </div>

      <h2 className="h2">Avisos individuales (QR)</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {avisos.map((a, i) => (
          <div key={a.intento_id} className="card space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="badge bg-slate-800 text-white">MALLA</span>
              <span className="badge bg-sky-100 text-sky-800">Sin términos clínicos</span>
              {a.consultado && <span className="badge bg-emerald-100 text-emerald-800">La paciente ya consultó</span>}
              <span className="ml-auto text-slate-500">{fmt(a.creado_en)}</span>
            </div>
            <div><b>{a.punto}</b> · <Link className="text-rose-700 underline" href={`/staff/estudios/${a.estudio_id}`}>{a.folio}</Link> · {a.id_eira} · Ref {a.ref}</div>
            <div className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrs[i]} alt="QR del aviso neutro" width={150} height={150} className="shrink-0 rounded border" />
              <div className="space-y-2">
                <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans">{a.mensaje}</pre>
                <Copiar texto={a.mensaje} />
                <p className="text-xs text-slate-500">El QR contiene solo este texto: se lee con la cámara aunque el celular esté en modo avión. El enlace abre el portal cuando hay internet.</p>
              </div>
            </div>
            {a.entrega ? (
              <p className="rounded bg-emerald-50 p-2 text-emerald-800">Entregado por <b>{a.entrega.portador}</b> con {APP[a.entrega.app]} · {fmt(a.entrega.en)}</p>
            ) : (
              <form action={entregaMalla} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intento_id" value={a.intento_id} />
                <label className="grow text-xs">Quién lo llevó
                  <input name="portador" required minLength={3} className="input mt-1 w-full" placeholder="Nombre de la voluntaria" />
                </label>
                <label className="text-xs">App
                  <select name="app" className="input mt-1">{APPS_MALLA.map((x) => <option key={x} value={x}>{APP[x]}</option>)}</select>
                </label>
                <button className="btn-primary py-1.5">Entregado por mula</button>
              </form>
            )}
          </div>
        ))}
        {avisos.length === 0 && <p className="text-slate-500">Aún no hay avisos en la malla. Aparecen cuando el ciclo de contacto llega a ese medio.</p>}
      </div>
    </div>
  );
}
