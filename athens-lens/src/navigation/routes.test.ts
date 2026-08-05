import { describe, expect, it } from "vitest";
import { formatWorkspaceRoute, parseWorkspaceRoute } from "./routes";

describe("workspace routes", () => {
  it("defaults unknown routes to jobs", () => {
    expect(parseWorkspaceRoute("")).toEqual({ view: "jobs" });
    expect(parseWorkspaceRoute("#unknown")).toEqual({ view: "jobs" });
  });

  it("round-trips inbox message routes", () => {
    const route = { view: "inbox", itemId: "message/with spaces" } as const;
    expect(parseWorkspaceRoute(formatWorkspaceRoute(route))).toEqual(route);
  });
});
