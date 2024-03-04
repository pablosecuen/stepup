"use client";
import React, { useEffect, useState } from "react";
import "./style.css";
import Image from "next/image";
import logo from "@/public/assets/logo/logo.png";
import Link from "next/link";
import { UserCircleIcon } from "@heroicons/react/16/solid";
import { TicketIcon, TvIcon } from "@heroicons/react/24/outline";
import Products from "../products";
import { ZapatillaJordan, zapatillasJordan } from "@/app/data";
const SideBar = () => {
  const [selectedComponent, setSelectedComponent] = useState("");
  const [filteredProducts, setFilteredProducts] = useState(zapatillasJordan);

  const handleSearchInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const searchTerm = event.target.value.toLowerCase();
    const filtered = zapatillasJordan.filter((product: ZapatillaJordan) => {
      return (
        product.marca.toLowerCase().includes(searchTerm) ||
        product.modelo.toLowerCase().includes(searchTerm) ||
        product.color.toLowerCase().includes(searchTerm)
      );
    });
    console.log("Filtered:", filtered);
    setFilteredProducts(filtered);
  };

  const handleLinkClick = (component: any) => {
    setSelectedComponent(component);
  };

  return (
    <div className="w-full flex min-h-[80vh] relative mt-20">
      <nav className="sidebar shrink-0 w-full top-20   min-h-[90vh]">
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
                <Link
                  href="#dashboard"
                  title="dashboard"
                  className="tooltip"
                  onClick={() => handleLinkClick("products")}
                >
                  <TvIcon />
                  <span className="link hide">Dashboard</span>
                </Link>
              </li>
            </ul>

            <h2>Management</h2>
            <div className="divider"></div>
            <ul>
              <li>
                <Link
                  href="#productos"
                  title="productos"
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
                  title="tickets"
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
      <div className="w-full shrink">
        {" "}
        {selectedComponent === "products" && (
          <Products
            filteredProducts={filteredProducts}
            handleSearchInputChange={handleSearchInputChange}
          />
        )}
      </div>
    </div>
  );
};

export default SideBar;
