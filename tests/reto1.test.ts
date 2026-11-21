import { test, before } from "node:test";
import assert from "node:assert/strict";
import { preparar, codigo } from "./preparar";

let t: Awaited<ReturnType<typeof preparar>>;
let r1: typeof import("@/core/reto1/expediente");
let co: typeof import("@/core/reto1/coincidencias");
let sy: typeof import("@/core/reto1/sincronizacion");
before(async () => {
  t = await preparar();
  r1 = await import("@/core/reto1/expediente");
  co = await import("@/core/reto1/coincidencias");
  sy = await import("@/core/reto1/sincronizacion");
});

const nueva = { nombre: "Josefina Barragán Cisneros", fecha_nacimiento: "1980-02-14", telefono: "341 555 0101", municipio: "Sayula" };

test("similitudNombre tolera acentos, orden y errores de dedo", () => {
  assert.equal(co.similitudNombre("María Guadalupe Hernández López", "maria guadalupe hernandez lopez"), 1);
  assert.ok(co.similitudNombre("Hernández López María Guadalupe", "María Guadalupe Hernández López") >= 0.75);
  assert.ok(co.similitudNombre("Maria Guadalupe Hernandes Lopez", "María Guadalupe Hernández López") >= 0.75);
  assert.ok(co.similitudNombre("Rosa Elena Martínez", "Lucía Fernanda Gómez Ruiz") < 0.5);
});

test("registrarPaciente crea un ID EIRA estable y consecutivo", () => {
  const { paciente, creada } = r1.registrarPaciente(t.captura, nueva);
  assert.equal(creada, true);
  assert.match(paciente.id_eira, /^EIRA-\d{5}$/);
  assert.equal(paciente.id_eira, "EIRA-00534");
  assert.equal(paciente.telefono, "3415550101");
  assert.equal(paciente.version, 1);
});

test("registrarPaciente valida datos", async () => {
  assert.equal(await codigo(() => r1.registrarPaciente(t.captura, { nombre: "Ana", fecha_nacimiento: "1990-01-01" })), "NOMBRE_INVALIDO");
  assert.equal(await codigo(() => r1.registrarPaciente(t.captura, { nombre: "Ana Ruiz", fecha_nacimiento: "01/01/1990" })), "FECHA_INVALIDA");
  assert.equal(await codigo(() => r1.registrarPaciente(t.captura, { nombre: "Ana Ruiz", fecha_nacimiento: "1990-01-01", telefono: "123" })), "TELEFONO_INVALIDO");
});

test("la segunda visita de la misma paciente NO crea duplicado: exige confirmación humana", async () => {
  const antes = (t.db().prepare("SELECT COUNT(*) n FROM pacientes").get() as { n: number }).n;
  const repetida = { nombre: "Josefina Barragan Cisneros", fecha_nacimiento: "1980-02-14" };
  let err: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { r1.registrarPaciente(t.captura, repetida); } catch (e) { err = e; }
  assert.equal(err.codigo, "REQUIERE_CONFIRMACION");
  assert.equal(err.http, 409);
  const cand = err.datos.candidatas[0];
  assert.equal(cand.paciente.id_eira, "EIRA-00534");
  assert.ok(cand.razones.includes("Misma fecha de nacimiento"));
  assert.equal((t.db().prepare("SELECT COUNT(*) n FROM pacientes").get() as { n: number }).n, antes, "no se creó nada sin confirmación");
  const r = r1.registrarPaciente(t.captura, repetida, { decision: "existente", pacienteId: cand.paciente.id });
  assert.equal(r.creada, false);
  assert.equal(r.paciente.id_eira, "EIRA-00534");
  assert.equal((t.db().prepare("SELECT COUNT(*) n FROM pacientes").get() as { n: number }).n, antes);
});

test("homónima real: se registra como nueva solo con motivo y queda la decisión", async () => {
  const homonima = { nombre: "María Guadalupe Hernández López", fecha_nacimiento: "1985-03-12" };
  assert.equal(await codigo(() => r1.registrarPaciente(t.captura, homonima)), "REQUIERE_CONFIRMACION");
  assert.equal(await codigo(() => r1.registrarPaciente(t.captura, homonima, { decision: "nueva", motivo: "" })), "MOTIVO_REQUERIDO");
  const r = r1.registrarPaciente(t.captura, homonima, { decision: "nueva", motivo: "Distinta CURP y domicilio, verificado con INE" });
  assert.equal(r.creada, true);
  const dec = t.db().prepare("SELECT decision FROM decisiones_coincidencia ORDER BY id DESC LIMIT 1").get() as { decision: string };
  assert.equal(dec.decision, "nueva");
});

test("visitas y servicios se guardan aparte y arman el historial", () => {
  const p = r1.pacientePorId("EIRA-00534");
  r1.registrarVisita(t.captura, { pacienteId: p.id, fecha: "2026-10-03", sede: "Jornada Sayula", servicios: [{ tipo: "papanicolaou" }, { tipo: "exploracion_mamaria" }] });
  r1.registrarVisita(t.captura, { pacienteId: p.id, fecha: "2026-11-20", sede: "Jornada Sayula", servicios: [{ tipo: "mastografia" }] });
  const exp = r1.obtenerExpediente(t.medico, p.id);
  assert.deepEqual(exp.resumen, { visitas: 2, servicios: 3, estudios: 0 });
  assert.equal(exp.visitas[0].fecha, "2026-11-20");
  assert.equal(exp.paciente.sede_ultima, "Jornada Sayula");
});

test("registrarVisita rechaza servicios desconocidos o vacíos", async () => {
  const p = r1.pacientePorId("EIRA-00534");
  assert.equal(await codigo(() => r1.registrarVisita(t.captura, { pacienteId: p.id, fecha: "2026-10-03", servicios: [] })), "SIN_SERVICIOS");
  assert.equal(await codigo(() => r1.registrarVisita(t.captura, { pacienteId: p.id, fecha: "2026-10-03", servicios: [{ tipo: "rayos_x" }] })), "SERVICIO_INVALIDO");
});

test("control de acceso por rol", async () => {
  assert.equal(await codigo(() => r1.registrarPaciente(t.medico, nueva)), "SIN_PERMISO");
  assert.equal(await codigo(() => r1.registrarPaciente(t.lab, nueva)), "SIN_PERMISO");
  assert.equal(await codigo(() => r1.obtenerExpediente(t.auditoria, "EIRA-00534")), "SIN_PERMISO");
  const comoCaptura = r1.obtenerExpediente(t.captura, "EIRA-00534");
  assert.match(String(comoCaptura.paciente.telefono), /••/, "captura ve el teléfono enmascarado");
  assert.equal(r1.obtenerExpediente(t.medico, "EIRA-00534").paciente.telefono, "3415550101");
});

test("actualizarPaciente detecta conflicto de versión", async () => {
  const p = r1.pacientePorId("EIRA-00534");
  const v2 = r1.actualizarPaciente(t.admin, p.id, { telefono: "3415550202" }, p.version);
  assert.equal(v2.version, 2);
  let err: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { r1.actualizarPaciente(t.captura, p.id, { telefono: "3415550303" }, 1); } catch (e) { err = e; }
  assert.equal(err.codigo, "CONFLICTO_VERSION");
  assert.equal(err.datos.actual.telefono, "3415550202");
  assert.equal(r1.pacientePorId(p.id).telefono, "3415550202", "no se sobrescribió");
});

test("sincronización offline: aplica, es idempotente, detecta parecidas y conflictos", () => {
  const p = r1.pacientePorId("EIRA-00534");
  const lote = {
    dispositivo: "tablet-jornada-1",
    operaciones: [
      { op_id: "op-1", tipo: "alta_paciente" as const, datos: { temp_id: "tmp-1", nombre: "Carmen Lucía Ochoa Vega", fecha_nacimiento: "1975-09-09", municipio: "Tapalpa" } },
      { op_id: "op-2", tipo: "visita" as const, datos: { paciente_ref: "tmp-1", fecha: "2026-11-21", sede: "Jornada Tapalpa", servicios: [{ tipo: "papanicolaou" }] } },
      { op_id: "op-3", tipo: "alta_paciente" as const, datos: { temp_id: "tmp-2", nombre: "Rosa Elena Martinez Cruz", fecha_nacimiento: "1962-05-21" } },
      { op_id: "op-4", tipo: "visita" as const, datos: { paciente_ref: "tmp-2", fecha: "2026-11-21", servicios: [{ tipo: "vph" }] } },
      { op_id: "op-5", tipo: "actualizacion_paciente" as const, datos: { paciente_ref: p.id, cambios: { municipio: "Zapotlán" }, version_base: 1 } },
      { op_id: "op-6", tipo: "visita" as const, datos: { paciente_ref: "EIRA-00121", fecha: "2026-11-21", servicios: [{ tipo: "orientacion" }] } },
    ],
  };
  const r = sy.sincronizarLote(t.captura, lote);
  assert.deepEqual(r.resultados.map((x) => x.estado), ["aplicada", "aplicada", "pendiente_confirmacion", "pendiente_confirmacion", "conflicto", "aplicada"]);
  const antes = (t.db().prepare("SELECT COUNT(*) n FROM pacientes").get() as { n: number }).n;
  const visitasAntes = (t.db().prepare("SELECT COUNT(*) n FROM visitas").get() as { n: number }).n;
  const otra = sy.sincronizarLote(t.captura, lote);
  assert.ok(otra.resultados.every((x) => x.estado === "duplicada"), "reenviar el lote no aplica nada dos veces");
  assert.equal((t.db().prepare("SELECT COUNT(*) n FROM pacientes").get() as { n: number }).n, antes);
  assert.equal((t.db().prepare("SELECT COUNT(*) n FROM visitas").get() as { n: number }).n, visitasAntes);
});

test("los pendientes offline solo los resuelve administración, con decisión explícita", async () => {
  assert.equal(await codigo(() => sy.listarPendientesSync(t.captura)), "SIN_PERMISO");
  const pend = sy.listarPendientesSync(t.admin);
  assert.deepEqual(pend.map((x) => x.op_id).sort(), ["op-3", "op-4", "op-5"]);
  assert.equal(await codigo(() => sy.resolverPendienteSync(t.admin, "op-4", { decision: "reintentar" })), "AUN_PENDIENTE");
  const rosa = r1.pacientePorId("EIRA-00507");
  const a = sy.resolverPendienteSync(t.admin, "op-3", { decision: "existente", pacienteId: rosa.id });
  assert.equal(a.estado, "aplicada");
  assert.equal(a.resultado_id, rosa.id, "se vinculó al expediente existente, sin duplicar");
  assert.equal(sy.resolverPendienteSync(t.admin, "op-4", { decision: "reintentar" }).estado, "aplicada");
  assert.equal(r1.obtenerExpediente(t.admin, rosa.id).resumen.visitas, 1);
  assert.equal(sy.resolverPendienteSync(t.admin, "op-5", { decision: "descartar" }).estado, "rechazada");
  assert.equal(r1.pacientePorId("EIRA-00534").municipio, "Sayula", "descartar conserva el valor del servidor");
  assert.equal(sy.listarPendientesSync(t.admin).length, 0);
  assert.equal(await codigo(() => sy.resolverPendienteSync(t.admin, "op-5", { decision: "aplicar" })), "YA_RESUELTA");
});

test("todo lo anterior quedó en una bitácora íntegra", async () => {
  const { verifyChain } = await import("@/lib/audit");
  const v = verifyChain();
  assert.equal(v.ok, true);
  const acciones = (t.db().prepare("SELECT DISTINCT accion FROM bitacora").all() as { accion: string }[]).map((x) => x.accion);
  for (const a of ["PACIENTE_REGISTRADA", "COINCIDENCIA_CONFIRMADA_MISMA_PACIENTE", "COINCIDENCIA_DESCARTADA_PACIENTE_NUEVA", "VISITA_REGISTRADA", "PACIENTE_ACTUALIZADA", "LOTE_OFFLINE_SINCRONIZADO", "PENDIENTE_OFFLINE_RESUELTO"])
    assert.ok(acciones.includes(a), a);
});
