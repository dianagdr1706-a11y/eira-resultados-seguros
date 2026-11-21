import { test, before } from "node:test";
import assert from "node:assert/strict";
import { preparar, codigo } from "./preparar";

let t: Awaited<ReturnType<typeof preparar>>;
let r4: typeof import("@/core/reto4/estudios");
let ll: typeof import("@/core/reto4/llavero");
let co: typeof import("@/core/reto4/contacto");
let sim: typeof import("@/sim/controles");
let pdf: Buffer;
const pac = (idEira: string) => t.db().prepare("SELECT * FROM pacientes WHERE id_eira = ?").get(idEira) as import("@/lib/db").Paciente;

before(async () => {
  t = await preparar();
  r4 = await import("@/core/reto4/estudios");
  ll = await import("@/core/reto4/llavero");
  co = await import("@/core/reto4/contacto");
  sim = await import("@/sim/controles");
  const { samplePdf } = await import("@/sim/pdf-muestra");
  pdf = await samplePdf({ ...pac("EIRA-00533"), folio: "CIT-L-1", fecha_toma: "2026-11-01", bethesda: "1" });
});

function autorizar(idEira: string, folio: string) {
  const e = r4.cargarEstudio(t.lab, { pdf, nombreArchivo: `${folio}.pdf`, folio });
  r4.asociarPaciente(t.admin, { estudioId: e.id, pacienteId: pac(idEira).id, checklist: ["nombre", "fecha_nacimiento", "folio", "legible"] });
  r4.revisarAdministrativamente(t.admin, { estudioId: e.id, decision: "aprobar" });
  return r4.autorizarClinicamente(t.medico, { estudioId: e.id, decision: "digital", bethesda: "1" }).estudio;
}

test("llavero NFC: guarda solo un código; sin fecha de nacimiento no abre nada", async () => {
  const rosa = pac("EIRA-00507");
  assert.equal(await codigo(() => ll.emitirLlavero(t.medico, rosa.id)), "SIN_PERMISO");
  const { token, ruta } = ll.emitirLlavero(t.admin, rosa.id);
  assert.equal(ruta, `/t/${token}`);
  assert.ok(!ruta.includes("EIRA") && !ruta.includes("Rosa"), "el enlace no lleva datos personales");
  const guardado = t.db().prepare("SELECT token_hash FROM llaveros WHERE paciente_id = ? AND activo = 1").get(rosa.id) as { token_hash: string };
  assert.notEqual(guardado.token_hash, token, "en la base solo está el hash");
  const lectura = await ll.leerLlavero(token);
  assert.deepEqual(Object.keys(lectura).sort(), ["estado", "saludo"]);
  assert.equal(lectura.saludo, "Rosa");
  assert.equal(await codigo(() => ll.leerLlavero("inventado")), "LLAVERO_INVALIDO");
  assert.equal(await codigo(() => ll.accederConLlavero({ token, fechaNacimiento: "1990-01-01" })), "DATOS_NO_COINCIDEN");
  assert.deepEqual(await ll.accederConLlavero({ token, fechaNacimiento: "1962-05-21" }), { pacienteId: rosa.id });
});

test("llavero NFC: reponerlo desactiva el anterior y se bloquea tras 5 fechas incorrectas", async () => {
  const ana = pac("EIRA-00412");
  const viejo = ll.emitirLlavero(t.captura, ana.id).token;
  const nuevo = ll.emitirLlavero(t.admin, ana.id).token;
  assert.equal(await codigo(() => ll.leerLlavero(viejo)), "LLAVERO_INVALIDO");
  for (let i = 0; i < 5; i++) assert.equal(await codigo(() => ll.accederConLlavero({ token: nuevo, fechaNacimiento: "2000-01-01" })), "DATOS_NO_COINCIDEN");
  assert.equal(await codigo(() => ll.accederConLlavero({ token: nuevo, fechaNacimiento: "1978-11-02" })), "LIMITE");
});

test("llavero NFC: el estado refleja el avance sin revelar el resultado", async () => {
  const lucia = pac("EIRA-00533");
  const { token } = ll.emitirLlavero(t.admin, lucia.id);
  const e = r4.cargarEstudio(t.lab, { pdf, nombreArchivo: "x.pdf", folio: "CIT-L-0" });
  r4.asociarPaciente(t.admin, { estudioId: e.id, pacienteId: lucia.id, checklist: ["nombre", "fecha_nacimiento", "folio", "legible"] });
  assert.equal((await ll.leerLlavero(token)).estado, "listo", "ya tenía un documento notificado en los datos de demo");
});

test("siguienteMedio respeta la escalera y lo que la paciente tiene", () => {
  assert.deepEqual([...co.ESCALERA], ["telegram", "sms", "correo", "malla", "asistida"]);
  assert.equal(co.siguienteMedio(pac("EIRA-00533"), new Set()), "telegram");
  assert.equal(co.siguienteMedio(pac("EIRA-00348"), new Set(["sms"])), "malla", "sin correo: salta a la malla");
  assert.equal(co.siguienteMedio(pac("EIRA-00121"), new Set(["sms"])), "correo");
  assert.equal(co.siguienteMedio(pac("EIRA-00121"), new Set(["asistida"])), null);
});

test("ciclo de contacto: cada 72 h sin consulta escala al siguiente medio y termina en una persona", () => {
  const e = autorizar("EIRA-00121", "CIT-L-2");
  assert.equal(e.estado, "notificado");
  const propios = () => co.ejecutarCicloContacto(t.admin).pasos.filter((p) => p.estudio_id === e.id);
  assert.equal(propios().length, 0, "antes de 72 h no insiste");
  sim.moverReloj(t.admin, 2);
  assert.equal(propios().length, 0, "a las 48 h todavía no");
  sim.moverReloj(t.admin, 1);
  assert.deepEqual(propios().map((p) => [p.medio, p.estado]), [["correo", "enviado"]]);
  assert.equal(propios().length, 0, "no repite en la misma ventana");
  sim.moverReloj(t.admin, 3);
  assert.deepEqual(propios().map((p) => p.medio), ["malla"]);
  sim.moverReloj(t.admin, 3);
  assert.deepEqual(propios().map((p) => p.medio), ["asistida"]);
  assert.equal(r4.estudioPorId(e.id).requiere_asistida, 1);
  sim.moverReloj(t.admin, 3);
  assert.equal(propios().length, 0, "la escalera terminó");
  assert.deepEqual((co.intentosDe(e.id) as { canal: string }[]).map((i) => i.canal), ["correo", "malla", "asistida"]);
  sim.moverReloj(t.admin, 0);
});

test("ciclo de contacto: si un medio está caído sigue con el siguiente en la misma pasada", () => {
  const e = autorizar("EIRA-00533", "CIT-L-3");
  sim.cambiarProveedor(t.admin, "correo", true);
  sim.moverReloj(t.admin, 3);
  const pasos = co.ejecutarCicloContacto(t.admin).pasos.filter((p) => p.estudio_id === e.id);
  assert.deepEqual(pasos.map((p) => [p.medio, p.estado]), [["correo", "fallido"], ["malla", "enviado"]]);
  sim.cambiarProveedor(t.admin, "correo", false);
  sim.moverReloj(t.admin, 0);
});

test("ciclo de contacto: una paciente que ya consultó no recibe más avisos; solo administración lo ejecuta", async () => {
  const e = autorizar("EIRA-00348", "CIT-L-4");
  t.db().prepare("UPDATE estudios SET estado = 'consultado' WHERE id = ?").run(e.id);
  sim.moverReloj(t.admin, 10);
  assert.equal(co.ejecutarCicloContacto(t.admin).pasos.some((p) => p.estudio_id === e.id), false);
  assert.equal(await codigo(() => co.ejecutarCicloContacto(t.medico)), "SIN_PERMISO");
  sim.moverReloj(t.admin, 0);
  const { esNeutro } = await import("@/lib/notify");
  const msgs = t.db().prepare("SELECT mensaje FROM notificaciones WHERE tipo = 'seguimiento'").all() as { mensaje: string }[];
  assert.ok(msgs.length > 0 && msgs.every((m) => esNeutro(m.mensaje)));
});

test("malla: el aviso es neutro y opaco, y la entrega por mula se registra una sola vez", async () => {
  const ml = await import("@/core/reto4/malla");
  const { esNeutro } = await import("@/lib/notify");
  const avisos = ml.listarAvisosMalla(t.admin);
  assert.ok(avisos.length > 0);
  const a = avisos[0];
  assert.ok(esNeutro(a.mensaje));
  assert.ok(!a.mensaje.includes(a.folio) && !a.mensaje.includes(a.id_eira), "sin folio ni ID de paciente");
  assert.equal(a.entrega, null);
  assert.equal(await codigo(() => ml.listarAvisosMalla(t.medico)), "SIN_PERMISO");
  assert.equal(await codigo(() => ml.confirmarEntregaMalla(t.admin, { intentoId: a.intento_id, portador: "", app: "briar" })), "DATOS_INCOMPLETOS");
  assert.equal(await codigo(() => ml.confirmarEntregaMalla(t.admin, { intentoId: 999999, portador: "Marta Ruiz", app: "briar" })), "NO_ENCONTRADO");
  ml.confirmarEntregaMalla(t.admin, { intentoId: a.intento_id, portador: "Marta Ruiz", app: "briar" });
  assert.equal(await codigo(() => ml.confirmarEntregaMalla(t.admin, { intentoId: a.intento_id, portador: "Marta Ruiz", app: "briar" })), "YA_ENTREGADO");
  assert.deepEqual(ml.listarAvisosMalla(t.admin).find((x) => x.intento_id === a.intento_id)?.entrega?.portador, "Marta Ruiz");
});
