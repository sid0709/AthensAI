/** Protocol constants for Athens-compatible auth (not domain vocabulary). */
export const BCRYPT_ROUNDS = 10;

/** Legacy Athens-server accounts with no password hash. */
export const LEGACY_DEFAULT_PASSWORD = '12345678';

export const AuthMessages = {
  namePasswordRequired: 'Name and password are required',
  invalidCredentials: 'Invalid credentials',
  userExists: 'User already exists',
  userCreated: 'User created successfully',
  signedIn: 'Signed in successfully',
  changePasswordRequired:
    'Name, current password, and new password are required',
  newPasswordTooShort: 'New password must be at least 8 characters',
  accountNotFound: 'Account not found',
  currentPasswordIncorrect: 'Current password is incorrect',
  passwordUpdated: 'Password updated successfully',
  nameRequired: 'Name is required',
} as const;

export const MIN_NEW_PASSWORD_LENGTH = 8;
