import Dexie, { type Table } from "dexie";
import {
  type Gathering,
  type Activity,
  type Backup,
  uid,
  validateGathering,
  validateBackupContents,
  validateDigitalClaims,
  applyVerifiedClaim,
} from "./domain";
import {
  roundPayloadSchema,
  randomTicketId,
  generateTicket,
  type PlayerTicket,
  type RoundPayload,
} from "./tickets";

export class HousieDB extends Dexie {
  gatherings!: Table<Gathering, string>;
  activities!: Table<Activity, string>;
  playerTickets!: Table<PlayerTicket, string>;
  constructor(name = "housie-baaki") {
    super(name);
    this.version(1).stores({
      gatherings: "id, updatedAt, status",
      activities: "id, gatheringId, createdAt, [gatheringId+createdAt]",
    });
    this.version(2).stores({ playerTickets: "roundId, createdAt" });
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
  change: (g: Gathering) => void | Promise<void>,
  kind: string,
  message: string | ((g: Gathering) => string),
  roundId?: string,
) {
  await db.transaction("rw", db.gatherings, db.activities, async () => {
    const g = await db.gatherings.get(id);
    if (!g) throw new Error("This gathering no longer exists.");
    const keys = new Map(
      g.rounds.filter((r) => r.digital).map((r) => [r.id, r.digital!.key]),
    );
    const pending = change(g);
    if (pending) await Dexie.waitFor(pending);
    for (const r of g.rounds)
      if (keys.has(r.id) && keys.get(r.id) !== r.digital?.key)
        throw new Error("A shared round key cannot change.");
    g.updatedAt = Math.max(Date.now(), g.updatedAt + 1);
    validateGathering(g);
    await Dexie.waitFor(validateDigitalClaims(g));
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
  return db.transaction(
    "r",
    db.gatherings,
    db.activities,
    db.playerTickets,
    async () => ({
      app: "housie-baaki",
      version: 2,
      exportedAt: Date.now(),
      gatherings: await db.gatherings.toArray(),
      activities: await db.activities.toArray(),
      playerTickets: await db.playerTickets.toArray(),
    }),
  );
}
export async function restoreBackup(raw: unknown) {
  const b = await validateBackupContents(raw);
  await db.transaction(
    "rw",
    db.gatherings,
    db.activities,
    db.playerTickets,
    async () => {
      await db.gatherings.clear();
      await db.activities.clear();
      await db.playerTickets.clear();
      await db.gatherings.bulkAdd(b.gatherings);
      await db.activities.bulkAdd(b.activities);
      await db.playerTickets.bulkAdd(b.playerTickets);
    },
  );
}

export async function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request("housie-storage", { mode: "shared" }, fn);
  return fn();
}
export async function joinRound(input: RoundPayload) {
  const payload = roundPayloadSchema.parse(input);
  return withStorageLock(() =>
    db.transaction("rw", db.playerTickets, async () => {
      const existing = await db.playerTickets.get(payload.roundId);
      if (existing) {
        if (existing.payload.key !== payload.key)
          throw new Error(
            "This round has a different key from your saved ticket. Ask the host for the original QR.",
          );
        return existing;
      }
      const ticket: PlayerTicket = {
        roundId: payload.roundId,
        payload,
        ticketId: randomTicketId(),
        createdAt: Date.now(),
        marks: [],
      };
      await db.playerTickets.add(ticket);
      return ticket;
    }),
  );
}
export async function toggleTicketMark(roundId: string, number: number) {
  return withStorageLock(() =>
    db.transaction("rw", db.playerTickets, async () => {
      const ticket = await db.playerTickets.get(roundId);
      if (!ticket) throw new Error("This ticket no longer exists.");
      const grid = await Dexie.waitFor(
        generateTicket(ticket.payload.key, ticket.ticketId),
      );
      if (!grid.flat().includes(number))
        throw new Error("That number is not on this ticket.");
      ticket.marks = ticket.marks.includes(number)
        ? ticket.marks.filter((n) => n !== number)
        : [...ticket.marks, number];
      await db.playerTickets.put(ticket);
    }),
  );
}
export async function awardDigitalClaim(
  gatheringId: string,
  roundId: string,
  prizeId: string,
  playerId: string,
  ticketId: string,
) {
  return db.transaction("rw", db.gatherings, db.activities, async () => {
    const g = await db.gatherings.get(gatheringId);
    if (!g) throw new Error("This gathering no longer exists.");
    const result = await Dexie.waitFor(
      applyVerifiedClaim(g, roundId, prizeId, playerId, ticketId),
    );
    if (result.alreadyAwarded) return result;
    validateGathering(g);
    await Dexie.waitFor(validateDigitalClaims(g));
    g.updatedAt = Math.max(Date.now(), g.updatedAt + 1);
    const round = g.rounds.find((r) => r.id === roundId)!,
      prize = round.prizes.find((p) => p.id === prizeId)!;
    await db.gatherings.put(g);
    await db.activities.add({
      id: uid(),
      gatheringId,
      roundId,
      kind: "award",
      createdAt: g.updatedAt,
      message: `Verified ${prize.name} for ${g.players.find((p) => p.id === playerId)!.name}, ticket ${ticketId}, in round ${round.number} after ${round.called.length} calls.${result.sharedCode ? " Same ID as another winner: tickets are identical and share the prize." : ""}`,
      prizeId,
      playerId,
      verification: structuredClone(
        prize.winners.find((w) => w.playerId === playerId)!.verification!,
      ),
    });
    return result;
  });
}
