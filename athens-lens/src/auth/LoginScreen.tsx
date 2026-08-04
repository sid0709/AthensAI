import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import type { Credentials, Session } from "../types";
import { validateCredentials, type CredentialErrors } from "./validation";

interface LoginScreenProps {
  onSignIn(credentials: Credentials): Promise<Session>;
}

export function LoginScreen({ onSignIn }: LoginScreenProps) {
  const [credentials, setCredentials] = useState<Credentials>({ email: "", password: "" });
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateCredentials(credentials);
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSignIn(credentials);
    } catch {
      setSubmitError("We couldn't start your demo session. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-brand" aria-label="Athens Lens">
        <img className="login-logo" src="/logo.png" alt="" />
        <span>Athens Lens</span>
      </div>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-heading">
          <h1 id="login-title">Welcome back</h1>
          <p>Sign in to bring your next opportunity into focus.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="field-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
              value={credentials.email}
              onChange={(event) => {
                setCredentials((current) => ({ ...current, email: event.target.value }));
                if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
              }}
              placeholder="you@example.com"
            />
            {errors.email ? <p className="field-error" id="email-error">{errors.email}</p> : null}
          </div>

          <div className="field-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "password-error" : undefined}
              value={credentials.password}
              onChange={(event) => {
                setCredentials((current) => ({ ...current, password: event.target.value }));
                if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
              }}
              placeholder="Enter any password"
            />
            {errors.password ? <p className="field-error" id="password-error">{errors.password}</p> : null}
          </div>

          {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            <span>{isSubmitting ? "Signing in…" : "Continue"}</span>
            {!isSubmitting ? <ArrowRight size={18} aria-hidden="true" /> : null}
          </button>
        </form>

        <p className="demo-note">
          <LockKeyhole size={14} aria-hidden="true" />
          Demo mode — your password is never stored or sent.
        </p>
      </section>
    </main>
  );
}
