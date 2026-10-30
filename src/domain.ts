import { z } from "zod";
import {
  generateTicket,
  playerTicketSchema,
  roundKeySchema,
  ticketIdSchema,
  verificationEvidenceSchema,
  verificationRuleSchema,
} from "./tickets";

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(80);
const money = z.number().int().min(0).max(100_000_000_000);
const time = z.number().int().nonnegative();
export const playerSchema = z.object({ id, name, active: z.boolean() });
export const prizeSchema = z.object({
  id,
  name,
  value: money,
  verificationRule: verificationRuleSchema.optional(),
  winners: z
    .array(
      z.object({
        playerId: id,
        tickets: z.number().int().min(1).max(10_000),
        ticketId: ticketIdSchema.optional(),
        verification: verificationEvidenceSchema.optional(),
      }),
    )
    .max(1000),
});
export const roundSchema = z.object({
  id,
  number: z.number().int().positive(),
  status: z.enum(["draft", "playing", "completed", "cancelled"]),
  ticketPrice: money,
  tickets: z.record(z.string(), z.number().int().min(0).max(10_000)),
  mode: z.enum(["amount", "percent"]),
  prizes: z.array(prizeSchema).max(100),
  caller: z.boolean(),
  called: z.array(z.number().int().min(1).max(90)).max(90),
  digital: z
    .object({ algorithm: z.literal(1), key: roundKeySchema })
    .optional(),
  createdAt: time,
  completedAt: time.optional(),
});
export const paymentSchema = z.object({
  id,
  from: id,
  to: id,
  amount: money.refine((n) => n > 0, "Enter a positive payment."),
  createdAt: time,
  reversedAt: time.optional(),
});
export const gatheringSchema = z.object({
  id,
  name,
  status: z.enum(["active", "closed"]),
  createdAt: time,
  updatedAt: time,
  players: z.array(playerSchema).max(1000),
  rounds: z.array(roundSchema).max(10_000),
  payments: z.array(paymentSchema).max(100_000),
});
export const activitySchema = z.object({
  id,
  gatheringId: id,
  roundId: id.optional(),
  createdAt: time,
  kind: z.string().min(1).max(80),
  message: z.string().min(1).max(200_000),
  prizeId: id.optional(),
  playerId: id.optional(),
  ticketId: ticketIdSchema.optional(),
  verification: verificationEvidenceSchema.optional(),
});
const legacyBackupSchema = z.object({
  app: z.literal("housie-baaki"),
  version: z.literal(1),
  exportedAt: time,
  gatherings: z.array(gatheringSchema),
  activities: z.array(activitySchema),
});
export const backupSchema = z
  .discriminatedUnion("version", [
    legacyBackupSchema,
    legacyBackupSchema.extend({
      version: z.literal(2),
      playerTickets: z.array(playerTicketSchema),
    }),
  ])
  .transform((b) => ({
    ...b,
    version: 2 as const,
    playerTickets: "playerTickets" in b ? b.playerTickets : [],
  }));

export type Player = z.infer<typeof playerSchema>;
export type Prize = z.infer<typeof prizeSchema>;
export type Round = z.infer<typeof roundSchema>;
export type Gathering = z.infer<typeof gatheringSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Backup = z.infer<typeof backupSchema>;
export type Transfer = { from: string; to: string; amount: number };
export type Entry = { label: string; amount: number; at: number };

export const uid = () => crypto.randomUUID();
export const rupees = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: value % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value / 100);
export function parseMoney(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter an amount with up to two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 100_000_000_000)
    throw new Error("That amount is too large.");
  return result;
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function unique(values: string[], message: string) {
  ensure(new Set(values).size === values.length, message);
}
export function pool(round: Round) {
  const result =
    Object.values(round.tickets).reduce((a, n) => a + n, 0) * round.ticketPrice;
  return result;
}

/** Hamilton apportionment. Ties use stable IDs, never input or render order. */
export function allocate(
  total: number,
  shares: { id: string; weight: number }[],
): Record<string, number> {
  ensure(Number.isSafeInteger(total) && total >= 0, "Invalid total.");
  unique(
    shares.map((s) => s.id),
    "Duplicate allocation recipient.",
  );
  ensure(
    shares.every((s) => Number.isSafeInteger(s.weight) && s.weight > 0),
    "Shares must be positive integers.",
  );
  const sum = shares.reduce((a, s) => a + s.weight, 0);
  if (!shares.length) {
    ensure(total === 0, "Add a recipient.");
    return {};
  }
  const parts = shares.map((s) => {
    const numerator = BigInt(total) * BigInt(s.weight);
    return {
      id: s.id,
      amount: Number(numerator / BigInt(sum)),
      remainder: numerator % BigInt(sum),
    };
  });
  let left = total - parts.reduce((a, p) => a + p.amount, 0);
  parts.sort((a, b) =>
    a.remainder === b.remainder
      ? a.id.localeCompare(b.id)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const p of parts) if (left-- > 0) p.amount++;
  return Object.fromEntries(parts.map((p) => [p.id, p.amount]));
}
export function prizeAmounts(round: Round): Record<string, number> {
  if (round.mode === "amount")
    return Object.fromEntries(round.prizes.map((p) => [p.id, p.value]));
  if (round.prizes.reduce((a, p) => a + p.value, 0) !== 10_000)
    return Object.fromEntries(
      round.prizes.map((p) => [
        p.id,
        Math.floor((pool(round) * p.value) / 10_000),
      ]),
    );
  return allocate(
    pool(round),
    round.prizes
      .filter((p) => p.value > 0)
      .map((p) => ({ id: p.id, weight: p.value })),
  );
}
export function prizeShares(
  round: Round,
  prize: Prize,
): Record<string, number> {
  if (!prize.winners.length) return {};
  return allocate(
    prizeAmounts(round)[prize.id] || 0,
    prize.winners.map((w) => ({ id: w.playerId, weight: w.tickets })),
  );
}
export function validateBudget(round: Round) {
  ensure(
    Number.isSafeInteger(pool(round)) && pool(round) <= 100_000_000_000,
    "The ticket pool is too large.",
  );
  ensure(
    round.ticketPrice > 0 && pool(round) > 0,
    "Add a ticket price and at least one ticket.",
  );
  ensure(
    round.prizes.length > 0 && round.prizes.every((p) => p.value > 0),
    "Give every prize a positive value.",
  );
  const total = round.prizes.reduce((a, p) => a + p.value, 0);
  ensure(
    total === (round.mode === "percent" ? 10_000 : pool(round)),
    round.mode === "percent"
      ? "Prize percentages must total 100%."
      : "Prizes must equal the ticket pool.",
  );
  ensure(
    Object.values(prizeAmounts(round)).every((n) => n > 0),
    "The pool is too small for these prizes.",
  );
}
export function validateGathering(g: Gathering) {
  gatheringSchema.parse(g);
  unique(
    g.players.map((p) => p.id),
    "Duplicate player ID.",
  );
  unique(
    g.players.map((p) => p.name.toLocaleLowerCase()),
    "Each player needs a different name.",
  );
  unique(
    g.rounds.map((r) => r.id),
    "Duplicate round ID.",
  );
  unique(
    g.rounds.map((r) => String(r.number)),
    "Duplicate round number.",
  );
  unique(
    g.payments.map((p) => p.id),
    "Duplicate payment ID.",
  );
  ensure(
    g.rounds.filter((r) => ["draft", "playing"].includes(r.status)).length <= 1,
    "Finish the current round first.",
  );
  ensure(
    g.status !== "closed" ||
      !g.rounds.some((r) => ["draft", "playing"].includes(r.status)),
    "Finish or cancel the current round before closing.",
  );
  const playerIds = new Set(g.players.map((p) => p.id));
  for (const r of g.rounds) {
    ensure(
      Object.keys(r.tickets).every((p) => playerIds.has(p)),
      "Unknown ticket owner.",
    );
    unique(
      r.prizes.map((p) => p.id),
      "Duplicate prize ID.",
    );
    unique(
      r.prizes.map((p) => p.name.toLocaleLowerCase()),
      "Each prize needs a different name.",
    );
    ensure(
      new Set(r.called).size === r.called.length,
      "A number cannot be called twice.",
    );
    if (["playing", "completed"].includes(r.status)) validateBudget(r);
    for (const p of r.prizes) {
      ensure(
        r.mode !== "percent" || p.value <= 10_000,
        "A percentage cannot exceed 100%.",
      );
      unique(
        p.winners.map((w) => w.playerId),
        "A winner is listed twice.",
      );
      for (const w of p.winners) {
        ensure(
          playerIds.has(w.playerId) &&
            w.tickets <= (r.tickets[w.playerId] || 0),
          "Winning tickets cannot exceed tickets bought.",
        );
        if (w.ticketId)
          ensure(
            w.tickets === 1 && r.digital,
            "A digital award must have one ticket and a round key.",
          );
      }
      if (r.status === "completed")
        ensure(
          p.winners.length > 0,
          "Assign winners to every prize before finishing.",
        );
    }
  }
  for (const p of g.payments)
    ensure(
      p.from !== p.to && playerIds.has(p.from) && playerIds.has(p.to),
      "Choose two different players for a payment.",
    );
}

export function playerEntries(g: Gathering, playerId: string): Entry[] {
  const entries: Entry[] = [];
  for (const r of g.rounds.filter((r) => r.status === "completed")) {
    const cost = (r.tickets[playerId] || 0) * r.ticketPrice;
    if (cost)
      entries.push({
        label: `Round ${r.number} · ${r.tickets[playerId]} ticket${r.tickets[playerId] === 1 ? "" : "s"}`,
        amount: -cost,
        at: r.completedAt || r.createdAt,
      });
    for (const p of r.prizes) {
      const amount = prizeShares(r, p)[playerId];
      if (amount)
        entries.push({
          label: `Round ${r.number} · ${p.name}`,
          amount,
          at: r.completedAt || r.createdAt,
        });
    }
  }
  for (const p of g.payments.filter((p) => !p.reversedAt)) {
    if (p.from === playerId)
      entries.push({
        label: `Paid ${g.players.find((x) => x.id === p.to)?.name}`,
        amount: p.amount,
        at: p.createdAt,
      });
    if (p.to === playerId)
      entries.push({
        label: `Received from ${g.players.find((x) => x.id === p.from)?.name}`,
        amount: -p.amount,
        at: p.createdAt,
      });
  }
  return entries.sort((a, b) => a.at - b.at);
}
export function balances(g: Gathering) {
  const result: Record<string, number> = Object.fromEntries(
    g.players.map((p) => [p.id, 0]),
  );
  for (const r of g.rounds.filter((r) => r.status === "completed")) {
    for (const [id, count] of Object.entries(r.tickets))
      result[id] -= count * r.ticketPrice;
    for (const p of r.prizes)
      for (const [id, amount] of Object.entries(prizeShares(r, p)))
        result[id] += amount;
  }
  for (const p of g.payments.filter((p) => !p.reversedAt)) {
    result[p.from] += p.amount;
    result[p.to] -= p.amount;
  }
  return result;
}
export function settlements(g: Gathering): Transfer[] {
  const values = balances(g);
  const debtors = Object.entries(values)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, amount: -v }));
  const creditors = Object.entries(values)
    .filter(([, v]) => v > 0)
    .map(([id, amount]) => ({ id, amount }));
  const sort = (
    a: { id: string; amount: number },
    b: { id: string; amount: number },
  ) => b.amount - a.amount || a.id.localeCompare(b.id);
  const result: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(sort);
    creditors.sort(sort);
    const d = debtors[0],
      c = creditors[0],
      amount = Math.min(d.amount, c.amount);
    result.push({ from: d.id, to: c.id, amount });
    d.amount -= amount;
    c.amount -= amount;
    if (!d.amount) debtors.shift();
    if (!c.amount) creditors.shift();
  }
  return result;
}
export function nextCalled(called: number[], manual?: number): number {
  const remaining = Array.from({ length: 90 }, (_, i) => i + 1).filter(
    (n) => !called.includes(n),
  );
  ensure(remaining.length, "All 90 numbers have been called.");
  if (manual !== undefined) {
    ensure(
      remaining.includes(manual),
      "That number is invalid or already called.",
    );
    return manual;
  }
  // Rejection sampling avoids modulo bias.
  const range = 0x1_0000_0000,
    limit = range - (range % remaining.length);
  const random = new Uint32Array(1);
  do {
    crypto.getRandomValues(random);
  } while (random[0] >= limit);
  return remaining[random[0] % remaining.length];
}
export function newRound(g: Gathering): Round {
  ensure(g.status === "active", "Reopen this gathering to add a round.");
  ensure(
    !g.rounds.some((r) => ["draft", "playing"].includes(r.status)),
    "Finish or cancel the current round first.",
  );
  const previous = [...g.rounds]
    .reverse()
    .find((r) => r.status === "completed");
  return {
    id: uid(),
    number: g.rounds.length + 1,
    status: "draft",
    ticketPrice: previous?.ticketPrice || 2000,
    tickets: Object.fromEntries(
      g.players
        .filter((p) => p.active)
        .map((p) => [p.id, previous?.tickets[p.id] || 0]),
    ),
    mode: previous?.mode || "percent",
    caller: previous?.caller ?? true,
    called: [],
    createdAt: Date.now(),
    prizes: previous
      ? previous.prizes.map((p) => ({
          ...p,
          id: uid(),
          winners: [],
        }))
      : [
          {
            id: uid(),
            name: "First row",
            value: 1500,
            winners: [],
          },
          {
            id: uid(),
            name: "Second row",
            value: 1500,
            winners: [],
          },
          {
            id: uid(),
            name: "Third row",
            value: 1500,
            winners: [],
          },
          {
            id: uid(),
            name: "Early five",
            value: 1500,
            winners: [],
          },
          {
            id: uid(),
            name: "Full house",
            value: 4000,
            winners: [],
          },
        ],
  };
}
export function validateBackup(raw: unknown): Backup {
  const b = backupSchema.parse(raw);
  unique(
    b.gatherings.map((g) => g.id),
    "Duplicate gatherings in backup.",
  );
  unique(
    b.activities.map((a) => a.id),
    "Duplicate activities in backup.",
  );
  b.gatherings.forEach(validateGathering);
  unique(
    b.playerTickets.map((t) => t.roundId),
    "Duplicate player tickets in backup.",
  );
  for (const ticket of b.playerTickets) {
    const hostRound = b.gatherings
      .flatMap((g) => g.rounds)
      .find((r) => r.id === ticket.roundId);
    ensure(
      !hostRound?.digital || hostRound.digital.key === ticket.payload.key,
      "Player ticket has a different key from the host round.",
    );
  }
  for (const a of b.activities) {
    const g = b.gatherings.find((g) => g.id === a.gatheringId);
    ensure(
      g && (!a.roundId || g.rounds.some((r) => r.id === a.roundId)),
      "Backup contains an activity without a matching gathering or round.",
    );
    if (a.verification || a.ticketId) {
      const round = g?.rounds.find((r) => r.id === a.roundId);
      ensure(
        round?.digital &&
          round.prizes.some((p) => p.id === a.prizeId) &&
          g?.players.some((p) => p.id === a.playerId),
        "Ticket activity has no matching prize or player.",
      );
    }
  }
  return b;
}

/** Award only after the organizer has compared the ticket and checked the claim. */
export function applyDigitalAward(
  g: Gathering,
  roundId: string,
  prizeId: string,
  playerId: string,
  ticketId: string,
) {
  ticketIdSchema.parse(ticketId);
  const r = g.rounds.find((r) => r.id === roundId),
    p = r?.prizes.find((p) => p.id === prizeId);
  ensure(
    r && p && r.status === "playing",
    "Record digital awards in the round currently being played.",
  );
  ensure(r.digital, "Open the round QR once before checking digital tickets.");
  ensure(
    g.players.some((player) => player.id === playerId) &&
      (r.tickets[playerId] || 0) >= 1,
    "This player needs a logged ticket purchase.",
  );
  const existing = p.winners.find((w) => w.playerId === playerId);
  if (
    existing &&
    (existing.ticketId ?? existing.verification?.ticketId) === ticketId
  )
    return { alreadyAwarded: true, sharedCode: false };
  ensure(
    !existing,
    "This player already has an award for this prize. Correct that award before replacing it.",
  );
  const sharedCode = p.winners.some(
    (w) => (w.ticketId ?? w.verification?.ticketId) === ticketId,
  );
  p.winners.push({ playerId, tickets: 1, ticketId });
  return { alreadyAwarded: false, sharedCode };
}
export async function validateBackupContents(raw: unknown): Promise<Backup> {
  const b = validateBackup(raw);
  for (const t of b.playerTickets) {
    const grid = await generateTicket(
      t.payload.key,
      t.ticketId,
      t.payload.algorithm,
    );
    ensure(
      t.marks.every((n) => grid.flat().includes(n)),
      "Saved marks do not belong to this ticket.",
    );
  }
  return b;
}
