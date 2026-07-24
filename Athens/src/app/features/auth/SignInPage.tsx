import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { AppLogo } from "../../components/shared/AppLogo";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { Button } from "../../components/ui/button";
import { AuthSplitLayout } from "./components/AuthSplitLayout";
import { display } from "../../lib/utils";

export function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signin, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    const result = await signin(email.trim(), password);
    setLoading(false);
    if (result.success) {
      toast.success("Signed in", { description: `Welcome back, ${result.user?.name || email.trim()}.` });
      navigate("/", { replace: true });
    } else {
      const msg = result.message || "Sign in failed";
      setError(msg);
      toast.error("Sign in failed", { description: msg });
    }
  };

  return (
    <AuthSplitLayout>
      <div className="flex items-center gap-3 mb-8 lg:hidden">
        <AppLogo size={40} />
        <div>
          <p className="font-bold text-foreground" style={display}>
            AthensAI
          </p>
          <p className="text-xs text-muted-foreground">Sign in to continue</p>
        </div>
      </div>

      <div className="hidden lg:flex items-center gap-3 mb-8">
        <AppLogo size={44} />
        <div>
          <h2 className="text-2xl font-bold text-foreground" style={display}>
            Sign in
          </h2>
          <p className="text-sm text-muted-foreground">Use your Firebase account</p>
        </div>
      </div>

      {error ? (
        <div className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Email</label>
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            autoComplete="username"
            placeholder="you@company.com"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            autoComplete="current-password"
          />
        </div>
        <Button type="submit" className="w-full h-11 rounded-xl font-bold" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground mt-8">Accounts are created by an administrator.</p>
      </form>
    </AuthSplitLayout>
  );
}

/*
      <p className="text-center text-sm text-muted-foreground mt-8">
        No account?{" "}
        <Link to="/signup" className="text-primary font-semibold hover:underline">
          Create one
        </Link>
      </p>*/
