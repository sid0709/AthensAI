import type { Credentials } from "../types";

export interface CredentialErrors {
  email?: string;
  password?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCredentials(credentials: Credentials): CredentialErrors {
  const errors: CredentialErrors = {};

  if (!EMAIL_PATTERN.test(credentials.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!credentials.password.trim()) {
    errors.password = "Enter your password.";
  }

  return errors;
}
