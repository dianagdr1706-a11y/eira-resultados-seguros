"use client";

import { useEffect, useState } from "react";

const TEXTO: Record<string, { titulo: string; cuerpo: string; puedeEntrar: boolean }> = {
  listo: { titulo: "Tu documento está listo", cuerpo: "Escribe tu fecha de nacimiento para verlo. Solo tú puedes abrirlo.", puedeEntrar: true },
  entrega_en_persona: { titulo: "Queremos entregártelo en persona", cuerpo: "Una persona de EIRA te lo entrega y te explica con calma. Pide tu cita aquí o llama al 341 410 8111.", puedeEntrar: true },
  en_proceso: { titulo: "Todavía lo estamos revisando", cuerpo: "Tu estudio sigue en revisión médica. Vuelve a acercar tu llavero en unos días; también te avisaremos.", puedeEntrar: false },
  sin_documentos: { titulo: "Aún no hay documentos", cuerpo: "Cuando tengamos tu estudio aparecerá aquí.", puedeEntrar: false },
};

export default function Llavero({ token }: { token: string }) {
  const [info, setInfo] = useState<{ saludo: string; estado: string } | null>(null);
  const [error, setError] = useState("");
  const [fecha, setFecha] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/reto4/llavero/${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? setInfo(await r.json()) : setError((await r.json()).error?.mensaje ?? "Llavero no válido")))
      .catch(() => setError("Sin conexión. Intenta de nuevo."));
  }, [token]);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError("");
    const r = await fetch(`/api/v1/reto4/llavero/${encodeURIComponent(token)}/acceso`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fecha_nacimiento: fecha }),
    });
    if (r.ok) window.location.href = "/portal/resultados";
    else {
      setError((await r.json()).error?.mensaje ?? "No pudimos entrar");
      setEnviando(false);
    }
  }

  const t = info ? TEXTO[info.estado] : null;
  return (
    <div className="mx-auto max-w-md space-y-5 py-6">
      <div className="card space-y-4 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-3xl" aria-hidden>🔑</div>
        {!info && !error && <p className="text-lg text-slate-600">Leyendo tu llavero…</p>}
        {info && t && (
          <>
            <p className="text-lg text-slate-600">Hola, {info.saludo}</p>
            <h1 className="text-2xl font-bold">{t.titulo}</h1>
            <p className="text-lg">{t.cuerpo}</p>
            {t.puedeEntrar && (
              <form onSubmit={entrar} className="space-y-3 text-left">
                <label className="label text-base" htmlFor="dob">Tu fecha de nacimiento</label>
                <input id="dob" type="date" required className="input py-3 text-xl" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                <button className="btn-primary w-full py-4 text-xl" disabled={enviando}>{enviando ? "Entrando…" : "Ver mi documento"}</button>
              </form>
            )}
          </>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-lg text-red-700" role="alert">{error}</p>}
      </div>
      <p className="text-center text-sm text-slate-500">El llavero no guarda tu nombre ni tu resultado. Al terminar, la sesión se cierra sola en 15 minutos.</p>
    </div>
  );
}
