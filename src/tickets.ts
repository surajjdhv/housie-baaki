import { z } from "zod";

// Legacy backup metadata only; prizes are now checked manually.
export const verificationRuleSchema = z.enum([
  "manual",
  "row1",
  "row2",
  "row3",
  "corners",
  "earlyFive",
  "fullHouse",
]);
export type VerificationRule = z.infer<typeof verificationRuleSchema>;
export const RULE_LABELS: Record<VerificationRule, string> = {
  manual: "Manual / custom prize",
  row1: "First row",
  row2: "Second row",
  row3: "Third row",
  corners: "Corners",
  earlyFive: "Early five",
  fullHouse: "Full house",
};
export const roundKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{21}[AQgw]$/, "Invalid round key.");
export const ticketIdSchema = z
  .string()
  .regex(/^\d{4}$/, "Enter exactly four digits, including leading zeros.");
const callsSchema = z
  .array(z.number().int().min(1).max(90))
  .max(90)
  .refine((a) => new Set(a).size === a.length, "Duplicate called numbers.");
export const verificationEvidenceSchema = z.object({
  ticketId: ticketIdSchema,
  algorithm: z.literal(1),
  rule: verificationRuleSchema.exclude(["manual"]),
  called: callsSchema,
  verifiedAt: z.number().int().nonnegative(),
});
export const roundPayloadSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal(1),
  roundId: z.string().min(1).max(100),
  key: roundKeySchema,
  name: z.string().trim().min(1).max(80),
  roundNumber: z.number().int().positive(),
});
export type RoundPayload = z.infer<typeof roundPayloadSchema>;
export const playerTicketSchema = z
  .object({
    roundId: z.string().min(1).max(100),
    payload: roundPayloadSchema,
    ticketId: ticketIdSchema,
    createdAt: z.number().int().nonnegative(),
    marks: z
      .array(z.number().int().min(1).max(90))
      .max(15)
      .refine((a) => new Set(a).size === a.length, "Duplicate marks."),
  })
  .refine(
    (t) => t.roundId === t.payload.roundId,
    "Ticket belongs to a different round.",
  );
export type PlayerTicket = z.infer<typeof playerTicketSchema>;
export type TicketGrid = (number | null)[][];
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function createRoundKey() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}
export function randomTicketId() {
  const bytes = new Uint32Array(1),
    limit = 0x1_0000_0000 - (0x1_0000_0000 % 10_000);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= limit);
  return String(bytes[0] % 10_000).padStart(4, "0");
}

/** Frozen v1 protocol: SHA-256 of this UTF-8 string; big-endian 32-bit draws. */
async function ticketV1(key: string, ticketId: string): Promise<TicketGrid> {
  let counter = 0,
    words: number[] = [];
  async function bounded(max: number) {
    const limit = 0x1_0000_0000 - (0x1_0000_0000 % max);
    for (;;) {
      if (!words.length) {
        const input = new TextEncoder().encode(
          `housie-baaki/ticket/v1|${key}|${ticketId}|${counter++}`,
        );
        const bytes = await crypto.subtle.digest("SHA-256", input);
        const view = new DataView(bytes);
        words = Array.from({ length: 8 }, (_, i) =>
          view.getUint32(i * 4, false),
        );
      }
      const value = words.shift()!;
      if (value < limit) return value % max;
    }
  }
  async function shuffle(values: number[]) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = await bounded(i + 1);
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  }
  let rows: number[][];
  do {
    rows = [];
    for (let i = 0; i < 3; i++)
      rows.push(
        (await shuffle(Array.from({ length: 9 }, (_, c) => c))).slice(0, 5),
      );
  } while (new Set(rows.flat()).size !== 9);
  const grid: TicketGrid = Array.from({ length: 3 }, () => Array(9).fill(null));
  for (let col = 0; col < 9; col++) {
    const occupied = rows
      .map((columns, row) => (columns.includes(col) ? row : -1))
      .filter((n) => n >= 0);
    const low = col === 0 ? 1 : col * 10,
      high = col === 8 ? 90 : col * 10 + 9;
    const numbers = (
      await shuffle(Array.from({ length: high - low + 1 }, (_, i) => low + i))
    )
      .slice(0, occupied.length)
      .sort((a, b) => a - b);
    occupied.forEach((row, i) => {
      grid[row][col] = numbers[i];
    });
  }
  return grid;
}
const cache = new Map<string, Promise<TicketGrid>>();
export async function generateTicket(
  key: string,
  ticketId: string,
  algorithm: number = 1,
): Promise<TicketGrid> {
  roundKeySchema.parse(key);
  ticketIdSchema.parse(ticketId);
  if (algorithm !== 1)
    throw new Error(
      "This ticket algorithm is not supported. Update the app before going offline.",
    );
  const cacheKey = `${algorithm}:${key}:${ticketId}`;
  if (!cache.has(cacheKey)) {
    if (cache.size >= 512) cache.delete(cache.keys().next().value!);
    const pending = ticketV1(key, ticketId).catch((error) => {
      cache.delete(cacheKey);
      throw error;
    });
    cache.set(cacheKey, pending);
  }
  return structuredClone(await cache.get(cacheKey)!);
}
export function ticketNumbers(grid: TicketGrid) {
  return grid.flat().filter((n): n is number => n !== null);
}
/** Fragment-only payload. Parsing never navigates to or fetches the encoded URL. */
export function encodeRoundLink(payload: RoundPayload, appUrl: string) {
  const valid = roundPayloadSchema.parse(payload);
  const data = base64url(new TextEncoder().encode(JSON.stringify(valid)));
  const url = new URL(appUrl);
  url.hash = `/join/HB1.${data}`;
  url.search = "";
  return url.href;
}
export function parseRoundLink(value: string): RoundPayload {
  if (value.length > 4096) throw new Error("This round QR is too large.");
  let data = value.trim();
  if (data.startsWith("https://") || data.startsWith("http://")) {
    const url = new URL(data);
    if (!url.hash.startsWith("#/join/"))
      throw new Error("This is not a Housie Baaki round QR.");
    data = url.hash.slice("#/join/".length);
  } else if (data.startsWith("#/join/")) data = data.slice("#/join/".length);
  if (!/^HB1\.[A-Za-z0-9_-]+$/.test(data))
    throw new Error("This is not a supported Housie Baaki round QR.");
  try {
    const binary = atob(data.slice(4).replace(/-/g, "+").replace(/_/g, "/"));
    return roundPayloadSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(binary, (c) => c.charCodeAt(0)),
        ),
      ),
    );
  } catch {
    throw new Error("This round QR is invalid or needs a newer app version.");
  }
}
