import { afterEach, describe, expect, it } from "vitest";
import {
  db,
  createGathering,
  changeGathering,
  exportBackup,
  restoreBackup,
} from "./db";
import { fixture } from "./test-fixtures";
import Dexie from "dexie";
import { HousieDB, joinRound, toggleTicketMark, awardDigitalClaim } from "./db";
import { generateTicket, ticketNumbers, type RoundPayload } from "./tickets";

afterEach(async () => {
  await db.gatherings.clear();
  await db.activities.clear();
  await db.playerTickets.clear();
});

describe("offline player tickets and verified transactions", () => {
  const payload: RoundPayload = {
    version: 1,
    algorithm: 1,
    roundId: "r1",
    key: "AAAAAAAAAAAAAAAAAAAAAA",
    name: "Night",
    roundNumber: 1,
  };
  it("creates exactly one ticket under concurrent joins and retains it after reopening", async () => {
    const tickets = await Promise.all(
      Array.from({ length: 12 }, () => joinRound(payload)),
    );
    expect(new Set(tickets.map((t) => t.ticketId)).size).toBe(1);
    expect(await db.playerTickets.count()).toBe(1);
    const t = tickets[0],
      numbers = ticketNumbers(await generateTicket(payload.key, t.ticketId));
    await Promise.all([
      toggleTicketMark("r1", numbers[0]),
      toggleTicketMark("r1", numbers[1]),
    ]);
    db.close();
    await db.open();
    const restored = await joinRound(payload);
    expect(restored.ticketId).toBe(t.ticketId);
    expect(restored.marks.sort()).toEqual(numbers.slice(0, 2).sort());
    await expect(
      joinRound({ ...payload, key: "AQEBAQEBAQEBAQEBAQEBAQ" }),
    ).rejects.toThrow("different key");
    await expect(
      toggleTicketMark(
        "r1",
        Array.from({ length: 90 }, (_, i) => i + 1).find(
          (n) => !numbers.includes(n),
        )!,
      ),
    ).rejects.toThrow("not on");
  });
  it("commits a verified award and audit atomically and guards calls/key changes", async () => {
    const g = fixture(),
      r = g.rounds[0];
    r.status = "playing";
    r.digital = { algorithm: 1, key: payload.key };
    r.called = [6, 12, 54, 67, 76];
    r.prizes.forEach((p) => {
      p.winners = [];
    });
    await db.gatherings.put(g);
    await awardDigitalClaim(g.id, "r1", "small", "a", "0000");
    expect(
      (await db.gatherings.get(g.id))!.rounds[0].prizes[0].winners,
    ).toHaveLength(1);
    expect(await db.activities.count()).toBe(1);
    await awardDigitalClaim(g.id, "r1", "small", "a", "0000");
    expect(await db.activities.count()).toBe(1);
    await expect(
      changeGathering(
        g.id,
        (s) => {
          s.rounds[0].called.pop();
        },
        "caller",
        "Undo call.",
      ),
    ).rejects.toThrow("invalidate");
    expect((await db.gatherings.get(g.id))!.rounds[0].called).toHaveLength(5);
    await expect(
      changeGathering(
        g.id,
        (s) => {
          s.rounds[0].digital!.key = "AQEBAQEBAQEBAQEBAQEBAQ";
        },
        "round",
        "Rotate key.",
      ),
    ).rejects.toThrow("cannot change");
    await changeGathering(
      g.id,
      (s) => {
        s.rounds[0].prizes[0].winners = [];
      },
      "award",
      "Removed the award.",
    );
    await changeGathering(
      g.id,
      (s) => {
        s.rounds[0].called.pop();
      },
      "caller",
      "Undid call 76.",
    );
    const backup = await exportBackup();
    expect(
      backup.activities.find((a) => a.verification)?.verification?.called,
    ).toEqual([6, 12, 54, 67, 76]);
    await expect(restoreBackup(backup)).resolves.toBeUndefined();
  });
  it("keeps failed claims and failed verification logs out of the ledger", async () => {
    const g = fixture(),
      r = g.rounds[0];
    r.status = "playing";
    r.digital = { algorithm: 1, key: payload.key };
    r.called = [6, 12, 54, 67];
    r.prizes.forEach((p) => {
      p.winners = [];
    });
    await db.gatherings.put(g);
    await expect(
      awardDigitalClaim(g.id, "r1", "small", "a", "0000"),
    ).rejects.toThrow("not valid");
    expect(await db.activities.count()).toBe(0);
    r.called.push(76);
    await db.gatherings.put(g);
    const fail = () => {
      throw new Error("Audit failure");
    };
    db.activities.hook("creating", fail);
    try {
      await expect(
        awardDigitalClaim(g.id, "r1", "small", "a", "0000"),
      ).rejects.toThrow("Audit failure");
    } finally {
      db.activities.hook("creating").unsubscribe(fail);
    }
    expect(
      (await db.gatherings.get(g.id))!.rounds[0].prizes[0].winners,
    ).toHaveLength(0);
  });
  it("includes marked tickets in v2 backups and restores v1 without damaging host records", async () => {
    const g = fixture();
    await db.gatherings.put(g);
    const t = await joinRound(payload);
    const number = ticketNumbers(
      await generateTicket(payload.key, t.ticketId),
    )[0];
    await toggleTicketMark("r1", number);
    const b = await exportBackup();
    expect(b.version).toBe(2);
    expect(b.playerTickets[0].marks).toEqual([number]);
    await db.playerTickets.clear();
    await restoreBackup(b);
    expect(await db.playerTickets.get("r1")).toEqual(b.playerTickets[0]);
    const invalid = structuredClone(b);
    const numbers = ticketNumbers(
      await generateTicket(payload.key, t.ticketId),
    );
    invalid.playerTickets[0].marks = [
      Array.from({ length: 90 }, (_, i) => i + 1).find(
        (n) => !numbers.includes(n),
      )!,
    ];
    await expect(restoreBackup(invalid)).rejects.toThrow();
    expect(await db.playerTickets.get("r1")).toEqual(b.playerTickets[0]);
    await restoreBackup({
      app: "housie-baaki",
      version: 1,
      exportedAt: 1,
      gatherings: [g],
      activities: [],
    });
    expect(await db.gatherings.get(g.id)).toEqual(g);
    expect(await db.playerTickets.count()).toBe(0);
  });
  it("opens an existing v1 database without changing saved gatherings", async () => {
    const databaseName = "housie-migration-test",
      legacy = new Dexie(databaseName);
    legacy.version(1).stores({
      gatherings: "id, updatedAt, status",
      activities: "id, gatheringId, createdAt, [gatheringId+createdAt]",
    });
    await legacy.table("gatherings").put(fixture());
    legacy.close();
    const upgraded = new HousieDB(databaseName);
    try {
      await upgraded.open();
      expect(await upgraded.gatherings.get("night")).toEqual(fixture());
      expect(await upgraded.playerTickets.count()).toBe(0);
    } finally {
      upgraded.close();
      await Dexie.delete(databaseName);
    }
  });
});

describe("durable transactions and backups", () => {
  it("saves state and its activity atomically, and survives reopening", async () => {
    const g = await createGathering("Evening");
    await changeGathering(
      g.id,
      (s) => {
        s.players.push({ id: "a", name: "Alice", active: true });
      },
      "player",
      "Added Alice.",
    );
    db.close();
    await db.open();
    expect((await db.gatherings.get(g.id))?.players[0].name).toBe("Alice");
    expect(await db.activities.where("gatheringId").equals(g.id).count()).toBe(
      2,
    );
  });
  it("rolls back both state and activity on validation failure", async () => {
    const g = await createGathering("Evening");
    await expect(
      changeGathering(
        g.id,
        (s) => {
          s.name = "";
        },
        "gathering",
        "Invalid name.",
      ),
    ).rejects.toThrow();
    expect((await db.gatherings.get(g.id))?.name).toBe("Evening");
    expect(await db.activities.count()).toBe(1);
  });
  it("does not overwrite existing data when an import is malformed", async () => {
    const g = await createGathering("Keep me");
    await expect(
      restoreBackup({ version: 1, gatherings: [] }),
    ).rejects.toThrow();
    const b = await exportBackup();
    b.gatherings[0].payments.push({
      id: "bad",
      from: "missing",
      to: "other",
      amount: 1,
      createdAt: 1,
    });
    await expect(restoreBackup(b)).rejects.toThrow();
    expect((await db.gatherings.get(g.id))?.name).toBe("Keep me");
    expect(await db.activities.count()).toBe(1);
  });
  it("exports and restores all records exactly", async () => {
    const g = fixture();
    await db.gatherings.put(g);
    await db.activities.put({
      id: "e",
      gatheringId: g.id,
      roundId: "r1",
      createdAt: 2,
      kind: "round",
      message: "Finished first round.",
    });
    const b = await exportBackup();
    await db.gatherings.clear();
    await db.activities.clear();
    await restoreBackup(b);
    expect(await db.gatherings.get(g.id)).toEqual(g);
    expect(await db.activities.get("e")).toEqual(b.activities[0]);
  });
  it("rolls back a saved state if writing the audit entry fails", async () => {
    const g = await createGathering("Keep this name");
    const fail = () => {
      throw new Error("Simulated storage failure");
    };
    db.activities.hook("creating", fail);
    try {
      await expect(
        changeGathering(
          g.id,
          (s) => {
            s.name = "Never committed";
          },
          "gathering",
          "Renamed.",
        ),
      ).rejects.toThrow("Simulated");
    } finally {
      db.activities.hook("creating").unsubscribe(fail);
    }
    expect((await db.gatherings.get(g.id))?.name).toBe("Keep this name");
    expect(await db.activities.count()).toBe(1);
  });
  it("rolls back replacement if storage fails after clearing the old records", async () => {
    const g = await createGathering("Keep my games");
    const b = await exportBackup();
    b.gatherings[0].name = "Replacement";
    const fail = () => {
      throw new Error("Simulated restore failure");
    };
    db.activities.hook("creating", fail);
    try {
      await expect(restoreBackup(b)).rejects.toThrow("Simulated");
    } finally {
      db.activities.hook("creating").unsubscribe(fail);
    }
    expect((await db.gatherings.get(g.id))?.name).toBe("Keep my games");
    expect(await db.activities.count()).toBe(1);
  });
});
