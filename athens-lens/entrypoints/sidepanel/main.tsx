import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App";
import "../../src/styles/tokens.css";
import "../../src/styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Athens Lens could not find its application root.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
