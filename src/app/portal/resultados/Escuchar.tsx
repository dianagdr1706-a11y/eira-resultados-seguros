"use client";

export default function Escuchar({ texto }: { texto: string }) {
  return (
    <button
      className="btn-secondary"
      onClick={() => {
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = "es-MX";
        u.rate = 0.9;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }}
    >
      🔊 Escuchar
    </button>
  );
}
