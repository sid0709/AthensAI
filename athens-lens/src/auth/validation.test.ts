import { describe, expect, it } from "vitest";
import { validateCredentials } from "./validation";

describe("validateCredentials", () => {
  it("requires a username and a non-empty password", () => {
    expect(validateCredentials({ username: " ", password: " " })).toEqual({
      username: "Enter your username.",
      password: "Enter your password."
    });
  });

  it("accepts valid credentials", () => {
    expect(validateCredentials({ username: "Oliver Baltay", password: "anything" })).toEqual({});
  });
});
