import { useEffect, useRef, useState } from "react";
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

export function SignInPage() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signin, isAuthenticated } = useAuth();
  const experience = useAuthExperience();
  const navigate = useNavigate();
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (experience.introActive) return;
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [experience.introActive]);

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
    const result = await signin(name.trim(), password);
    setLoading(false);
    if (result.success) {
      experience.completeAttempt(result.user?.name);
      navigate(PATHS.jobs, { replace: true });
    } else {
      experience.failAttempt();
      const msg = result.message || "Sign in failed";
      setError(msg);
      toast.error("Sign in failed", { description: msg });
    }
  };

  return (
    <AuthSplitLayout>
      <div className="flex items-center gap-3 mb-8 lg:hidden">
        <Link to={PATHS.home} className="flex items-center gap-3">
          <AppLogo size={40} className="rounded-md" />
          <div>
            <p className="font-bold text-foreground" style={display}>
              AthensAI
            </p>
            <p className="text-xs text-muted-foreground">Return to your career galaxy</p>
          </div>
        </Link>
      </div>

      <div className="hidden lg:block mb-9">
        <p className="mb-4 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-violet-700/70">
          Secure access // 01
        </p>
        <h2 className="text-[2.4rem] font-semibold leading-none tracking-[-0.045em] text-[#181522]" style={display}>
          Welcome back, navigator.
        </h2>
        <p className="mt-3 text-sm text-[#5f586d]">Your career galaxy is waiting. Sign in to chart your next move.</p>
      </div>

      {error ? (
        <div className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#5f586d]">Username</label>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full px-3.5 py-2.5 text-sm outline-none"
            autoComplete="username"
            placeholder="Your username"
            disabled={loading}
          />
        </div>
        <div>
          <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#5f586d]">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full px-3.5 py-2.5 text-sm outline-none"
            autoComplete="current-password"
            disabled={loading}
          />
        </div>
        <Button type="submit" className="mt-2 w-full font-semibold" disabled={loading || experience.introActive}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Mapping your signal…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
      <p className="mt-7 text-center text-sm text-[#6b6476]">
        No account?{" "}
        <Link to="/signup" className="text-primary font-semibold hover:underline">
          Create one
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
