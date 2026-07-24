import { BrowserRouter } from "react-router";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "./app/components/ui/sonner";
import { AppRoutes } from "./app/router/AppRoutes";
import { AuthProvider } from "./context/auth-context";
import "./styles/index.css";
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
    <AuthProvider>
      <div className="h-full overflow-hidden">
        <BrowserRouter>
          <AppRoutes />
          <Toaster richColors closeButton />
        </BrowserRouter>
      </div>
    </AuthProvider>
  </ThemeProvider>,
);
