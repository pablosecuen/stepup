import { ZapatillaJordan } from "@/app/data";
import { MinusIcon, PlusIcon } from "@heroicons/react/24/outline";

import clsx from "clsx";
import { toast } from "sonner";

interface EditItemQuantityButtonProps {
  item: ZapatillaJordan;
  type: "plus" | "minus";
  onUpdateQuantity: () => void; // Función de actualización
}

export default function EditItemQuantityButton({
  item,
  type,
  onUpdateQuantity,
}: EditItemQuantityButtonProps) {
  const handleQuantityChange = () => {
    // Clonar el item para no modificar el original directamente
    const updatedItem = { ...item, quantity: item.quantity || 0 };

    if (type === "plus" && updatedItem.quantity) {
      updatedItem.quantity += 1;
      toast.success(`Unidad agregada al carrito. Total: ${item.quantity}`);
    } else if (type === "minus" && updatedItem.quantity > 1) {
      updatedItem.quantity -= 1;
      toast.success(`Unidad restada del carrito. Total: ${item.quantity}`);
    }

    const storedCartString = localStorage.getItem("SneakersCart");
    let cart = storedCartString ? JSON.parse(storedCartString) : [];

    const itemIndex = cart.findIndex((cartItem: any) => cartItem.id === updatedItem.id);

    if (itemIndex !== -1) {
      cart[itemIndex].quantity = updatedItem.quantity;
      localStorage.setItem("SneakersCart", JSON.stringify(cart));

      // Llamar a la función de actualización proporcionada por el componente padre
      onUpdateQuantity();
    }
  };

  return (
    <button
      aria-label={type === "plus" ? "Increase item quantity" : "Reduce item quantity"}
      onClick={handleQuantityChange}
      className={clsx(
        "ease flex h-full min-w-[36px] max-w-[36px] flex-none items-center justify-center rounded-full px-2 transition-all duration-200 hover:border-neutral-800 hover:opacity-80",
        {
          "ml-auto": type === "minus",
        }
      )}
    >
      {type === "plus" ? (
        <PlusIcon className="h-4 w-4 dark:text-neutral-500" />
      ) : (
        <MinusIcon className="h-4 w-4 dark:text-neutral-500" />
      )}
    </button>
  );
}
