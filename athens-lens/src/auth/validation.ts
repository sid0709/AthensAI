import type { Credentials } from "../types";

export interface CredentialErrors {
  username?: string;
  password?: string;
}

export function validateCredentials(credentials: Credentials): CredentialErrors {
  const errors: CredentialErrors = {};

  if (!credentials.username.trim()) {
    errors.username = "Enter your username.";
  }

  if (!credentials.password.trim()) {
    errors.password = "Enter your password.";
  }

  return errors;
}
