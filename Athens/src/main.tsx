import { BrowserRouter } from "react-router";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "./app/components/ui/sonner";
import { AppRoutes } from "./app/router/AppRoutes";
import { AuthProvider } from "./context/auth-context";
import { AuthExperienceProvider } from "./app/features/auth/experience/AuthExperienceContext";
import { AuthExperienceLayer } from "./app/features/auth/experience/AuthExperienceLayer";
import "./styles/index.css";
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
    <AuthProvider>
      <BrowserRouter>
        <AuthExperienceProvider>
          <div className="relative h-full overflow-hidden">
            <AuthExperienceLayer />
            <AppRoutes />
            <Toaster richColors closeButton />
          </div>
        </AuthExperienceProvider>
      </BrowserRouter>
    </AuthProvider>
  </ThemeProvider>,
);
