/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import React from "react";
import "./footer.css";
import Image from "next/image";
import logo from "@/public/assets/logo/logo.png";
import TwitterIcon from "../icons/twitter-icon";
import GitHubIcon from "../icons/github-icon";
import DiscordIcon from "../icons/discord-icon";
import YouTubeIcon from "../icons/youtube-icon";
import DiscordIcon2 from "../icons/discord-icon-2";
import GitHubIcon2 from "../icons/github-icon-2";
import PortfolioIcon from "../icons/portfolio-icon";
import LinkedInIcon from "../icons/linkedin-icon";
const Footer = () => {
  return (
    <footer className="h-full max-w-7xl mx-auto bg-white border-t-2 border-blue-500/40">
      <div className="footer-wrapper py-10">
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
                      <TwitterIcon />
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="GitHub">
                      <GitHubIcon />
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="Discord">
                      <DiscordIcon />
                    </Link>
                  </li>
                  <li>
                    <Link href="#" title="Youtube">
                      <YouTubeIcon />
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

    
      <div className="sm:flex sm:items-center sm:justify-between p-4 max-w-7xl mx-auto border-t-2 border-blue-500/40 ">
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
            <DiscordIcon2 />
            <span className="sr-only">Discord</span>
          </Link>
          <Link
            href="https://github.com/pablosecuen"
            className=" hover:text-gray-900 dark:hover:text-white ms-5"
          >
            <GitHubIcon2 />
            <span className="sr-only">GitHub account</span>
          </Link>
          <Link
            href="https://pablosecuen.github.io/portfolio/"
            className=" hover:text-gray-900 dark:hover:text-white ms-5"
          >
            <PortfolioIcon />
            <span className="sr-only">Portfolio</span>
          </Link>
          <Link
            href="https://www.linkedin.com/in/pablo-j-amico/"
            className=" hover:text-gray-900 dark:hover:text-white ms-5"
          >
            <LinkedInIcon />
            <span className="sr-only">Linked In</span>
          </Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
