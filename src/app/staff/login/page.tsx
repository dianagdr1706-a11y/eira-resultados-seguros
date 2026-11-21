import { loginStaff } from "../actions";
import { USUARIOS_DEMO, DEMO_PASSWORD } from "@/lib/seed";
import { ROLES } from "@/lib/estados";

const ERR: Record<string, string> = {
  credenciales: "Usuario o contraseña incorrectos.",
  limite: "Demasiados intentos. Espera 10 minutos.",
};

export default function Login({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <form action={loginStaff} className="card space-y-4">
        <h1 className="h1">Acceso de personal</h1>
        {searchParams.error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{ERR[searchParams.error] ?? "Error"}</p>}
        {searchParams.ok && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">Demo reiniciada.</p>}
        <div>
          <label className="label" htmlFor="usuario">Usuario</label>
          <input className="input" id="usuario" name="usuario" required autoComplete="username" />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <input className="input" id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <button className="btn-primary w-full">Entrar</button>
      </form>
      <div className="card">
        <h2 className="h2 mb-2">Usuarios de demo</h2>
        <p className="mb-3 text-sm text-slate-600">Contraseña para todos: <code className="rounded bg-slate-100 px-1">{DEMO_PASSWORD}</code></p>
        <div className="space-y-2">
          {USUARIOS_DEMO.map((u) => (
            <form key={u.usuario} action={loginStaff} className="flex items-center justify-between rounded-lg border p-2">
              <input type="hidden" name="usuario" value={u.usuario} />
              <input type="hidden" name="password" value={DEMO_PASSWORD} />
              <div>
                <div className="font-semibold">{ROLES[u.rol]}</div>
                <div className="text-xs text-slate-500">{u.nombre} · usuario: {u.usuario}</div>
              </div>
              <button className="btn-secondary">Entrar</button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
