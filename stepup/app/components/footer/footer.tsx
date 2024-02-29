/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import React from "react";
import "./footer.css";
import Image from "next/image";
import logo from "@/public/assets/logo/logo.png";
const Footer = () => {
  return (
    <footer className="h-full max-w-7xl mx-auto">
      <hr className=" border-blue-500 sm:mx-auto dark:border-gray-700  lg:mt-10 bg-blue-600 border w-full opacity-40 mb-4" />
      <div className="footer-wrapper">
        <div className="flex flex-col md:flex-row">
          <div className="">
            <Link href="/" aria-label="Go to  homepage" title="Go to  Homepage">
              <Image
                src={logo}
                loading="lazy"
                alt="Supabase logo"
                className="footer-logo w-24 mx-auto"
                width={0}
                height={0}
              />
            </Link>
            <div className="mx-20 hidden md:block">
              <div className="social-links">
                <ul>
                  <li>
                    <Link href="#" title="Twitter">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="icon icon-tabler icon-tabler-brand-x"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        stroke-width="1.5"
                        stroke="#000000"
                        fill="none"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path stroke="none" d="M0 0h24v24H0z" fill="#none" />
                        <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
                        <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
                      </svg>
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="GitHub">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="bg-clack"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        stroke-width="1.5"
                        stroke="#000000"
                        fill="none"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                        <path d="M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5" />
                      </svg>
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="Discord">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="icon icon-tabler icon-tabler-brand-discord"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        stroke-width="1.5"
                        stroke="currentColor"
                        fill="none"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                        <path d="M8 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
                        <path d="M14 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
                        <path d="M15.5 17c0 1 1.5 3 2 3c1.5 0 2.833 -1.667 3.5 -3c.667 -1.667 .5 -5.833 -1.5 -11.5c-1.457 -1.015 -3 -1.34 -4.5 -1.5l-.972 1.923a11.913 11.913 0 0 0 -4.053 0l-.975 -1.923c-1.5 .16 -3.043 .485 -4.5 1.5c-2 5.667 -2.167 9.833 -1.5 11.5c.667 1.333 2 3 3.5 3c.5 0 2 -2 2 -3" />
                        <path d="M7 16.5c3.5 1 6.5 1 10 0" />
                      </svg>
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="Youtube">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="icon icon-tabler icon-tabler-brand-youtube"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        stroke-width="1.5"
                        stroke="currentColor"
                        fill="none"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                        <path d="M2 8a4 4 0 0 1 4 -4h12a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-12a4 4 0 0 1 -4 -4v-8z" />
                        <path d="M10 9l5 3l-5 3z" />
                      </svg>
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div className="link-columns">
            <div>
              <section>
                <h3>Producto</h3>
                <ul>
                  <li>
                    <Link href="#" title="Features">
                      Nuestra tienda
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="Auth">
                      Envios a todo el pais
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="Functions">
                      Seguimiento en tiempo real
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="Realtime">
                      Control de calidad
                    </Link>
                  </li>
                </ul>
              </section>
            </div>
            <div>
              <section>
                <h3>Company</h3>
                <ul>
                  <li>
                    <Link href="#" title="Privacy Policy">
                      Feedback de clientes
                    </Link>
                  </li>

                  <li>
                    <Link href="#" title="Company">
                      Nosotros
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="Terms Of Service">
                      Terminos de servicio
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="Privacy Policy">
                      Politica de privadidad
                    </Link>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      </div>

      <hr className=" border-blue-500 sm:mx-auto dark:border-gray-700  lg:mt-10 bg-blue-600 border w-full opacity-40" />
      <div className="sm:flex sm:items-center sm:justify-between p-4 max-w-7xl mx-auto">
        <span className="text-sm md:text-md  sm:text-center ">
          <Link href="https://pablosecuen.github.io/portfolio/" className="hover:underline ml-2">
            Pablo Amico
          </Link>
          © {new Date().getFullYear()}. All Rights Reserved.
        </span>
        <div className="flex mt-4 justify-center sm:mt-0">
          <Link
            href="https://discord.com/users/1022235944138584074"
            className=" hover:text-gray-900 dark:hover:text-white ms-5"
          >
            <svg
              className="w-4 h-4"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              viewBox="0 0 21 16"
            >
              <path d="M16.942 1.556a16.3 16.3 0 0 0-4.126-1.3 12.04 12.04 0 0 0-.529 1.1 15.175 15.175 0 0 0-4.573 0 11.585 11.585 0 0 0-.535-1.1 16.274 16.274 0 0 0-4.129 1.3A17.392 17.392 0 0 0 .182 13.218a15.785 15.785 0 0 0 4.963 2.521c.41-.564.773-1.16 1.084-1.785a10.63 10.63 0 0 1-1.706-.83c.143-.106.283-.217.418-.33a11.664 11.664 0 0 0 10.118 0c.137.113.277.224.418.33-.544.328-1.116.606-1.71.832a12.52 12.52 0 0 0 1.084 1.785 16.46 16.46 0 0 0 5.064-2.595 17.286 17.286 0 0 0-2.973-11.59ZM6.678 10.813a1.941 1.941 0 0 1-1.8-2.045 1.93 1.93 0 0 1 1.8-2.047 1.919 1.919 0 0 1 1.8 2.047 1.93 1.93 0 0 1-1.8 2.045Zm6.644 0a1.94 1.94 0 0 1-1.8-2.045 1.93 1.93 0 0 1 1.8-2.047 1.918 1.918 0 0 1 1.8 2.047 1.93 1.93 0 0 1-1.8 2.045Z" />
            </svg>
            <span className="sr-only">Discord</span>
          </Link>
          <Link
            href="https://github.com/pablosecuen"
            className=" hover:text-gray-900 dark:hover:text-white ms-5"
          >
            <svg
              className="w-4 h-4"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 .333A9.911 9.911 0 0 0 6.866 19.65c.5.092.678-.215.678-.477 0-.237-.01-1.017-.014-1.845-2.757.6-3.338-1.169-3.338-1.169a2.627 2.627 0 0 0-1.1-1.451c-.9-.615.07-.6.07-.6a2.084 2.084 0 0 1 1.518 1.021 2.11 2.11 0 0 0 2.884.823c.044-.503.268-.973.63-1.325-2.2-.25-4.516-1.1-4.516-4.9A3.832 3.832 0 0 1 4.7 7.068a3.56 3.56 0 0 1 .095-2.623s.832-.266 2.726 1.016a9.409 9.409 0 0 1 4.962 0c1.89-1.282 2.717-1.016 2.717-1.016.366.83.402 1.768.1 2.623a3.827 3.827 0 0 1 1.02 2.659c0 3.807-2.319 4.644-4.525 4.889a2.366 2.366 0 0 1 .673 1.834c0 1.326-.012 2.394-.012 2.72 0 .263.18.572.681.475A9.911 9.911 0 0 0 10 .333Z"
                clipRule="evenodd"
              />
            </svg>
            <span className="sr-only">GitHub account</span>
          </Link>
          <Link
            href="https://pablosecuen.github.io/portfolio/"
            className=" hover:text-gray-900 dark:hover:text-white ms-5"
          >
            <svg
              className="w-4 h-4"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 0a10 10 0 1 0 10 10A10.009 10.009 0 0 0 10 0Zm6.613 4.614a8.523 8.523 0 0 1 1.93 5.32 20.094 20.094 0 0 0-5.949-.274c-.059-.149-.122-.292-.184-.441a23.879 23.879 0 0 0-.566-1.239 11.41 11.41 0 0 0 4.769-3.366ZM8 1.707a8.821 8.821 0 0 1 2-.238 8.5 8.5 0 0 1 5.664 2.152 9.608 9.608 0 0 1-4.476 3.087A45.758 45.758 0 0 0 8 1.707ZM1.642 8.262a8.57 8.57 0 0 1 4.73-5.981A53.998 53.998 0 0 1 9.54 7.222a32.078 32.078 0 0 1-7.9 1.04h.002Zm2.01 7.46a8.51 8.51 0 0 1-2.2-5.707v-.262a31.64 31.64 0 0 0 8.777-1.219c.243.477.477.964.692 1.449-.114.032-.227.067-.336.1a13.569 13.569 0 0 0-6.942 5.636l.009.003ZM10 18.556a8.508 8.508 0 0 1-5.243-1.8 11.717 11.717 0 0 1 6.7-5.332.509.509 0 0 1 .055-.02 35.65 35.65 0 0 1 1.819 6.476 8.476 8.476 0 0 1-3.331.676Zm4.772-1.462A37.232 37.232 0 0 0 13.113 11a12.513 12.513 0 0 1 5.321.364 8.56 8.56 0 0 1-3.66 5.73h-.002Z"
                clipRule="evenodd"
              />
            </svg>
            <span className="sr-only">Portfolio</span>
          </Link>
          <Link
            href="https://www.linkedin.com/in/pablo-j-amico/"
            className=" hover:text-gray-900 dark:hover:text-white ms-5"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="currentColor"
            >
              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
            </svg>
            <span className="sr-only">Linked In</span>
          </Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
