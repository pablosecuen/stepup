"use client";

import { QueryClient, QueryClientProvider } from "react-query";
import { ProductsProvider } from "./providers/ProductsContextProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { esES } from "@clerk/localizations";
import { CartProvider } from "./providers/CartContextProvider";

const queryClient = new QueryClient();

const MainProvider = ({ children }: any) => {
  return (
    <QueryClientProvider client={queryClient}>
      <ProductsProvider>
        <ClerkProvider localization={esES}>
          <CartProvider>{children}</CartProvider>
        </ClerkProvider>
      </ProductsProvider>
    </QueryClientProvider>
  );
};

export default MainProvider;
