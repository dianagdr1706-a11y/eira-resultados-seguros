# EIRA Resultados Seguros: mapa de secciones y componentes del front

Guía para construir el front por separado. Cada sección indica **ruta**, **quién la ve**, **componentes**, **datos que muestra** y **acciones** (qué envía al backend). Los nombres de campos coinciden con el backend actual (`name="..."` de los formularios).

---

## 0. Sistema de diseño compartido

### Tokens
| Token | Uso | Valor actual (Tailwind) |
|---|---|---|
| Primario | Botones principales, marca EIRA | `rose-600` / hover `rose-700` |
| Fondo | Página | `rose-50/30` claro, tarjetas blancas |
| Texto | Cuerpo / secundario | `slate-800` / `slate-500` |
| Peligro | Errores, caídas, alertas prioritarias | `red-600` |
| Éxito | Consultado, integridad OK | `green-600` |
| Tipografía portal | Paciente (accesible) | base ≥ 18 px, botones ≥ 48 px de alto |

### Componentes base (reutilizables)
| Componente | Props clave | Notas |
|---|---|---|
| `Button` | `variant: primary \| secondary \| danger`, `size`, `disabled` | Portal: `w-full`, texto grande |
| `Input` / `Select` / `Textarea` | `label`, `name`, `error`, `hint` | Siempre con `<label htmlFor>` |
| `Checkbox` | `label`, `name`, `required` | Se usa en checklists obligatorios |
| `Card` | `title`, `children` | Contenedor de cada bloque |
| `Badge` | `estado` | Colores por estado (ver tabla de estados) |
| `Alert` | `tipo: error \| info \| exito \| advertencia` | Mensajes por `?error=` en la URL |
| `MaskedContact` | `valor`, `tipo: tel \| correo` | Muestra `•••• •• 4321` o `m•••@example.com` |
| `Timeline` | `eventos[]` (acción, actor, fecha, hash corto, detalle) | Línea de tiempo auditable |
| `Semaforo` | `color: verde \| amarillo \| rojo`, `texto` | Sugerencia Bethesda |
| `StatCard` | `label`, `valor`, `color` | Contadores del panel |
| `EmptyState` | `texto` | Listas vacías |
| `PrototypeBanner` | — | "PROTOTIPO: datos ficticios" (siempre visible en el header) |

### Estados del estudio (`Badge`)
| Estado | Etiqueta | Color |
|---|---|---|
| `cargado` | Cargado (sin asociar) | gris |
| `revision_admin` | Por revisar (Admin) | azul cielo |
| `devuelto` | Devuelto a corrección | naranja |
| `pendiente_clinica` | Por autorizar (Clínica) | violeta |
| `autorizado_digital` | Autorizado: entrega digital | esmeralda |
| `autorizado_acompanado` | Autorizado: entrega acompañada (la prioridad se muestra aparte) | rosa |
| `notificado` | Notificado sin consultar | ámbar |
| `consultado` | Consultado / Descargado | verde |
| `entregado_asistido` | Entregado (asistido) | verde azulado |

---

## 1. Público

### 1.1 Inicio: `/`
- **Ve:** cualquiera.
- **Componentes:** `Hero` (título "Resultados de Papanicolaou, seguros y sin WhatsApp" + 2 CTA: *Soy paciente* → `/portal`, *Soy personal EIRA* → `/staff/login`), `FlujoResumen` (4 pasos: Laboratorio → Admin → Médico → Paciente), `ListaImplementado` y `ListaSimulado` (dos columnas).

---

## 2. Portal de paciente (mobile-first, accesible)

Reglas: lenguaje claro, sin diagnósticos en pantalla, botones grandes, un objetivo por pantalla, contraste AA.

### 2.1 Entrada: `/portal`
- **Componentes:**
  - `PortalHeader` (logo + "Consulta tu documento").
  - `FormAcceso` → acción `iniciarAcceso`
    - `Input folio` (`name="folio"`, ej. `EIRA-00348`)
    - `Input fecha de nacimiento` (`name="dob"`, `type="date"`)
    - `MetodoSelector` (radio `name="metodo"`: `otp` "Recibir código por SMS/correo" | `pin` "Tengo un PIN de mi talón") → si es `pin`, muestra `Input pin` (`name="pin"`, 6 dígitos)
    - `Button` "Continuar"
  - `AyudaSinConectividad` ("¿No tienes celular, correo o internet?": teléfono EIRA, entrega en jornada u oficina).
  - `Alert` según `?error=`: `datos` (no coinciden), `pin` (PIN incorrecto o vencido), `limite` (demasiados intentos), `sincontacto` (sin teléfono/correo → usar PIN), `envio` (proveedores caídos), `expirado` (código vencido), `sesion` (sesión terminada).

### 2.2 Verificar código: `/portal/verificar?c=sms|correo&d=destino`
- **Componentes:** `Texto` "Enviamos un código a •••• •• 4321 por SMS", `OtpInput` (`name="codigo"`, 6 dígitos, `inputmode="numeric"`, autocompletar `one-time-code`), `Contador` (vigencia 10 min), `IntentosRestantes` (máx. 5), `Button` "Entrar", enlace "Volver / pedir otro código".
- **Acción:** `verificarOtp`.

### 2.3 Mis documentos: `/portal/resultados`
- **Componentes:**
  - `Saludo` ("Hola, {nombre}") + `Button secundario` "Salir" (acción `salirPortal`).
  - `Escuchar` (botón "Escuchar" con lectura en voz alta del texto de la página; Web Speech API).
  - `AvisoSesion` ("Tu sesión se cierra tras 15 min sin actividad").
  - Lista de `EstudioCard` (una por estudio):
    - Encabezado: folio, fecha de toma, sede.
    - `Badge` "Ya consultado" si aplica.
    - Variante **digital** (`autorizado_digital`, `notificado`, `consultado`): texto neutro + **formulario nativo** `POST /api/portal/solicitar` con `estudio_id` → botón "Ver documento" (abre PDF; enlace válido 2 min y solo con su sesión).
    - Variante **acompañada** (`autorizado_acompanado`): mensaje "Queremos entregártelo en persona" + teléfono. **Sin botón de descarga.**
    - Variante **entregada** (`entregado_asistido`): "Ya se te entregó en persona".
  - `EmptyState` "Aún no hay documentos listos".
- ⚠️ "Ver documento" debe ser `<form method="post" action="/api/portal/solicitar">` (navegación completa), no `fetch`.

---

## 3. Personal EIRA: `/staff/*`

### 3.0 Layout de personal
- `StaffHeader`: logo, `PrototypeBanner`, usuario (nombre + rol), botón "Salir" (`logoutStaff`).
- `StaffNav` (según rol):

| Enlace | laboratorio | eira_admin | medico | auditoria |
|---|---|---|---|---|
| Panel `/staff` | ✓ | ✓ | ✓ | ✓ |
| Cargar PDF `/staff/cargar` | ✓ | ✓ | | |
| Pacientes `/staff/pacientes` | | ✓ | ✓ | ✓ |
| Bandeja SMS/Correo `/staff/bandeja` | | ✓ | ✓ | ✓ |
| Bitácora `/staff/bitacora` | | ✓ | | ✓ |

### 3.1 Login: `/staff/login`
- `FormLogin` (`usuario`, `password`, "Entrar") → `loginStaff`.
- `UsuariosDemo` (tabla: laboratorio / admin / medico / auditoria, contraseña `demo`; solo prototipo).
- `Alert` según `?error=`: `credenciales`, `limite` (10 min); y `?ok=reinicio` tras reiniciar la demo.

### 3.2 Panel de estados: `/staff`
- `StatGrid`: un `StatCard` por estado (orden: cargado, revisión admin, por autorizar, devuelto, notificado, acompañamiento, consultado, entregado).
- `AlertasSeguimiento` (lista con contador):
  - **asistida**: sin canal digital o falló el envío.
  - **prioritario**: acompañamiento prioritario > 48 h sin cerrar.
  - **seguimiento**: notificado > 7 días sin consultar o acompañada rutinaria > 7 días.
  - Cada fila: folio, paciente, texto, botón "Abrir".
- `TablaEstudios`: folio, paciente (ID EIRA), sede, fecha de toma, `Badge` estado, prioridad, enlace al detalle; botones "Exportar CSV" / "Exportar JSON" (`/api/staff/export?format=csv|json`, sin nombres ni contactos).
- `ControlesDemo` (solo admin/auditoría):
  - Proveedor SMS / Correo: botón "Simular bloqueo (como WhatsApp)" ↔ "CAÍDO: restablecer" (`toggleProveedor`: `canal`, `valor`).
  - Reloj de demo: "+1 días", "+3 días", "+7 días", "Reiniciar reloj" (`avanzarReloj`: `dias`), fecha simulada actual.
  - Indicador "Valkey conectado / memoria local".
  - "Reiniciar datos de demo" (`reiniciarDemo`; cierra sesión).

### 3.3 Cargar PDF: `/staff/cargar`
- `FormCarga` → `subirPdf`: `Input file pdf` (`name="pdf"`, solo PDF), `folio_muestra` (número citológico), `fecha_toma` (date), `sede_jornada`; botón "Cargar PDF". Al terminar, redirige al detalle del estudio.
- `MuestrasDemo`: botones para descargar PDFs sintéticos por paciente (`/api/staff/muestra?...`).

### 3.4 Detalle de estudio: `/staff/estudios/[id]` (pantalla principal)
Layout de dos columnas: **izquierda** visor PDF, **derecha** paneles por paso. El panel visible depende de `estado` y `rol`.

- **Encabezado:** "← Panel", folio, `Badge` estado, prioridad.
- `VisorPdf`: iframe a `/api/staff/pdf/[id]` + pie con SHA-256, nombre de archivo y tamaño.
- `PacienteAsociada`: nombre, ID EIRA, nacimiento, municipio, `MaskedContact` teléfono/correo, canal preferido, toma/sede, Bethesda.
- **Paso 1. Asociar con comprobación de identidad** (admin; estados `cargado` o `devuelto`):
  - `BuscadorPaciente` (`q`, `dob`, `ide`) → "Buscar".
  - `ResultadosBusqueda`: radio `paciente_id` por resultado; **`AlertaHomonimas`** si hay ≥ 2 con el mismo nombre ("mismo nombre: verifica fecha e ID").
  - `ChecklistIdentidad` (todos obligatorios): `chk_nombre`, `chk_nacimiento`, `chk_folio`, `chk_legible`.
  - Botón "Confirmar asociación" → `asociarPaciente`.
- **Paso 2. Revisión administrativa** (admin; `revision_admin`): `comentarios` + "Aprobar y enviar a médico" (`decision=aprobar`) / "Devolver" (`decision=devolver`) → `revisionAdmin`.
- **Paso 3. Autorización clínica** (médico; `pendiente_clinica`):
  - `BethesdaSelector` (`name="bethesda"`, 12 categorías del formato EIRA) → `Semaforo` en vivo:
    - VERDE: negativa → sugiere **entrega digital**.
    - AMARILLO: ASC-US, LSIL, muestra inadecuada → sugiere **acompañada** (7 días).
    - ROJO: ASC-H, HSIL, carcinoma, AGC, adenocarcinoma → **acompañada prioritaria** (48 h).
  - `comentarios`; botones "Autorizar entrega digital" (`decision=digital`) / "Autorizar entrega acompañada" (`decision=acompanado`) → `autorizacionClinica`. La decisión final es del médico; mostrar si coincide o no con la sugerencia.
- `EnEspera`: si el rol no corresponde ("En espera de revisión administrativa / autorización clínica").
- **Paso 4. Entrega asistida / seguimiento** (admin o médico; `autorizado_*` o `notificado`):
  - Admin: botón "Reintentar notificación" / "Enviar recordatorio neutro" (`reintentarNotificacion`).
  - `FormEntrega` → `registrarEntrega`: `modalidad` (presencial EIRA, jornada, centro de salud, llamada, tercero autorizado, orientación médica), `resultado` (`entregado` cierra el caso; intentos: `no_contesta`, `cita_agendada`, `numero_incorrecto`), `chk_identidad`, `acuse` (nombre de quien recibe), `observaciones`; botón "Registrar".
- `Revisiones`: lista de revisiones admin/clínica (decisión, quién, cuándo).
- `EntregasIntentos`: tabla de entregas e intentos.
- `Timeline` "Línea de tiempo auditable": acción, actor (rol), IP, fecha, hash corto, detalle JSON.

### 3.5 Pacientes: `/staff/pacientes`
- `TablaPacientes`: ID EIRA, nombre, nacimiento, municipio, `MaskedContact` teléfono/correo, canal preferido (`sms`, `correo`, `asistido`), # estudios.
- Admin: botón por fila "Generar talón con PIN" (`generarPin`: `paciente_id`).

### 3.6 Talón imprimible: `/staff/pacientes/[id]/talon`
- `Talon` (tamaño media carta, optimizado para `@media print`): logo EIRA, nombre, ID EIRA, **PIN personal (6 dígitos)**, **QR** al portal, pasos "Entra a … con tu folio, fecha de nacimiento y PIN", alternativa "Llama al 341 410 8111 o acude a tu jornada", vigencia (60 días).
- `PrintButton` "Imprimir talón" (oculto al imprimir). El PIN solo se muestra una vez (5 min).

### 3.7 Bandeja simulada: `/staff/bandeja`
- `EstadoProveedores` (SMS / correo: OK o CAÍDO).
- `TablaMensajes`: fecha, canal, destino enmascarado, tipo (`disponible`, `acompanado`, `otp`, `seguimiento`), texto, estado (enviado / fallido), `Badge` "✓ sin términos clínicos".

### 3.8 Bitácora: `/staff/bitacora`
- `EstadoCadena`: "Cadena íntegra" (verde) o "Rota en el registro N" (rojo) + total de registros.
- `DemoInmutabilidad`: botón "Intentar alterar un registro" → resultado "UPDATE rechazado por la base de datos".
- `TablaBitacora`: #, fecha, actor, acción, estudio, IP, hash (truncado), hash previo.

---

## 4. Endpoints que consume el front

| Método y ruta | Uso | Respuesta |
|---|---|---|
| `POST /api/portal/solicitar` (form `estudio_id`) | Pedir documento (paciente) | 303 → `/api/portal/descarga?t=…` |
| `GET /api/portal/descarga?t=` | PDF de la paciente | PDF `no-store` o HTML "Acceso denegado" 401/403 |
| `GET /api/staff/pdf/[id]` | Visor PDF del personal | PDF |
| `GET /api/staff/muestra?...` | PDFs sintéticos de demo | PDF adjunto |
| `GET /api/staff/export?format=csv\|json` | Exportación sin PII | CSV / JSON |

El resto de las acciones son **Server Actions** de Next.js (`src/app/staff/actions.ts`, `src/app/portal/actions.ts`). Si el front nuevo es un proyecto aparte (no Next), hay que exponerlas como endpoints REST con los mismos campos.

---

## 5. Guion de demo (orden de pantallas)
1. `/staff` como **admin**: panel, alertas y botón "Simular bloqueo".
2. `/staff/cargar` → subir PDF → **detalle**: buscar "maria guadalupe" → alerta de homónimas → checklist → aprobar.
3. Como **medico**: Bethesda → semáforo → autorizar.
4. `/staff/bandeja`: aviso neutro (sin diagnóstico).
5. `/portal` (celular): folio + nacimiento → OTP → "Ver documento".
6. Abrir el mismo enlace sin sesión → "Acceso denegado".
7. `/staff/pacientes` → talón con PIN para EIRA-00507 → entrar con PIN.
8. Simular caída SMS → el aviso pasa a correo o a entrega asistida.
9. Reloj +7 días → alerta de seguimiento.
10. `/staff/bitacora` → "Intentar alterar" → rechazado.
