import React from "react";
import { zapatillasJordan } from "@/app/data";
import Image from "next/image";
import RelatedCarousel from "@/app/components/carousel/related-carousel";
const Product = () => {
  const relatedZapatillas = zapatillasJordan.filter(
    (zapatilla) => zapatilla.marca === zapatillasJordan[0].marca
  );

  return (
    <>
      <div className="mt-32 grid grid-cols-12 max-w-screen-2xl  min-h-[80vh] mx-auto ">
        <div className="col-span-4 relative">
          <div className=" sticky top-0 min-h-[80vh] flex items-center justify-center">
            <div className="flex flex-col small:sticky small:top-48 small:py-0 small:max-w-[300px] w-full py-8 gap-y-6 p-20 ">
              <div id="product-info">
                <div className="flex flex-col gap-y-4 lg:max-w-[500px] mx-auto">
                  <a
                    className="text-medium text-ui-fg-muted hover:text-ui-fg-subtle"
                    href="/us/collections/merch"
                  >
                    {zapatillasJordan[0].marca}
                  </a>
                  <h2 className="font-sans font-medium h2-core text-3xl leading-10 text-ui-fg-base">
                    {zapatillasJordan[0].modelo}
                  </h2>
                  <p className="font-normal font-sans txt-medium text-ui-fg-subtle">
                    {zapatillasJordan[0].color}
                  </p>
                </div>
              </div>
              <div className="w-full">
                <div data-orientation="vertical">
                  <div
                    data-state="closed"
                    data-orientation="vertical"
                    className="border-grey-20 group border-t last:mb-0 last:border-b py-3"
                  >
                    <h3 data-orientation="vertical" data-state="closed" className="px-1">
                      <div className="flex flex-col">
                        <div className="flex w-full items-center justify-between">
                          <div className="flex items-center gap-4">
                            <p className="font-normal font-sans txt-medium text-ui-fg-subtle text-sm">
                              Product Information
                            </p>
                          </div>
                          <button
                            type="button"
                            aria-controls="radix-:r1:"
                            aria-expanded="false"
                            data-state="closed"
                            data-orientation="vertical"
                            id="radix-:r0:"
                            data-radix-collection-item=""
                          >
                            <div className="text-grey-90 hover:bg-grey-5 active:bg-grey-5 active:text-violet-60 focus:border-violet-60 disabled:text-grey-30 bg-transparent disabled:bg-transparent rounded-rounded group relative p-[6px]">
                              <div className="h-5 w-5">
                                <span className="bg-grey-50 rounded-circle group-radix-state-open:rotate-90 absolute inset-y-[31.75%] left-[48%] right-1/2 w-[1.5px] duration-300"></span>
                                <span className="bg-grey-50 rounded-circle group-radix-state-open:rotate-90 group-radix-state-open:left-1/2 group-radix-state-open:right-1/2 absolute inset-x-[31.75%] top-[48%] bottom-1/2 h-[1.5px] duration-300"></span>
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </h3>
                    <div
                      data-state="closed"
                      id="radix-:r1:"
                      role="region"
                      aria-labelledby="radix-:r0:"
                      data-orientation="vertical"
                      className="radix-state-closed:animate-accordion-close radix-state-open:animate-accordion-open radix-state-closed:pointer-events-none px-1"
                    ></div>
                  </div>
                  <div
                    data-state="closed"
                    data-orientation="vertical"
                    className="border-grey-20 group border-t last:mb-0 last:border-b py-3"
                  >
                    <h3 data-orientation="vertical" data-state="closed" className="px-1">
                      <div className="flex flex-col">
                        <div className="flex w-full items-center justify-between">
                          <div className="flex items-center gap-4">
                            <p className="font-normal font-sans txt-medium text-ui-fg-subtle text-sm">
                              Shipping &amp; Returns
                            </p>
                          </div>
                          <button
                            type="button"
                            aria-controls="radix-:r3:"
                            aria-expanded="false"
                            data-state="closed"
                            data-orientation="vertical"
                            id="radix-:r2:"
                            data-radix-collection-item=""
                          >
                            <div className="text-grey-90 hover:bg-grey-5 active:bg-grey-5 active:text-violet-60 focus:border-violet-60 disabled:text-grey-30 bg-transparent disabled:bg-transparent rounded-rounded group relative p-[6px]">
                              <div className="h-5 w-5">
                                <span className="bg-grey-50 rounded-circle group-radix-state-open:rotate-90 absolute inset-y-[31.75%] left-[48%] right-1/2 w-[1.5px] duration-300"></span>
                                <span className="bg-grey-50 rounded-circle group-radix-state-open:rotate-90 group-radix-state-open:left-1/2 group-radix-state-open:right-1/2 absolute inset-x-[31.75%] top-[48%] bottom-1/2 h-[1.5px] duration-300"></span>
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </h3>
                    <div
                      data-state="closed"
                      id="radix-:r3:"
                      role="region"
                      aria-labelledby="radix-:r2:"
                      data-orientation="vertical"
                      className="radix-state-closed:animate-accordion-close radix-state-open:animate-accordion-open radix-state-closed:pointer-events-none px-1"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-span-4  h-full flex flex-col  overflow-y-hidden">
          <div className="w-full min-h-[80vh] border flex items-center justify-center bg-gray-100">
            {" "}
            <Image
              src={zapatillasJordan[0].img}
              alt="zapatilla"
              width={0}
              height={0}
              className="object-cover w-full "
            />
          </div>

          <div className="w-full min-h-[80vh] border flex items-center justify-center bg-gray-100">
            {" "}
            <Image
              src={zapatillasJordan[1].img}
              alt="zapatilla"
              width={0}
              height={0}
              className="object-cover w-full "
            />
          </div>
          <div className="w-full min-h-[80vh] border flex items-center justify-center bg-gray-100">
            {" "}
            <Image
              src={zapatillasJordan[2].img}
              alt="zapatilla"
              width={0}
              height={0}
              className="object-cover w-full "
            />
          </div>
          <div className="w-full min-h-[80vh] border flex items-center justify-center bg-gray-100">
            {" "}
            <Image
              src={zapatillasJordan[3].img}
              alt="zapatilla"
              width={0}
              height={0}
              className="object-cover w-full "
            />
          </div>
          <div className="w-full min-h-[80vh] border flex items-center justify-center bg-gray-100">
            {" "}
            <Image
              src={zapatillasJordan[4].img}
              alt="zapatilla"
              width={0}
              height={0}
              className="object-cover w-full "
            />
          </div>
          <div className="w-full min-h-[80vh] border flex items-center justify-center bg-gray-100">
            {" "}
            <Image
              src={zapatillasJordan[5].img}
              alt="zapatilla"
              width={0}
              height={0}
              className="object-cover w-full "
            />
          </div>
        </div>
        <div className="col-span-4 relative ">
          <div className=" sticky top-0 min-h-[80vh] flex items-center justify-center flex-col">
            <div className="flex flex-col small:sticky small:top-48 small:py-0 small:max-w-[300px] w-full py-8 gap-y-12 p-20 ">
              <div className="shadow-elevation-card-rest rounded-lg max-w-4xl h-full bg-ui-bg-subtle w-full p-8">
                <div className="flex flex-col gap-y-4 center">
                  <p className="font-normal font-sans txt-medium text-ui-fg-base text-xl">
                    Descripcion relacionada a la tienda 🎉
                  </p>
                  <p className="font-normal font-sans txt-medium text-small-regular">
                    Aca podes continuar con la compra
                  </p>
                  <a href="http://localhost:7001/a/orders?onboarding_step=create_order_nextjs">
                    <button className="transition-fg relative inline-flex items-center justify-center overflow-hidden rounded-md outline-none disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden after:transition-fg after:absolute after:inset-0 after:content-[''] shadow-buttons-inverted text-ui-fg-on-inverted bg-ui-button-inverted after:button-inverted-gradient hover:bg-ui-button-inverted-hover hover:after:button-inverted-hover-gradient active:bg-ui-button-inverted-pressed active:after:button-inverted-pressed-gradient focus:!shadow-buttons-inverted-focus txt-compact-small-plus gap-x-1.5 px-3 py-1.5 w-full">
                      ir al checkout
                    </button>
                  </a>
                </div>
              </div>
              <div className="flex flex-col gap-y-2 ">
                <div>
                  <div className="flex flex-col gap-y-4">
                    <div>
                      <div className="flex flex-col gap-y-3">
                        <span className="text-sm">Eleccion de talles</span>
                        <div className="flex flex-wrap justify-between gap-2">
                          {zapatillasJordan[0].talles.map((talle: any, talleIndex: number) => {
                            const talla = Object.keys(talle)[0];

                            return (
                              <button
                                key={talleIndex}
                                className="border-ui-border-base bg-ui-bg-subtle border text-small-regular h-10 rounded-rounded p-2 flex-1 hover:shadow-elevation-card-rest transition-shadow ease-in-out duration-150"
                              >
                                {talla}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="h-px w-full border-b border-gray-200 mt-1"></div>
                  </div>
                </div>
                <div className="flex flex-col text-ui-fg-base">
                  <span className="text-xl-semi">$ {zapatillasJordan[0].precio}</span>
                </div>
                <button className="transition-fg relative inline-flex items-center justify-center overflow-hidden rounded-md outline-none disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden after:transition-fg after:absolute after:inset-0 after:content-[''] shadow-buttons-inverted text-ui-fg-on-inverted bg-ui-button-inverted after:button-inverted-gradient hover:bg-ui-button-inverted-hover hover:after:button-inverted-hover-gradient active:bg-ui-button-inverted-pressed active:after:button-inverted-pressed-gradient focus:!shadow-buttons-inverted-focus txt-compact-small-plus gap-x-1.5 px-3 py-1.5 w-full h-10">
                  Seleccionar variante
                </button>
                <div className="lg:hidden inset-x-0 bottom-0 fixed pointer-events-none"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <RelatedCarousel relatedZapatillas={relatedZapatillas} />
    </>
  );
};

export default Product;
