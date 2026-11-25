import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const AdminPage = lazy(() => import("./components/AdminPage"));
const isAdminRoute = window.location.pathname.replace(/\/+$/, "") === "/admin";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="min-h-screen bg-black p-8 text-red-200">Loading…</div>}>
      {isAdminRoute ? <AdminPage /> : <App />}
    </Suspense>
  </StrictMode>,
);
