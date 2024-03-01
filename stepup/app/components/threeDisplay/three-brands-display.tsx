import Link from "next/link";

const ThreeBrandsDisplay = () => {
  return (
    <div className="grid gap-4 grid-cols-2 grid-rows-2 min-h-[80vh] border max-w-screen-2xl w-full my-20">
      <div className="col-span-1 row-span-2 bg-red-500 relative overflow-hidden shadow-lg shadow-black/40 flex items-center justify-center text-center">
        <Link
          href="/tienda?marca=nike"
          className="text-7xl text-white uppercase tracking-widest z-10 relative hover:scale-105 transition duration-300"
        >
          NIKE
        </Link>
        <div className="absolute inset-0 bg-jumpman bg-cover bg-center transform origin-center scale-100 hover:scale-105 transition duration-300"></div>
      </div>
      <div className="col-span-1 row-span-1 bg-blue-500 relative overflow-hidden shadow-lg shadow-black/40 flex items-center justify-center text-center">
        <Link
          href="/tienda?marca=adidas"
          className="text-7xl text-white uppercase tracking-widest z-10 relative hover:scale-105 transition duration-300"
        >
          adidas
        </Link>
        <div className="absolute inset-0 bg-messi bg-cover bg-center transform origin-center scale-100 hover:scale-105 transition duration-300"></div>
      </div>
      <div className="col-span-1 row-span-1 bg-green-500 relative overflow-hidden shadow-lg shadow-black/40 flex items-center justify-center text-center">
        <Link
          href="/tienda?marca=puma"
          className="text-7xl text-white uppercase tracking-widest z-10 relative hover:scale-105 transition duration-300"
        >
          Puma
        </Link>
        <div className="absolute inset-0 bg-bolt bg-cover bg-center transform origin-center scale-100 hover:scale-105 transition duration-300"></div>
      </div>
    </div>
  );
};

export default ThreeBrandsDisplay;
