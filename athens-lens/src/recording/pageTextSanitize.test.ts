import { describe, expect, it } from "vitest";
import { stripStylesheetNoise } from "./pageTextSanitize";

describe("stripStylesheetNoise", () => {
  it("keeps form questions and drops shadow stylesheet dumps", () => {
    const input = [
      "What is your full name?*",
      "What is your expected salary?*",
      "Apply now",
      "Cancel",
      "",
      ":host{--color-brand-50: #ecf3fd;--color-brand-200: #a6c9ee}",
      "@tailwind utilities;",
      ".mnkt-flex{display:flex}",
    ].join("\n");

    const cleaned = stripStylesheetNoise(input);
    expect(cleaned).toContain("What is your full name?*");
    expect(cleaned).toContain("Apply now");
    expect(cleaned).not.toContain(":host{");
    expect(cleaned).not.toContain("@tailwind");
    expect(cleaned).not.toContain("mnkt-flex");
  });

  it("returns empty input unchanged", () => {
    expect(stripStylesheetNoise("")).toBe("");
  });
});
