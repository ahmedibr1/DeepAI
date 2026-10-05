/* Entry point for the self-contained Phase 1 demo: the real portal UI and the real DeepDive Builder,
   with the API replaced by an in-browser implementation of the same rules. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "../portal/App";
import { AuthProvider } from "../portal/auth/AuthContext";
import { ToastProvider } from "../portal/components/ui";
import "../portal/styles.css";
import { DemoErrorBoundary } from "./ErrorBoundary";
import "./demo.css";
import { applyAppearance } from "../portal/pages/admin/AppearancePage";

applyAppearance();
import { installMockApi } from "./mockApi";

import "./injectBuilder";
import "./folderTestHook";

installMockApi();
// One person uses this portal; the shell hides sign-out and account switching.
(window as unknown as { __DEEPAI_SINGLE_USER__?: boolean }).__DEEPAI_SINGLE_USER__ = true;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <DemoErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </DemoErrorBoundary>
    </HashRouter>
  </StrictMode>,
);
