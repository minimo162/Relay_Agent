import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@copilotkit/react-core/v2/styles.css";
import "@copilotkit/react-ui/v2/styles.css";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing app root");

createRoot(app).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
