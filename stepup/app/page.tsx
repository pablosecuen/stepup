import ProductsCarousel from "./components/carousel/products-carousel";
import Landing from "./components/landing";

export default function Home() {
  return (
    <main className="flex  flex-col items-center  min-h-screen h-full">
      <Landing />
   
      <ProductsCarousel />
    </main>
  );
}
