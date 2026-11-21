/** Error de negocio con código estable; la API lo traduce a JSON y los formularios a un mensaje. */
export class ErrorDominio extends Error {
  constructor(public codigo: string, mensaje: string, public http = 400, public datos?: unknown) {
    super(mensaje);
  }
}

export const noEncontrado = (que: string) => new ErrorDominio("NO_ENCONTRADO", `${que} no existe`, 404);
