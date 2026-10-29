import { type Gathering } from "./domain";

export function fixture(): Gathering {
  return {
    id: "night",
    name: "Game night",
    status: "active",
    createdAt: 1,
    updatedAt: 2,
    players: ["a", "b", "c"].map((id) => ({
      id,
      name: id.toUpperCase(),
      active: true,
    })),
    payments: [],
    rounds: [
      {
        id: "r1",
        number: 1,
        status: "completed",
        ticketPrice: 10_000,
        tickets: { a: 2, b: 1, c: 1 },
        mode: "amount",
        caller: true,
        called: [],
        createdAt: 1,
        completedAt: 2,
        prizes: [
          {
            id: "small",
            name: "First row",
            value: 5000,
            winners: [{ playerId: "b", tickets: 1 }],
          },
          {
            id: "big",
            name: "Full house",
            value: 35_000,
            winners: [{ playerId: "c", tickets: 1 }],
          },
        ],
      },
    ],
  };
}
