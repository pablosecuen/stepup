import { XMarkIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useTransition } from "react";
import { toast } from "sonner";
import LoadingDots from "./loading-dots";

export default function DeleteItemButton({
  item,
  onDelete,
}: {
  item: any;
  onDelete: (itemId: string) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleDeleteClick = async () => {
    startTransition(async () => {
      try {
        // Llamar a la función onDelete del padre pasándole el ID del producto
        onDelete(item.id);
      } catch (error) {
        console.error("Error al eliminar el producto al carrito:", error);
      }
    });
  };

  return (
    <button
      aria-label="Remove cart item"
      onClick={handleDeleteClick}
      disabled={isPending}
      className={clsx(
        "ease flex h-[17px] w-[17px] items-center justify-center rounded-full bg-neutral-500 transition-all duration-200",
        {
          "cursor-not-allowed px-0": isPending,
        }
      )}
    >
      {isPending ? (
        <LoadingDots className="bg-white" />
      ) : (
        <XMarkIcon className="hover:text-accent-3 mx-[1px] h-4 w-4 text-white dark:text-black" />
      )}
    </button>
  );
}
