import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

function renderBootError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  root.render(
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "Arial, sans-serif" }}>
      <section style={{ maxWidth: 560, border: "1px solid #f2b8b5", borderRadius: 16, padding: 24, background: "#fff7f6", color: "#681c1c" }}>
        <h1 style={{ marginTop: 0 }}>Portal temporariamente indisponível</h1>
        <p>O sistema encontrou uma falha ao iniciar. Atualize esta página para tentar novamente.</p>
        <small style={{ opacity: 0.75 }}>{message}</small>
      </section>
    </main>
  );
}

void import("./App")
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  })
  .catch(renderBootError);

