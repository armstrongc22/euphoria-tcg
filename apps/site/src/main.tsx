import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./fx-tokens.css";
import "./styles.css";
import "./hub.css";
import "./shop.css";

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error("#root mount point missing from index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
