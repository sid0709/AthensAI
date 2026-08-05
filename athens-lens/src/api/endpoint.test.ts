import { describe, expect, it } from "vitest";
import { decodeEndpoint, resolveEndpoint } from "./endpoint";

describe("endpoint encoding", () => {
  it("passes through plain http(s) URLs", () => {
    expect(decodeEndpoint("https://athensai.remotepairnet.net/api")).toBe(
      "https://athensai.remotepairnet.net/api",
    );
  });

  it("decodes enc: tokens from docker/encode-endpoint.py", async () => {
    const { execFileSync } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const encodePy = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../docker/encode-endpoint.py",
    );
    const url = "https://athensai.remotepairnet.net/api";
    const token = execFileSync("python3", [encodePy, url], { encoding: "utf8" }).trim();
    expect(decodeEndpoint(`enc:${token}`)).toBe(url);
    expect(resolveEndpoint(`enc:${token}`, "http://127.0.0.1:8979/api")).toBe(url);
  });

  it("falls back when value is empty", () => {
    expect(resolveEndpoint("", "http://127.0.0.1:8979/api")).toBe("http://127.0.0.1:8979/api");
    expect(resolveEndpoint(undefined, "http://127.0.0.1:8979/api")).toBe(
      "http://127.0.0.1:8979/api",
    );
  });
});
