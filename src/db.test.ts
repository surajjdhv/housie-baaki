import { afterEach, describe, expect, it } from "vitest";
import {
  db,
  createGathering,
  changeGathering,
  exportBackup,
  restoreBackup,
} from "./db";
import { fixture } from "./test-fixtures";

afterEach(async () => {
  await db.gatherings.clear();
  await db.activities.clear();
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
