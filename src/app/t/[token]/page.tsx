import Llavero from "./Llavero";

export const dynamic = "force-dynamic";

/** Pantalla que se abre al acercar el llavero NFC (o escanear su QR) en el kiosco o el celular del voluntario. */
export default function Page({ params }: { params: { token: string } }) {
  return <Llavero token={params.token} />;
}
