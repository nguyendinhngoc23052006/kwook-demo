import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// A startup failure must render as visible text, never a blank page.
try {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (e) {
  root.textContent = `Không khởi động được ứng dụng: ${(e as Error).message}`;
}
