import { ShoppingCartIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

export default function OpenCart({ className, cart }: { className?: string; cart?: any }) {
  const cartItemCount = cart.length;

  return (
    <div className="relative cursor-pointer flex md:h-11 md:w-11 h-8 w-8 items-center justify-center rounded-md   text-black transition-colors dark:border-neutral-700 dark:text-white">
      <ShoppingCartIcon
        className={clsx(
          "h-6 md:h-8 transition-all ease-in-out hover:scale-110 text-black",
          className
        )}
      />
      {cartItemCount !== 0 ? (
        <div className="absolute right-0 top-1 md:top-0 -mr-2 -mt-2 h-4 w-4 rounded-full bg-red-500 bg-primario text-[11px] font-medium text-red"></div>
      ) : null}{" "}
    </div>
  );
}
