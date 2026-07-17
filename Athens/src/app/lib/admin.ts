export function isAdminPermission(permission: unknown): boolean {
  return String(permission ?? "").trim().toLowerCase() === "admin";
}
