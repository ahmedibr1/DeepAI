/* Entry point for the self-contained Phase 1 demo: the real portal UI and the real DeepDive Builder,
   with the API replaced by an in-browser implementation of the same rules. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "../portal/App";
import { AuthProvider } from "../portal/auth/AuthContext";
import { ToastProvider } from "../portal/components/ui";
import "../portal/styles.css";
import { DemoBar } from "./DemoBar";
import { DemoErrorBoundary } from "./ErrorBoundary";
import "./demo.css";
import { applyAppearance } from "../portal/pages/admin/AppearancePage";

applyAppearance();
import { installMockApi } from "./mockApi";

import "./injectBuilder";

installMockApi();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <DemoErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <App />
            <DemoBar />
          </ToastProvider>
        </AuthProvider>
      </DemoErrorBoundary>
    </HashRouter>
  </StrictMode>,
);
