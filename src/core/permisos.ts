import type { Usuario } from "@/lib/db";
import type { Actor } from "@/lib/audit";
import { ErrorDominio } from "./errores";

export type Rol = "laboratorio" | "eira_admin" | "medico" | "auditoria" | "captura";

/** Contexto de quien ejecuta una función del núcleo. */
export type Ctx = { usuario: Usuario; ip?: string | null };

/** Matriz única de permisos: qué rol puede ejecutar cada función. */
export const PERMISOS = {
  // Reto 1: expediente único
  "reto1.buscarCoincidencias": ["captura", "eira_admin", "medico"],
  "reto1.registrarPaciente": ["captura", "eira_admin"],
  "reto1.actualizarPaciente": ["captura", "eira_admin"],
  "reto1.registrarVisita": ["captura", "eira_admin"],
  "reto1.obtenerExpediente": ["captura", "eira_admin", "medico"],
  "reto1.sincronizarLote": ["captura", "eira_admin"],
  "reto1.listarPendientesSync": ["eira_admin"],
  "reto1.resolverPendienteSync": ["eira_admin"],
  // Reto 4: entrega segura de resultados
  "reto4.cargarEstudio": ["laboratorio", "eira_admin"],
  "reto4.asociarPaciente": ["eira_admin"],
  "reto4.revisarAdministrativamente": ["eira_admin"],
  "reto4.autorizarClinicamente": ["medico"],
  "reto4.reenviarNotificacion": ["eira_admin"],
  "reto4.registrarEntrega": ["eira_admin", "medico"],
  "reto4.generarPinTalon": ["eira_admin"],
  "reto4.listarPanel": ["laboratorio", "eira_admin", "medico", "auditoria"],
  "reto4.obtenerEstudio": ["eira_admin", "medico", "auditoria"],
  // Transversal
  "bitacora.consultar": ["eira_admin", "auditoria"],
  "sim.controles": ["eira_admin", "auditoria"],
} as const satisfies Record<string, readonly Rol[]>;

export type Permiso = keyof typeof PERMISOS;

export function exigir(ctx: Ctx, permiso: Permiso) {
  if (!(PERMISOS[permiso] as readonly string[]).includes(ctx.usuario.rol))
    throw new ErrorDominio("SIN_PERMISO", `El rol ${ctx.usuario.rol} no puede ejecutar ${permiso}`, 403);
}

export const actorDe = (ctx: Ctx): Actor => ({ tipo: "usuario", id: ctx.usuario.id, nombre: `${ctx.usuario.nombre} (${ctx.usuario.rol})` });
