import { describe, expect, it } from "vitest";
import {
  allocate,
  balances,
  newRound,
  nextCalled,
  parseMoney,
  playerEntries,
  prizeAmounts,
  prizeShares,
  settlements,
  validateBackup,
  validateBudget,
  validateGathering,
} from "./domain";

import { fixture } from "./test-fixtures";

describe("money and apportionment", () => {
  it("parses decimal strings exactly and rejects unsupported amounts", () => {
    expect(parseMoney("0.29")).toBe(29);
    expect(parseMoney("120.5")).toBe(12050);
    for (const n of ["-1", "Infinity", "2.003", "1e2", "", "abc", "1000000001"])
      expect(() => parseMoney(n)).toThrow();
  });
  it("allocates every paise with deterministic ties independent of input order", () => {
    expect(
      allocate(100, [
        { id: "c", weight: 1 },
        { id: "a", weight: 1 },
        { id: "b", weight: 1 },
      ]),
    ).toEqual({ a: 34, b: 33, c: 33 });
    expect(
      allocate(100, [
        { id: "b", weight: 1 },
        { id: "a", weight: 1 },
        { id: "c", weight: 1 },
      ]),
    ).toEqual({ a: 34, b: 33, c: 33 });
  });
  it("handles large products exactly and rejects zero or duplicate shares", () => {
    const result = allocate(99_999_999_999, [
      { id: "a", weight: 9999 },
      { id: "b", weight: 10000 },
    ]);
    expect(Object.values(result).reduce((a, n) => a + n, 0)).toBe(
      99_999_999_999,
    );
    expect(() => allocate(100, [{ id: "a", weight: 0 }])).toThrow();
    expect(() =>
      allocate(100, [
        { id: "a", weight: 1 },
        { id: "a", weight: 1 },
      ]),
    ).toThrow();
  });
  it("splits a prize by winning tickets and permits a player to win other prizes", () => {
    const g = fixture(),
      r = g.rounds[0];
    r.prizes[1].winners = [
      { playerId: "a", tickets: 2 },
      { playerId: "b", tickets: 1 },
    ];
    expect(prizeShares(r, r.prizes[1])).toEqual({ a: 23333, b: 11667 });
    expect(() => validateGathering(g)).not.toThrow();
    expect(Object.values(balances(g)).reduce((a, n) => a + n, 0)).toBe(0);
  });
  it("distributes percentage rounding without losing a paise", () => {
    const r = fixture().rounds[0];
    r.mode = "percent";
    r.ticketPrice = 1;
    r.tickets = { a: 1 };
    r.prizes = [
      { id: "a", name: "A", value: 3333, winners: [] },
      { id: "b", name: "B", value: 6667, winners: [] },
    ];
    expect(prizeAmounts(r)).toEqual({ a: 0, b: 1 });
    expect(() => validateBudget(r)).toThrow("too small");
    r.ticketPrice = 1001;
    expect(Object.values(prizeAmounts(r)).reduce((a, n) => a + n, 0)).toBe(
      1001,
    );
    expect(() => validateBudget(r)).not.toThrow();
  });
  it("can preview incomplete or empty draft prizes safely", () => {
    const r = fixture().rounds[0];
    r.mode = "percent";
    r.prizes = [];
    expect(prizeAmounts(r)).toEqual({});
    r.prizes = [{ id: "a", name: "A", value: 2500, winners: [] }];
    expect(prizeAmounts(r)).toEqual({ a: 10000 });
    expect(() => validateBudget(r)).toThrow("100%");
  });
  it("requires balanced fixed prizes and validates large pools", () => {
    const r = fixture().rounds[0];
    r.prizes[0].value--;
    expect(() => validateBudget(r)).toThrow("equal");
    r.ticketPrice = 100_000_000_000;
    expect(() => validateBudget(r)).toThrow("large");
  });
});

describe("settlement ledger", () => {
  it("matches the agreed example and preserves partial payments", () => {
    const g = fixture();
    validateGathering(g);
    expect(balances(g)).toEqual({ a: -20000, b: -5000, c: 25000 });
    expect(settlements(g)).toEqual([
      { from: "a", to: "c", amount: 20000 },
      { from: "b", to: "c", amount: 5000 },
    ]);
    g.payments.push({
      id: "p1",
      from: "a",
      to: "c",
      amount: 12000,
      createdAt: 3,
    });
    expect(balances(g)).toEqual({ a: -8000, b: -5000, c: 13000 });
    expect(settlements(g)).toEqual([
      { from: "a", to: "c", amount: 8000 },
      { from: "b", to: "c", amount: 5000 },
    ]);
  });
  it("settles all debts and can reverse a payment without deleting history", () => {
    const g = fixture();
    g.payments = settlements(g).map((p, i) => ({
      ...p,
      id: `p${i}`,
      createdAt: 3,
    }));
    expect(settlements(g)).toEqual([]);
    g.payments[0].reversedAt = 4;
    expect(settlements(g)).toEqual([{ from: "a", to: "c", amount: 20000 }]);
    expect(g.payments).toHaveLength(2);
  });
  it("excludes active and cancelled rounds, then includes a newly finished round", () => {
    const g = fixture();
    const r = structuredClone(g.rounds[0]);
    r.id = "r2";
    r.number = 2;
    r.status = "playing";
    g.rounds.push(r);
    expect(balances(g)).toEqual({ a: -20000, b: -5000, c: 25000 });
    r.status = "cancelled";
    expect(balances(g).a).toBe(-20000);
    r.status = "completed";
    expect(balances(g)).toEqual({ a: -40000, b: -10000, c: 50000 });
  });
  it("recalculates corrected winners while retaining real payment records", () => {
    const g = fixture();
    g.payments.push({
      id: "p",
      from: "a",
      to: "c",
      amount: 12000,
      createdAt: 3,
    });
    g.rounds[0].prizes[1].winners = [{ playerId: "a", tickets: 1 }];
    expect(balances(g)).toEqual({ a: 27000, b: -5000, c: -22000 });
    expect(g.payments[0].amount).toBe(12000);
    expect(playerEntries(g, "a")).toHaveLength(3);
  });
  it("keeps the ledger balanced over multiple rounds and arbitrary partial transfers", () => {
    const g = fixture();
    for (let i = 2; i <= 30; i++) {
      const r = structuredClone(g.rounds[0]);
      r.id = `r${i}`;
      r.number = i;
      r.prizes[1].winners = [{ playerId: i % 2 ? "a" : "c", tickets: 1 }];
      g.rounds.push(r);
      const suggested = settlements(g)[0];
      if (suggested)
        g.payments.push({
          ...suggested,
          amount: Math.max(1, Math.floor(suggested.amount / 3)),
          id: `p${i}`,
          createdAt: i + 100,
        });
      expect(Object.values(balances(g)).reduce((a, n) => a + n, 0)).toBe(0);
    }
    const dues = settlements(g);
    dues.forEach((p, i) =>
      g.payments.push({ ...p, id: `final${i}`, createdAt: 200 }),
    );
    expect(Object.values(balances(g)).every((n) => n === 0)).toBe(true);
  });
});

describe("round integrity and caller", () => {
  it("rejects missing winners, excess winning tickets, and unknown players", () => {
    const g = fixture();
    g.rounds[0].prizes[0].winners = [];
    expect(() => validateGathering(g)).toThrow("every prize");
    g.rounds[0].prizes[0].winners = [{ playerId: "b", tickets: 2 }];
    expect(() => validateGathering(g)).toThrow("exceed");
    g.rounds[0].prizes[0].winners = [{ playerId: "missing", tickets: 1 }];
    expect(() => validateGathering(g)).toThrow();
  });
  it("rejects duplicate names, duplicate round numbers and concurrent rounds", () => {
    const g = fixture();
    g.players[1].name = "a";
    expect(() => validateGathering(g)).toThrow("different name");
    g.players[1].name = "B";
    const r = structuredClone(g.rounds[0]);
    r.id = "r2";
    g.rounds.push(r);
    expect(() => validateGathering(g)).toThrow("number");
    r.number = 2;
    r.status = "playing";
    g.rounds[0].status = "playing";
    expect(() => validateGathering(g)).toThrow("current round");
  });
  it("copies completed round settings with fresh prizes and respects sitting out", () => {
    const g = fixture();
    g.players[0].active = false;
    const r = newRound(g);
    expect(r.number).toBe(2);
    expect(r.ticketPrice).toBe(10000);
    expect(r.tickets).toEqual({ b: 1, c: 1 });
    expect(r.prizes.every((p) => p.winners.length === 0)).toBe(true);
    expect(r.prizes[0].id).not.toBe(g.rounds[0].prizes[0].id);
    g.status = "closed";
    expect(() => newRound(g)).toThrow("Reopen");
  });
  it("draws all 90 numbers exactly once and rejects exhausted/invalid calls", () => {
    const called: number[] = [];
    for (let i = 0; i < 90; i++) called.push(nextCalled(called));
    expect(new Set(called).size).toBe(90);
    expect(Math.min(...called)).toBe(1);
    expect(Math.max(...called)).toBe(90);
    expect(() => nextCalled(called)).toThrow("All 90");
    expect(nextCalled([], 42)).toBe(42);
    expect(() => nextCalled([42], 42)).toThrow("already");
    expect(() => nextCalled([], 91)).toThrow();
    called.pop();
    expect(nextCalled(called)).not.toBeUndefined();
  });
  it("rejects duplicate called numbers in a restored game", () => {
    const g = fixture();
    g.rounds[0].called = [42, 42];
    expect(() => validateGathering(g)).toThrow("twice");
  });
  it("validates backup versions and referential integrity", () => {
    const b = {
      app: "housie-baaki",
      version: 1,
      exportedAt: 1,
      gatherings: [fixture()],
      activities: [],
    };
    expect(validateBackup(b).gatherings).toHaveLength(1);
    expect(() => validateBackup({ ...b, version: 2 })).toThrow();
    expect(() =>
      validateBackup({
        ...b,
        activities: [
          {
            id: "e",
            gatheringId: "missing",
            createdAt: 1,
            kind: "x",
            message: "x",
          },
        ],
      }),
    ).toThrow("matching");
    expect(() =>
      validateBackup({ ...b, gatherings: [fixture(), fixture()] }),
    ).toThrow("Duplicate");
  });
});
