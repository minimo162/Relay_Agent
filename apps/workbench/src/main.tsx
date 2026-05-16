import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing app root");

createRoot(app).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
