/* eslint-disable @next/next/no-img-element */

import Link from "next/link";

const Failure = () => {
  return (
    <div className="min-h-screen w-full flex-col flex justify-center items-center md:text-xl p-20">
      hubo un error al procesar su pago, consulte con su banco o su emisora para poder continuar,
      mientras tanto lo invitamos a seguir navegando
      <Link href="/" className="bg-blue-900 py-1 px-4 text-white mt-10">
        volver al sitio
      </Link>
    </div>
  );
};

export default Failure;
