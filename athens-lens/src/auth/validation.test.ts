import { describe, expect, it } from "vitest";
import { validateCredentials } from "./validation";

describe("validateCredentials", () => {
  it("requires a valid email and a non-empty password", () => {
    expect(validateCredentials({ email: "not-an-email", password: " " })).toEqual({
      email: "Enter a valid email address.",
      password: "Enter your password."
    });
  });

  it("accepts valid demo credentials", () => {
    expect(validateCredentials({ email: "person@example.com", password: "anything" })).toEqual({});
  });
});
