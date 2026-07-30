import { describe, it, expect } from "vitest";
import { getSeedAfterTimestamp } from "./fetch-day.js";

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
});
