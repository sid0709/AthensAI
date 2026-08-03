import assert from "node:assert/strict";
import test from "node:test";
import { dashboardAccountName, dashboardGreeting } from "./dashboardIdentity";

test("dashboard greeting follows the visitor's current local time", () => {
  assert.equal(dashboardGreeting(new Date(2026, 0, 1, 8)), "Good morning");
  assert.equal(dashboardGreeting(new Date(2026, 0, 1, 13)), "Good afternoon");
  assert.equal(dashboardGreeting(new Date(2026, 0, 1, 19)), "Good evening");
});

test("dashboard identity uses the auth account name with a safe fallback", () => {
  assert.equal(dashboardAccountName(" Robin "), "Robin");
  assert.equal(dashboardAccountName("  "), "there");
  assert.equal(dashboardAccountName(null), "there");
});
