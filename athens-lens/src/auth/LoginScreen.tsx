import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import type { Credentials, Session } from "../types";
import { validateCredentials, type CredentialErrors } from "./validation";

interface LoginScreenProps {
  onSignIn(credentials: Credentials): Promise<Session>;
}

export function LoginScreen({ onSignIn }: LoginScreenProps) {
  const [credentials, setCredentials] = useState<Credentials>({ username: "", password: "" });
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
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "We couldn't sign you in. Try again.");
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
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              aria-invalid={Boolean(errors.username)}
              aria-describedby={errors.username ? "username-error" : undefined}
              value={credentials.username}
              onChange={(event) => {
                setCredentials((current) => ({ ...current, username: event.target.value }));
                if (errors.username) setErrors((current) => ({ ...current, username: undefined }));
              }}
              placeholder="Oliver Baltay"
            />
            {errors.username ? <p className="field-error" id="username-error">{errors.username}</p> : null}
          </div>

          <div className="field-group">
            <label htmlFor="password">Vendor access password</label>
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
              placeholder="Enter your vendor password"
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
          Your vendor password is used only to sign in and is never stored.
        </p>
      </section>
    </main>
  );
}
