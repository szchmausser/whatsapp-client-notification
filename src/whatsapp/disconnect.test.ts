import { describe, expect, it } from "vitest";
import { shouldRetryDisconnect } from "./disconnect.js";

describe("shouldRetryDisconnect", () => {
  it("retries transient disconnects", () => {
    expect(shouldRetryDisconnect(428)).toBe(true);
    expect(shouldRetryDisconnect(408)).toBe(true);
    expect(shouldRetryDisconnect(500)).toBe(true);
    expect(shouldRetryDisconnect(503)).toBe(true);
  });

  it("does not retry terminal disconnects", () => {
    expect(shouldRetryDisconnect(401)).toBe(false);
    expect(shouldRetryDisconnect(403)).toBe(false);
    expect(shouldRetryDisconnect(440)).toBe(false);
  });
});
