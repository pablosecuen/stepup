// components/CustomButton.tsx
import React from "react";
import { toast } from "sonner";
import { ShoppingCartIcon } from "@heroicons/react/24/outline";
import { useCart } from "@/app/providers/CartContextProvider";
// Asegúrate de importar el icono desde el lugar correcto

interface CustomButtonProps {
  product: any;
}

const CartButton: React.FC<CustomButtonProps> = ({ product }) => {
  const { addToCart } = useCart();
  const handleClick = () => {
    if (product) {
      addToCart(product);
    } else {
      toast.error("No se ha proporcionado un producto válido");
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex w-8 max-w-36 h-12 animate-backgroundShine items-center justify-center rounded-md  border-slate-800 
        bg-[linear-gradient(110deg,#000103,45%,#1e2631,55%,#000103)"
     transition-colors focus:outline-none focus:ring-1 focus:ring-slate-400 focus:ring-offset-1 focus:ring-offset-slate-50`}
    >
      <ShoppingCartIcon fill="transparent" />
    </button>
  );
};

export default CartButton;
