import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { AppLogo } from "../../components/shared/AppLogo";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { Button } from "../../components/ui/button";
import { AuthSplitLayout } from "./components/AuthSplitLayout";
import { display } from "../../lib/utils";
import { useAuthExperience } from "./experience/AuthExperienceContext";
import { PATHS } from "../../config/routes";

export function SignUpPage() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signup, isAuthenticated } = useAuth();
  const experience = useAuthExperience();
  const navigate = useNavigate();

  if (isAuthenticated) {
    return <Navigate to={PATHS.jobs} replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !password) {
      setError("Please fill in all fields");
      return;
    }
    experience.beginAttempt();
    setLoading(true);
    const result = await signup(name.trim(), password);
    setLoading(false);
    if (result.success) {
      experience.completeAttempt(result.user?.name);
      navigate(PATHS.jobs, { replace: true });
    } else {
      experience.failAttempt();
      const msg = result.message || "Sign up failed";
      setError(msg);
      toast.error("Sign up failed", { description: msg });
    }
  };

  return (
    <AuthSplitLayout>
      <div className="flex items-center gap-3 mb-8 lg:hidden">
        <Link to={PATHS.home} className="flex items-center gap-3">
          <AppLogo size={40} className="rounded-md" />
          <div>
            <p className="font-bold text-foreground" style={display}>AthensAI</p>
            <p className="text-xs text-muted-foreground">Begin your career journey</p>
          </div>
        </Link>
      </div>

      <div className="hidden lg:block mb-9">
        <p className="mb-4 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-violet-700/70">
          New navigator // 02
        </p>
        <h2 className="text-[2.4rem] font-semibold leading-none tracking-[-0.045em] text-[#181522]" style={display}>
          Enter the galaxy.
        </h2>
        <p className="mt-3 text-sm text-[#5f586d]">Create your AthensAI account and start charting what comes next.</p>
      </div>

      {error ? (
        <div className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Username</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            autoComplete="username"
            placeholder="Choose a username"
            disabled={loading}
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            autoComplete="new-password"
            disabled={loading}
          />
        </div>
        <Button type="submit" className="w-full h-11 rounded-xl font-bold" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Mapping your signal…
            </>
          ) : (
            "Sign up"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-8">
        Already have an account?{" "}
        <Link to="/signin" className="text-primary font-semibold hover:underline">
          Sign in
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
