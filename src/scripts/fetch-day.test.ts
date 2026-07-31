import { describe, it, expect, afterEach } from "vitest";
import { getSeedAfterTimestamp, computeEpochRange, isValidCalendarDate } from "./fetch-day.js";

type MockRow = {
  messageId: string | null;
  timestamp: number;
  isFromMe: boolean | null;
  chatJid: string;
};

type MockQuery = MockRow[];

function mockDb(queries: {
  firstQuery?: MockQuery;
  secondQuery?: MockQuery;
}) {
  let callIndex = 0;

  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async (_n: number) => {
              callIndex++;
              if (callIndex === 1 && queries.firstQuery) return queries.firstQuery;
              if (callIndex === 2 && queries.secondQuery) return queries.secondQuery;
              return [];
            },
          }),
        }),
      }),
    }),
  };
}

describe("getSeedAfterTimestamp", () => {
  it("returns the message with timestamp >= rangeEnd when found", async () => {
    const db = mockDb({
      firstQuery: [
        {
          messageId: "msg-after-target",
          timestamp: 1000,
          isFromMe: false,
          chatJid: "jid@test",
        },
      ],
    });

    const result = await getSeedAfterTimestamp(db as never, "jid@test", 900);

    expect(result).toEqual({
      key: { remoteJid: "jid@test", id: "msg-after-target", fromMe: false },
      timestamp: 1000,
    });
  });

  it("returns null when no messages >= rangeEnd exist (triggers bootstrap)", async () => {
    const db = mockDb({
      firstQuery: [],
    });

    const result = await getSeedAfterTimestamp(db as never, "jid@test", 900);

    expect(result).toBeNull();
  });

  it("returns null when no messages exist in the database", async () => {
    const db = mockDb({
      firstQuery: [],
    });

    const result = await getSeedAfterTimestamp(db as never, "jid@test", 900);

    expect(result).toBeNull();
  });

  it("propagates isFromMe correctly from the matched message", async () => {
    const db = mockDb({
      firstQuery: [
        {
          messageId: "msg-from-me",
          timestamp: 1000,
          isFromMe: true,
          chatJid: "jid@test",
        },
      ],
    });

    const result = await getSeedAfterTimestamp(db as never, "jid@test", 500);

    expect(result).toEqual({
      key: { remoteJid: "jid@test", id: "msg-from-me", fromMe: true },
      timestamp: 1000,
    });
  });

  it("returns fallback seed when rangeStart is provided and no message >= rangeEnd exists", async () => {
    const db = mockDb({
      firstQuery: [],
      secondQuery: [
        {
          messageId: "msg-latest-today",
          timestamp: 850,
          isFromMe: false,
          chatJid: "jid@test",
        },
      ],
    });

    // rangeEnd = 900, rangeStart = 800 (current day)
    const result = await getSeedAfterTimestamp(db as never, "jid@test", 900, 800);

    expect(result).toEqual({
      key: { remoteJid: "jid@test", id: "msg-latest-today", fromMe: false },
      timestamp: 850,
    });
  });

  it("returns null when rangeStart fallback query also returns no messages", async () => {
    const db = mockDb({
      firstQuery: [],
      secondQuery: [],
    });

    const result = await getSeedAfterTimestamp(db as never, "jid@test", 900, 800);

    expect(result).toBeNull();
  });
});

describe("isValidCalendarDate", () => {
  it("accepts a real date", () => {
    expect(isValidCalendarDate(15, 8, 2026)).toBe(true);
  });

  it("rejects a day that overflows its month (31-02)", () => {
    // new Date() would silently roll this over to March 3rd if unchecked
    expect(isValidCalendarDate(31, 2, 2026)).toBe(false);
  });

  it("rejects Feb 29 on a non-leap year", () => {
    expect(isValidCalendarDate(29, 2, 2026)).toBe(false);
  });

  it("accepts Feb 29 on a leap year", () => {
    expect(isValidCalendarDate(29, 2, 2024)).toBe(true);
  });

  it("rejects month 13", () => {
    expect(isValidCalendarDate(1, 13, 2026)).toBe(false);
  });
});

describe("computeEpochRange", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("spans exactly 24h on an ordinary day", () => {
    process.env.TZ = "UTC";
    const range = computeEpochRange("15-08-2026");
    expect(range.end - range.start).toBe(86400);
  });

  it("spans exactly 23h on a spring-forward DST day (regression test for the +86400 bug)", () => {
    process.env.TZ = "America/New_York"; // DST 2026 starts Sun 08-Mar
    const range = computeEpochRange("08-03-2026");
    const expectedEnd = new Date(2026, 2, 9).getTime() / 1000; // real next local midnight
    expect(range.end).toBe(expectedEnd);
    expect(range.end - range.start).toBe(82800); // 23h, not 86400s
  });

  it("spans exactly 25h on a fall-back DST day", () => {
    process.env.TZ = "America/New_York"; // DST 2026 ends Sun 01-Nov
    const range = computeEpochRange("01-11-2026");
    const expectedEnd = new Date(2026, 10, 2).getTime() / 1000;
    expect(range.end).toBe(expectedEnd);
    expect(range.end - range.start).toBe(90000); // 25h
  });
});