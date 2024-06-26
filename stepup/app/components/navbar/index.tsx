"use client";
import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import logo from "@/public/assets/logo/logo.png";
import Cart from "../cart/Cart";

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const navbar = document?.querySelector("nav");
      let lastScrollTop = 0;
      if (navbar) {
        window.addEventListener(
          "scroll",
          () => {
            const scrollY = window.scrollY || window.pageYOffset;

            if (scrollY > lastScrollTop) {
              navbar.classList.add("-translate-y-28");
              navbar.classList.remove("translate-y-0");
            } else if (scrollY < lastScrollTop) {
              navbar.classList.add("translate-y-0");
              navbar.classList.remove("-translate-y-28");
            }

            lastScrollTop = scrollY > 0 ? scrollY : 0;
          },
          { passive: true }
        );
      }
    }
  }, []);

  return (
    <div className="w-full">
      <nav className=" fixed bg-white md:bg-transparent top-0 p-4 md:p-0 md:top-8 right-0 left-0 translate-x-0 max-w-7xl mx-auto  transition duration-200   z-50  md:rounded-full ">
        <div className="max-w-screen-xl flex  items-center justify-between mx-auto ">
          <div className="md:w-1/5">
            {" "}
            <Link
              href="/"
              className="flex items-center space-x-3 rtl:space-x-reverse rounded-full  "
            >
              <Image
                src={logo}
                alt="Logo"
                sizes="(max-width: 767px) 50px, 50px"
                quality={100}
                className="w-10 md:w-14 "
                placeholder="blur"
                width={0}
                height={0}
              />

              <span
                style={{ textShadow: "4px 4px 6px rgba(0, 0, 0, 0.1)" }}
                className="self-center text-base md:text-2xl font-semibold whitespace-nowrap drop-shadow-xl shadow-black "
              >
                Sneakers
              </span>
            </Link>
          </div>
          <div className="md:w-3/5 flex justify-center ">
            <div
              className={`${
                isMenuOpen ? "translate-x-0" : "translate-x-full w-0 overflow-hidden md:w-auto "
              } md:translate-x-0 transform transition-transform z-50 w-full md:w-auto mt-16 md:mt-0 absolute top-0 left-0 md:relative md:top-auto md:left-auto bg-white md:bg-transparent md:p-0 md:space-x-8 md:flex md:flex-row md:border-0 md:items-center`}
            >
              <ul className="font-medium text-center flex flex-col p-4 md:p-0 md:font-semibold md:uppercase md:tracking-widest    md:flex-row md:space-x-8 rtl:space-x-reverse mt-0 border border-black md:border-0 md:rounded-full  ">
                <li>
                  <Link
                    href="/"
                    className="block py-2 px-3 "
                    aria-current="page"
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    style={{ textShadow: "4px 4px 6px rgba(0, 0, 0, 0.1)" }}
                  >
                    Home
                  </Link>
                </li>
                <li>
                  <Link
                    href="/tienda"
                    className="block py-2 px-3 "
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    style={{ textShadow: "4px 4px 6px rgba(0, 0, 0, 0.1)" }}
                  >
                    Tienda
                  </Link>
                </li>
                <li>
                  <Link
                    href="/contacto"
                    className="block py-2 px-3 "
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    style={{ textShadow: "4px 4px 6px rgba(0, 0, 0, 0.1)" }}
                  >
                    Contacto
                  </Link>
                </li>
                <li>
                  <Link
                    href="/tracking"
                    className="block py-2 px-3 "
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    style={{ textShadow: "4px 4px 6px rgba(0, 0, 0, 0.1)" }}
                  >
                    Tracking
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex items-center justify-end md:w-1/5 gap-4">
            <Cart />
            <button
              type="button"
              className="inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-expanded={isMenuOpen}
            >
              <span className="sr-only">Open main menu</span>
              <svg
                className="w-5 h-5"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 17 14"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M1 1h15M1 7h15M1 13h15"
                />
              </svg>
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
};

export default Navbar;
