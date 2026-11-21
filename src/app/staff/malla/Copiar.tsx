"use client";
import { useState } from "react";

export default function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn-secondary py-1" onClick={async () => { await navigator.clipboard.writeText(texto); setOk(true); }}>
      {ok ? "Copiado" : "Copiar para Briar / Bridgefy"}
    </button>
  );
}
