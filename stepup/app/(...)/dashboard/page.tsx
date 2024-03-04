import React from "react";
import { auth } from "@clerk/nextjs/server";
import SideBar from "./sidebar";
const Dashboard = () => {
  auth().protect();


  return (
    <div className="mt-24 min-h-screen">
      <SideBar />
    </div>
  );
};

export default Dashboard;
