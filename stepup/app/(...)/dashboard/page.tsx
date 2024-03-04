import React from "react";
import { auth } from "@clerk/nextjs/server";
const Dashboard = () => {
  auth().protect();
  return <div>Dashboard</div>;
};

export default Dashboard;
