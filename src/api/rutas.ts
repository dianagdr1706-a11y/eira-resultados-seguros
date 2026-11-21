/**
 * API REST v1: tabla única de rutas → funciones del núcleo.
 * Cada entrada dice quién puede llamarla (`acceso`) y qué función ejecuta.
 */
import type { Ctx } from "@/core/permisos";
import { ErrorDominio } from "@/core/errores";
import { maskEmail, maskPhone } from "@/lib/ids";
import type { Paciente } from "@/lib/db";
import * as r1 from "@/core/reto1/expediente";
import * as sync from "@/core/reto1/sincronizacion";
import * as r4 from "@/core/reto4/estudios";
import * as portal from "@/core/reto4/portal";
import * as llavero from "@/core/reto4/llavero";
import * as contacto from "@/core/reto4/contacto";
import * as malla from "@/core/reto4/malla";
import * as bit from "@/core/bitacora";
import * as sim from "@/sim/controles";
import { db, type Usuario } from "@/lib/db";
import { audit } from "@/lib/audit";
import { verifySecret } from "@/lib/ids";
import { kv } from "@/lib/kv";

/** Respuesta de alta/edición sin secretos ni contactos completos. */
function pacientePublico(p: Paciente) {
  const r: Partial<Paciente> = { ...p };
  delete r.pin_hash;
  delete r.pin_expira;
  return { ...r, telefono: maskPhone(p.telefono), correo: maskEmail(p.correo), curp: p.curp ? `${p.curp.slice(0, 4)}••••••••••••••` : null };
}
import { ROLES } from "@/lib/estados";

export type Peticion = {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  archivo?: { buf: Buffer; nombre: string };
  ip: string;
  /** Presente si hay sesión de personal. */
  ctx?: Ctx;
  /** Presente si hay sesión de paciente. */
  paciente?: { id: string; sesion: string };
};

/** Efectos de sesión que la capa HTTP aplica como cookies. */
export type Efecto = { abrirSesionPersonal?: string; cerrarSesionPersonal?: boolean; abrirSesionPaciente?: string; cerrarSesionPaciente?: boolean; retoOtp?: string | null };
export type Respuesta = { datos: unknown; estado?: number; efecto?: Efecto };

type Ruta = { metodo: "GET" | "POST" | "PATCH"; ruta: string; acceso: "publico" | "personal" | "paciente"; desc: string; fn: (p: Peticion) => Respuesta | Promise<Respuesta> };

const ok = (datos: unknown, estado = 200): Respuesta => ({ datos, estado });
const c = (p: Peticion) => p.ctx!;

export const RUTAS: Ruta[] = [
  // ───────── Sesión de personal ─────────
  { metodo: "POST", ruta: "/auth/login", acceso: "publico", desc: "Inicia sesión de personal {usuario, password}", fn: async (p) => {
    if ((await (await kv()).incr(`rl:staff:${p.ip}`, 600)) > 40) throw new ErrorDominio("LIMITE", "Demasiados intentos. Espera 10 minutos.", 429);
    const u = db().prepare("SELECT * FROM usuarios WHERE usuario = ? AND activo = 1").get(String(p.body.usuario ?? "").trim()) as Usuario | undefined;
    if (!u || !verifySecret(String(p.body.password ?? ""), u.password_hash)) {
      audit({ tipo: "sistema" }, "LOGIN_PERSONAL_FALLIDO", null, { usuario: p.body.usuario }, p.ip);
      throw new ErrorDominio("CREDENCIALES", "Usuario o contraseña incorrectos.", 401);
    }
    audit({ tipo: "usuario", id: u.id, nombre: `${u.nombre} (${u.rol})` }, "LOGIN_PERSONAL", null, null, p.ip);
    return { datos: { usuario: u.usuario, nombre: u.nombre, rol: u.rol, rol_label: ROLES[u.rol] }, efecto: { abrirSesionPersonal: u.id } };
  } },
  { metodo: "POST", ruta: "/auth/logout", acceso: "publico", desc: "Cierra la sesión de personal", fn: () => ({ datos: { ok: true }, efecto: { cerrarSesionPersonal: true } }) },
  { metodo: "GET", ruta: "/auth/yo", acceso: "personal", desc: "Usuario en sesión", fn: (p) => ok({ usuario: c(p).usuario.usuario, nombre: c(p).usuario.nombre, rol: c(p).usuario.rol }) },

  // ───────── Reto 1 · Expediente único ─────────
  { metodo: "GET", ruta: "/reto1/pacientes", acceso: "personal", desc: "Busca pacientes ?q=", fn: (p) => ok(r1.buscarPacientes(c(p), p.query.get("q") ?? "")) },
  { metodo: "POST", ruta: "/reto1/coincidencias", acceso: "personal", desc: "Posibles duplicados para unos datos (no modifica nada)", fn: (p) => ok(r1.buscarCoincidencias(c(p), p.body as never)) },
  { metodo: "POST", ruta: "/reto1/pacientes", acceso: "personal", desc: "Alta {datos, confirmacion?}; 409 REQUIERE_CONFIRMACION si hay parecidas", fn: (p) => {
    const r = r1.registrarPaciente(c(p), (p.body.datos ?? p.body) as never, p.body.confirmacion);
    return ok({ ...r, paciente: pacientePublico(r.paciente) }, r.creada ? 201 : 200);
  } },
  { metodo: "GET", ruta: "/reto1/pacientes/:id", acceso: "personal", desc: "Expediente con historial de visitas, servicios y estudios", fn: (p) => ok(r1.obtenerExpediente(c(p), p.params.id)) },
  { metodo: "PATCH", ruta: "/reto1/pacientes/:id", acceso: "personal", desc: "Edita {cambios, version_base}; 409 CONFLICTO_VERSION", fn: (p) => ok(pacientePublico(r1.actualizarPaciente(c(p), p.params.id, p.body.cambios ?? {}, Number(p.body.version_base)))) },
  { metodo: "POST", ruta: "/reto1/pacientes/:id/visitas", acceso: "personal", desc: "Registra visita {fecha, sede, servicios[]}", fn: (p) => ok(r1.registrarVisita(c(p), { fecha: p.body.fecha, sede: p.body.sede, municipio: p.body.municipio, motivo: p.body.motivo, servicios: p.body.servicios ?? [], pacienteId: p.params.id, origen: "en_linea" }), 201) },
  { metodo: "POST", ruta: "/reto1/sync", acceso: "personal", desc: "Sincroniza lote offline {dispositivo, operaciones[]}", fn: (p) => ok(sync.sincronizarLote(c(p), p.body as never)) },
  { metodo: "GET", ruta: "/reto1/sync/pendientes", acceso: "personal", desc: "Operaciones offline que esperan decisión humana", fn: (p) => ok(sync.listarPendientesSync(c(p))) },
  { metodo: "POST", ruta: "/reto1/sync/pendientes/:id", acceso: "personal", desc: "Resuelve un pendiente {decision, ...}", fn: (p) => ok(sync.resolverPendienteSync(c(p), p.params.id, p.body as never)) },

  // ───────── Reto 4 · Personal ─────────
  { metodo: "GET", ruta: "/reto4/panel", acceso: "personal", desc: "Estudios, conteo por estado y alertas", fn: (p) => ok(r4.listarPanel(c(p))) },
  { metodo: "GET", ruta: "/reto4/bethesda", acceso: "personal", desc: "Catálogo Bethesda con sugerencia del semáforo", fn: () => ok(r4.catalogoBethesda()) },
  { metodo: "POST", ruta: "/reto4/estudios", acceso: "personal", desc: "Carga PDF (multipart: pdf, folio, fecha_toma, sede)", fn: (p) => {
    if (!p.archivo) throw new ErrorDominio("DATOS_INCOMPLETOS", "Falta el archivo PDF");
    return ok(r4.cargarEstudio(c(p), { pdf: p.archivo.buf, nombreArchivo: p.archivo.nombre, folio: String(p.body.folio ?? ""), fechaToma: p.body.fecha_toma, sede: p.body.sede }), 201);
  } },
  { metodo: "GET", ruta: "/reto4/estudios/:id", acceso: "personal", desc: "Detalle con línea de tiempo", fn: (p) => ok(r4.obtenerEstudio(c(p), p.params.id)) },
  { metodo: "POST", ruta: "/reto4/estudios/:id/asociar", acceso: "personal", desc: "Asocia {paciente_id, checklist[]}", fn: (p) => ok(r4.asociarPaciente(c(p), { estudioId: p.params.id, pacienteId: p.body.paciente_id, checklist: p.body.checklist ?? [] })) },
  { metodo: "POST", ruta: "/reto4/estudios/:id/revision", acceso: "personal", desc: "Revisión admin {decision, comentarios}", fn: (p) => ok(r4.revisarAdministrativamente(c(p), { estudioId: p.params.id, decision: p.body.decision, comentarios: p.body.comentarios })) },
  { metodo: "POST", ruta: "/reto4/estudios/:id/autorizacion", acceso: "personal", desc: "Autorización clínica {decision, bethesda, comentarios}", fn: (p) => ok(r4.autorizarClinicamente(c(p), { estudioId: p.params.id, decision: p.body.decision, bethesda: p.body.bethesda, comentarios: p.body.comentarios })) },
  { metodo: "POST", ruta: "/reto4/estudios/:id/notificacion", acceso: "personal", desc: "Reenvía el aviso neutro", fn: (p) => ok(r4.reenviarNotificacion(c(p), p.params.id)) },
  { metodo: "POST", ruta: "/reto4/estudios/:id/entrega", acceso: "personal", desc: "Entrega asistida {modalidad, resultado, identidad_verificada, acuse}", fn: (p) => ok(r4.registrarEntrega(c(p), { estudioId: p.params.id, modalidad: p.body.modalidad, resultado: p.body.resultado, identidadVerificada: !!p.body.identidad_verificada, acuse: p.body.acuse, observaciones: p.body.observaciones })) },
  { metodo: "POST", ruta: "/reto4/pacientes/:id/pin", acceso: "personal", desc: "Genera PIN de talón (se muestra una sola vez)", fn: (p) => { const r = r4.generarPinTalon(c(p), p.params.id); return ok({ id_eira: r.paciente.id_eira, pin: r.pin, expira: r.expira }, 201); } },

  // ───────── Reto 4 · Llavero NFC y ciclo de contacto ─────────
  { metodo: "POST", ruta: "/reto4/pacientes/:id/llavero", acceso: "personal", desc: "Emite llavero NFC: devuelve la ruta a grabar en la etiqueta", fn: (p) => ok(llavero.emitirLlavero(c(p), p.params.id), 201) },
  { metodo: "GET", ruta: "/reto4/llavero/:token", acceso: "publico", desc: "Al acercar el llavero: estado sin datos personales", fn: async (p) => ok(await llavero.leerLlavero(p.params.token, p.ip)) },
  { metodo: "POST", ruta: "/reto4/llavero/:token/acceso", acceso: "publico", desc: "Llavero + {fecha_nacimiento} abre sesión de la paciente", fn: async (p) => {
    const r = await llavero.accederConLlavero({ token: p.params.token, fechaNacimiento: String(p.body.fecha_nacimiento ?? ""), ip: p.ip });
    return { datos: { siguiente: "documentos" }, efecto: { abrirSesionPaciente: r.pacienteId } };
  } },
  { metodo: "POST", ruta: "/reto4/contacto/ciclo", acceso: "personal", desc: "Ejecuta el ciclo: escala al siguiente medio tras 72 h sin consulta", fn: (p) => ok(contacto.ejecutarCicloContacto(c(p))) },
  { metodo: "GET", ruta: "/reto4/malla", acceso: "personal", desc: "Cola de avisos neutros para llevar por malla (Briar/Bridgefy/Nearby)", fn: (p) => ok(malla.listarAvisosMalla(c(p))) },
  { metodo: "POST", ruta: "/reto4/malla/:id/entrega", acceso: "personal", desc: "La mula confirma la entrega {portador, app}", fn: (p) => ok(malla.confirmarEntregaMalla(c(p), { intentoId: Number(p.params.id), portador: String(p.body.portador ?? ""), app: String(p.body.app ?? "") })) },
  { metodo: "GET", ruta: "/reto4/estudios/:id/contacto", acceso: "personal", desc: "Intentos de contacto de un estudio", fn: (p) => { r4.obtenerEstudio(c(p), p.params.id); return ok(contacto.intentosDe(p.params.id)); } },

  // ───────── Reto 4 · Portal de la paciente ─────────
  { metodo: "POST", ruta: "/reto4/portal/acceso", acceso: "publico", desc: "Paso 1 {folio, fecha_nacimiento, metodo, pin?}", fn: async (p) => {
    const a = await portal.iniciarAcceso({ folio: String(p.body.folio ?? ""), fechaNacimiento: String(p.body.fecha_nacimiento ?? ""), metodo: p.body.metodo, pin: p.body.pin, ip: p.ip });
    if (a.tipo === "sesion") return { datos: { siguiente: "documentos" }, efecto: { abrirSesionPaciente: a.pacienteId } };
    return { datos: { siguiente: "otp", canal: a.canal, destino: a.destino, vigencia_seg: a.vigenciaSeg, intentos: a.intentos }, efecto: { retoOtp: a.reto } };
  } },
  { metodo: "POST", ruta: "/reto4/portal/otp", acceso: "publico", desc: "Paso 2 {codigo}", fn: async (p) => {
    const r = await portal.verificarOtp({ reto: String(p.body.__reto ?? ""), codigo: String(p.body.codigo ?? ""), ip: p.ip });
    return { datos: { siguiente: "documentos" }, efecto: { abrirSesionPaciente: r.pacienteId, retoOtp: null } };
  } },
  { metodo: "GET", ruta: "/reto4/portal/documentos", acceso: "paciente", desc: "Paso 3: documentos autorizados de la paciente", fn: (p) => {
    const pac = db().prepare("SELECT nombre, id_eira FROM pacientes WHERE id = ?").get(p.paciente!.id) as { nombre: string; id_eira: string };
    return ok({ paciente: { nombre: pac.nombre.split(" ")[0], id_eira: pac.id_eira }, documentos: portal.documentosDePaciente(p.paciente!.id) });
  } },
  { metodo: "POST", ruta: "/reto4/portal/documentos/:id/enlace", acceso: "paciente", desc: "Paso 4: enlace de descarga de 120 s", fn: async (p) => {
    const t = await portal.emitirTokenDescarga({ pacienteId: p.paciente!.id, sesion: p.paciente!.sesion, estudioId: p.params.id });
    return ok({ url: `/api/portal/descarga?t=${t}`, vigencia_seg: portal.DESCARGA_TTL }, 201);
  } },
  { metodo: "POST", ruta: "/reto4/portal/salir", acceso: "publico", desc: "Cierra la sesión de la paciente", fn: () => ({ datos: { ok: true }, efecto: { cerrarSesionPaciente: true } }) },

  // ───────── Bitácora ─────────
  { metodo: "GET", ruta: "/bitacora", acceso: "personal", desc: "Registros e integridad de la cadena", fn: (p) => ok(bit.consultarBitacora(c(p), Number(p.query.get("limite") ?? 300))) },
  { metodo: "GET", ruta: "/bitacora/integridad", acceso: "personal", desc: "Recalcula la cadena de hashes", fn: (p) => ok(bit.verificarIntegridad(c(p))) },
  { metodo: "POST", ruta: "/bitacora/intento-alteracion", acceso: "personal", desc: "Intenta un UPDATE real; la base lo rechaza", fn: (p) => ok(bit.intentarAlterar(c(p))) },

  // ───────── Simulación (solo demo) ─────────
  { metodo: "GET", ruta: "/sim/estado", acceso: "personal", desc: "Reloj, proveedores y almacén", fn: async (p) => ok(await sim.estadoSimulacion(c(p))) },
  { metodo: "POST", ruta: "/sim/proveedor", acceso: "personal", desc: "{canal, caido}", fn: (p) => { sim.cambiarProveedor(c(p), p.body.canal, !!p.body.caido); return ok({ ok: true }); } },
  { metodo: "POST", ruta: "/sim/reloj", acceso: "personal", desc: "{dias} (0 reinicia)", fn: (p) => { sim.moverReloj(c(p), Number(p.body.dias)); return ok({ ok: true }); } },
  { metodo: "POST", ruta: "/sim/reiniciar", acceso: "personal", desc: "Restaura los datos sintéticos", fn: async (p) => { await sim.reiniciarDatos(c(p)); return { datos: { ok: true }, efecto: { cerrarSesionPersonal: true } }; } },
  { metodo: "GET", ruta: "/sim/bandeja", acceso: "personal", desc: "Bandeja simulada de SMS y correo", fn: (p) => ok(sim.leerBandeja(c(p))) },
];

export function buscarRuta(metodo: string, partes: string[]) {
  for (const r of RUTAS) {
    if (r.metodo !== metodo) continue;
    const seg = r.ruta.split("/").filter(Boolean);
    if (seg.length !== partes.length) continue;
    const params: Record<string, string> = {};
    if (seg.every((s, i) => (s.startsWith(":") ? ((params[s.slice(1)] = decodeURIComponent(partes[i])), true) : s === partes[i]))) return { ruta: r, params };
  }
  return null;
}
