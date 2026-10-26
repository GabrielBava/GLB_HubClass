import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { BrandingProvider } from "./lib/branding";
import { ToastProvider } from "./components/toast";
import { TooltipLayer } from "./components/Tooltip";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

async function start() {
  // Build de demonstração (arquivo HTML único, sem servidor): API simulada e rotas por hash.
  const demo = import.meta.env.MODE === "demo";
  let extra: ReactNode = null;
  if (demo) {
    const [{ installDemo }, { DemoBar }] = await Promise.all([import("./demo/mock"), import("./demo/DemoBar")]);
    if (window.__LC_DEMO__) installDemo(window.__LC_DEMO__);
    extra = <DemoBar />;
  }
  const Router = demo ? HashRouter : BrowserRouter;

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrandingProvider>
          <ToastProvider>
            <AuthProvider>
              <Router>
                <App />
                <TooltipLayer />
                {extra}
              </Router>
            </AuthProvider>
          </ToastProvider>
        </BrandingProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
