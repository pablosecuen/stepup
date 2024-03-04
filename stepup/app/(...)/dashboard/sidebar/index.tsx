"use client";
import React, { useEffect, useState } from "react";
import "./style.css";
import Image from "next/image";
import logo from "@/public/assets/logo/logo.png";
import Link from "next/link";
import { UserCircleIcon } from "@heroicons/react/16/solid";
import { TicketIcon, TvIcon } from "@heroicons/react/24/outline";
import Products from "../products";
const SideBar = () => {
  const [selectedComponent, setSelectedComponent] = useState("");

  const handleLinkClick = (component: any) => {
    setSelectedComponent(component);
  };

  return (
    <div className=" w-full flex min-h-[80vh] relative">
      <nav className="sidebar shrink-0 w-full ">
        <div className="sidebar-top-wrapper">
          <div className="sidebar-top">
            <Link href="#" className="logo__wrapper">
              <Image src={logo} width={0} height={0} alt="Logo" className="logo-small" />
              <span className="hide company-name">Sneakers</span>
            </Link>
          </div>
        </div>
        <div className="sidebar-links-wrapper">
          <div className="sidebar-links">
            <ul>
              <li>
                <div className="tooltip whitespace-nowrap flex gap-2 ml-3">
                  <TvIcon />

                  <span className="link hide">Dashboard</span>
                </div>
              </li>
            </ul>

            <h2>Management</h2>
            <div className="divider"></div>
            <ul>
              <li>
                <Link
                  href="#productos"
                  title="Time Tracking"
                  className="tooltip"
                  onClick={() => handleLinkClick("products")}
                >
                  <UserCircleIcon />
                  <span className="link hide">Productos</span>
                </Link>
              </li>
              <li>
                <Link
                  href="#tickets"
                  title="Time Tracking"
                  className="tooltip"
                  onClick={() => handleLinkClick("tickets")}
                >
                  <TicketIcon />
                  <span className="link hide">tickets</span>
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="sidebar__profile">
          <div className="avatar__wrapper">
            <Image className="avatar" src={logo} alt="Picture" width={50} height={50} />
            <div className="online__status"></div>
          </div>
          <div className="avatar__name hide">
            <div className="user-name">Admin</div>
            <div className="email"></div>
          </div>
        </div>
      </nav>
      {/*       {selectedComponent === "dashboard" && <Dashboard />}
      {selectedComponent === "tickets" && <Tickets />} */}
      <div className="w-full shrink"> {selectedComponent === "products" && <Products />}</div>
    </div>
  );
};

export default SideBar;
