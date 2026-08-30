import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

/**
 * App is imported DYNAMICALLY on purpose.
 *
 * supabaseClient throws while it is being evaluated when an env var is
 * missing, and a static import is evaluated before any statement in this
 * module runs - so a plain try/catch around render never sees it and the page
 * goes blank with no message anywhere. Moving the import inside the promise
 * chain puts the whole module graph, including that throw, inside .catch().
 */
import("./App.js")
  .then(({ App }) => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    root.textContent = `Không khởi động được ứng dụng — ${message}`;
    root.setAttribute("style", "padding:2rem;font-family:system-ui;color:#b00");
  });
