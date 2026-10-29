import Dexie, { type Table } from "dexie";
import {
  type Gathering,
  type Activity,
  type Backup,
  uid,
  validateGathering,
  validateBackup,
} from "./domain";

export class HousieDB extends Dexie {
  gatherings!: Table<Gathering, string>;
  activities!: Table<Activity, string>;
  constructor(name = "housie-baaki") {
    super(name);
    this.version(1).stores({
      gatherings: "id, updatedAt, status",
      activities: "id, gatheringId, createdAt, [gatheringId+createdAt]",
    });
  }
}
export const db = new HousieDB();

export async function createGathering(name: string) {
  const now = Date.now();
  const g: Gathering = {
    id: uid(),
    name: name.trim(),
    status: "active",
    createdAt: now,
    updatedAt: now,
    players: [],
    rounds: [],
    payments: [],
  };
  validateGathering(g);
  await db.transaction("rw", db.gatherings, db.activities, async () => {
    await db.gatherings.add(g);
    await db.activities.add({
      id: uid(),
      gatheringId: g.id,
      createdAt: now,
      kind: "gathering",
      message: `Started ${g.name}.`,
    });
  });
  return g;
}

export async function changeGathering(
  id: string,
  change: (g: Gathering) => void,
  kind: string,
  message: string | ((g: Gathering) => string),
  roundId?: string,
) {
  await db.transaction("rw", db.gatherings, db.activities, async () => {
    const g = await db.gatherings.get(id);
    if (!g) throw new Error("This gathering no longer exists.");
    change(g);
    g.updatedAt = Math.max(Date.now(), g.updatedAt + 1);
    validateGathering(g);
    await db.gatherings.put(g);
    await db.activities.add({
      id: uid(),
      gatheringId: id,
      roundId,
      createdAt: g.updatedAt,
      kind,
      message: typeof message === "string" ? message : message(g),
    });
  });
}

export async function exportBackup(): Promise<Backup> {
  return db.transaction("r", db.gatherings, db.activities, async () => ({
    app: "housie-baaki",
    version: 1,
    exportedAt: Date.now(),
    gatherings: await db.gatherings.toArray(),
    activities: await db.activities.toArray(),
  }));
}
export async function restoreBackup(raw: unknown) {
  const b = validateBackup(raw);
  await db.transaction("rw", db.gatherings, db.activities, async () => {
    await db.gatherings.clear();
    await db.activities.clear();
    await db.gatherings.bulkAdd(b.gatherings);
    await db.activities.bulkAdd(b.activities);
  });
}
