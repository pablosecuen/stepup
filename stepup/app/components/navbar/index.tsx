"use client";
import Image from "next/image";
import Link from "next/link";
import React, { useState } from "react";
import logo from "@/public/assets/logo/logo.png";

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className=" relative border border-black">
      <div className="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4">
        <Link href="/" className="flex items-center space-x-3 rtl:space-x-reverse">
          <Image
            src={logo}
            alt="Logo"
            sizes="(max-width: 767px) 50px, 50px"
            quality={100}
            className="w-10 md:w-14"
            placeholder="blur"
          />

          <span className="self-center text-base md:text-2xl font-semibold whitespace-nowrap ">
            Sneakers
          </span>
        </Link>
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
        <div
          className={`${
            isMenuOpen ? "translate-x-0" : "translate-x-full"
          } md:translate-x-0 transform transition-transform   z-50 w-full md:w-auto mt-16 md:mt-0  absolute top-0 left-0 md:relative md:top-auto md:left-auto bg-white md:bg-transparent  md:p-0 md:space-x-8 md:flex md:flex-row md:border-0  md:items-center`}
        >
          <ul className="font-medium text-center flex flex-col p-4 md:p-0  mt-4 border border-black  md:flex-row md:space-x-8 rtl:space-x-reverse md:mt-0 md:border-0 ">
            <li>
              <Link
                href="/"
                className="block py-2 px-3 "
                aria-current="page"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
              >
                Home
              </Link>
            </li>
            <li>
              <Link
                href="/tienda"
                className="block py-2 px-3 "
                onClick={() => setIsMenuOpen(!isMenuOpen)}
              >
                Tienda
              </Link>
            </li>
            <li>
              <Link
                href="/contacto"
                className="block py-2 px-3 "
                onClick={() => setIsMenuOpen(!isMenuOpen)}
              >
                Contacto
              </Link>
            </li>
            <li>
              <Link
                href="/tracking"
                className="block py-2 px-3 "
                onClick={() => setIsMenuOpen(!isMenuOpen)}
              >
                Tracking
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
