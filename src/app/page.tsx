import Link from "next/link";

const REAL = [
  "Carga de PDF con hash SHA-256 y almacenamiento privado (fuera de /public)",
  "Asociación con verificación humana obligatoria (4 checks) y alerta de homónimas",
  "Doble compuerta: revisión administrativa y autorización clínica",
  "Semáforo Bethesda: sugiere entrega acompañada; el médico decide",
  "Roles (laboratorio, EIRA, médico, auditoría, paciente) con sesión en Valkey",
  "Portal de paciente: folio + fecha de nacimiento + OTP (10 min, 5 intentos) o PIN del talón impreso",
  "Descarga con token efímero de 120 s ligado a la sesión y Cache-Control: no-store",
  "Bitácora append-only encadenada por hash, con verificación de integridad",
  "Respaldo multicanal: SMS → correo → entrega asistida",
  "Seguimiento de ciclo cerrado: 7 días (rutinario) y 48 h (prioritario)",
];
const SIMULADO = [
  "Envío real de SMS y correo: se muestra en la bandeja simulada",
  "Caída del proveedor (botón para demostrar el respaldo)",
  "Paso del tiempo (reloj de demo)",
  "Cifrado en reposo del bucket (en producción: S3/R2 con SSE)",
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-rose-600 to-rose-500 p-8 text-white">
        <h1 className="text-3xl font-black">Resultados de Papanicolaou, seguros y sin WhatsApp</h1>
        <p className="mt-2 max-w-2xl text-rose-50">
          Revisión administrativa y médica antes de liberar, aviso sin datos clínicos, acceso autenticado sin enlaces públicos
          y alternativas asistidas para quien no tiene teléfono, correo ni internet.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/portal" className="btn bg-white px-6 py-3 text-base text-rose-700 hover:bg-rose-50">Soy paciente: consultar mi documento</Link>
          <Link href="/staff/login" className="btn border border-white/60 px-6 py-3 text-base text-white hover:bg-white/10">Personal EIRA / Laboratorio / Médico</Link>
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="h2 mb-3 text-emerald-700">Implementado</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">{REAL.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
        <div className="card">
          <h2 className="h2 mb-3 text-amber-700">Simulado en el prototipo</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">{SIMULADO.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </section>
    </div>
  );
}
