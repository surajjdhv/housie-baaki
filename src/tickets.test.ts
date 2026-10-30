import { describe, expect, it, vi } from "vitest";
import {
  applyDigitalAward,
  prizeShares,
  balances,
  validateBackup,
  validateBackupContents,
  validateGathering,
} from "./domain";
import {
  createRoundKey,
  encodeRoundLink,
  generateTicket,
  parseRoundLink,
  randomTicketId,
  ticketNumbers,
  type RoundPayload,
} from "./tickets";
import { fixture } from "./test-fixtures";

const key = "AAAAAAAAAAAAAAAAAAAAAA";
const expected = [
  [6, 12, null, null, null, 54, 67, 76, null],
  [7, null, 24, 33, null, 58, 68, null, null],
  [8, 14, null, 35, 41, null, null, null, 85],
];
const payload: RoundPayload = {
  version: 1,
  algorithm: 1,
  roundId: "r1",
  key,
  name: "Sunday · रविवार 🎉",
  roundNumber: 1,
};
function claimFixture() {
  const g = fixture();
  const r = g.rounds[0];
  r.status = "playing";
  r.digital = { algorithm: 1, key };
  r.caller = false;
  r.called = [];
  r.prizes.forEach((p) => {
    p.winners = [];
  });
  return g;
}
describe("versioned deterministic Housie tickets", () => {
  it("keeps protocol vectors stable after a fresh module load and clock changes", async () => {
    const clock = vi.spyOn(Date, "now");
    try {
      for (const time of [0, 4_102_444_800_000]) {
        clock.mockReturnValue(time);
        vi.resetModules();
        const fresh = await import("./tickets");
        expect(await fresh.generateTicket(key, "0000")).toEqual(expected);
        expect(
          await fresh.generateTicket("AQEBAQEBAQEBAQEBAQEBAQ", "0042"),
        ).toEqual([
          [2, null, 21, null, 42, null, 63, null, 81],
          [null, 12, 24, 31, null, null, 69, 75, null],
          [null, null, 28, 32, null, 57, null, 76, 86],
        ]);
      }
    } finally {
      clock.mockRestore();
    }
  });
  it("matches the frozen v1 protocol vector, including leading zeros", async () => {
    expect(await generateTicket(key, "0000")).toEqual(expected);
    const first = await generateTicket(key, "0000");
    first[0][0] = 90;
    expect(await generateTicket(key, "0000")).toEqual(expected);
    expect(await generateTicket(key, "0042")).not.toEqual(expected);
    expect(await generateTicket("AQEBAQEBAQEBAQEBAQEBAQ", "0000")).not.toEqual(
      expected,
    );
  });
  it("creates valid 3×9 tickets across many independent codes", async () => {
    for (let i = 0; i < 120; i++) {
      const grid = await generateTicket(key, String(i).padStart(4, "0"));
      expect(grid).toHaveLength(3);
      grid.forEach((row) => {
        expect(row).toHaveLength(9);
        expect(row.filter((n) => n !== null)).toHaveLength(5);
      });
      const values = ticketNumbers(grid);
      expect(values).toHaveLength(15);
      expect(new Set(values).size).toBe(15);
      for (let c = 0; c < 9; c++) {
        const col = grid
          .map((row) => row[c])
          .filter((n): n is number => n !== null);
        expect(col.length).toBeGreaterThan(0);
        expect(col).toEqual([...col].sort((a, b) => a - b));
        expect(
          col.every(
            (n) =>
              n >= (c === 0 ? 1 : c * 10) && n <= (c === 8 ? 90 : c * 10 + 9),
          ),
        ).toBe(true);
      }
    }
  });
  it("rejects malformed identifiers and unsupported algorithms", async () => {
    for (const code of ["1", "00000", "-123", "abc1", " 123"])
      await expect(generateTicket(key, code)).rejects.toThrow();
    await expect(generateTicket("bad-key", "0000")).rejects.toThrow();
    await expect(generateTicket(key, "0000", 2)).rejects.toThrow(
      "not supported",
    );
    for (let i = 0; i < 30; i++) {
      expect(randomTicketId()).toMatch(/^\d{4}$/);
      expect(createRoundKey()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });
  it("round-trips Unicode round payloads in URL fragments and raw tokens", () => {
    const link = encodeRoundLink(payload, "https://housiebaaki.app/");
    expect(new URL(link).search).toBe("");
    expect(parseRoundLink(link)).toEqual(payload);
    expect(parseRoundLink(new URL(link).hash)).toEqual(payload);
    expect(parseRoundLink(new URL(link).hash.slice("#/join/".length))).toEqual(
      payload,
    );
    for (const bad of [
      "https://example.com/",
      "HB2.abc",
      "HB1.123",
      "javascript:alert(1)",
      "x".repeat(5000),
    ])
      expect(() => parseRoundLink(bad)).toThrow();
    const newer = encodeRoundLink(payload, "https://housiebaaki.app/").replace(
      "HB1.",
      "HB9.",
    );
    expect(() => parseRoundLink(newer)).toThrow();
  });
});
describe("host-confirmed digital awards", () => {
  it("records one ticket for a custom prize without caller history and is idempotent", () => {
    const g = claimFixture();
    g.rounds[0].prizes[0].name = "Lucky edges";
    applyDigitalAward(g, "r1", "small", "a", "0000");
    const snapshot = structuredClone(g);
    expect(g.rounds[0].prizes[0].winners[0]).toEqual({
      playerId: "a",
      tickets: 1,
      ticketId: "0000",
    });
    expect(
      applyDigitalAward(g, "r1", "small", "a", "0000").alreadyAwarded,
    ).toBe(true);
    expect(g).toEqual(snapshot);
    validateGathering(g);
  });
  it("rejects invalid IDs and unlogged purchases without changing winners", () => {
    const g = claimFixture(),
      before = structuredClone(g);
    expect(() => applyDigitalAward(g, "r1", "small", "a", "123")).toThrow();
    expect(() =>
      applyDigitalAward(g, "r1", "small", "unknown", "0000"),
    ).toThrow("logged ticket");
    expect(g).toEqual(before);
    g.rounds[0].digital = undefined;
    expect(() => applyDigitalAward(g, "r1", "small", "a", "0000")).toThrow(
      "round QR",
    );
  });
  it("never overwrites an existing award or a different ticket ID", () => {
    const g = claimFixture();
    g.rounds[0].prizes[0].winners.push({ playerId: "a", tickets: 2 });
    expect(() => applyDigitalAward(g, "r1", "small", "a", "0000")).toThrow(
      "already has an award",
    );
    g.rounds[0].prizes[0].winners = [];
    applyDigitalAward(g, "r1", "small", "a", "0000");
    expect(() => applyDigitalAward(g, "r1", "small", "a", "0001")).toThrow(
      "already has an award",
    );
    expect(g.rounds[0].prizes[0].winners[0].ticketId).toBe("0000");
  });
  it("splits identical-ID shared wins and preserves zero-sum completed balances", () => {
    const g = claimFixture(),
      r = g.rounds[0];
    applyDigitalAward(g, "r1", "small", "a", "0000");
    expect(applyDigitalAward(g, "r1", "small", "b", "0000").sharedCode).toBe(
      true,
    );
    expect(prizeShares(r, r.prizes[0])).toEqual({ a: 2500, b: 2500 });
    applyDigitalAward(g, "r1", "big", "c", "9876");
    r.status = "completed";
    validateGathering(g);
    expect(Object.values(balances(g)).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it("normalizes legacy backups and validates restored ticket marks before replacement", async () => {
    const old = {
      app: "housie-baaki",
      version: 1,
      exportedAt: 1,
      gatherings: [fixture()],
      activities: [],
    };
    expect(validateBackup(old)).toMatchObject({
      version: 2,
      playerTickets: [],
    });
    const b = {
      ...old,
      version: 2,
      playerTickets: [
        {
          roundId: "r1",
          payload,
          ticketId: "0000",
          marks: [6, 85],
          createdAt: 1,
        },
      ],
    };
    expect((await validateBackupContents(b)).playerTickets[0].marks).toEqual([
      6, 85,
    ]);
    b.playerTickets[0].marks = [90];
    await expect(validateBackupContents(b)).rejects.toThrow("do not belong");
  });
});
