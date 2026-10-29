import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function gathering(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a gathering" }).click();
  await page.getByLabel("Gathering name").fill("Friday night");
  await page
    .getByRole("button", { name: "Start gathering", exact: true })
    .click();
  for (const name of ["Alice", "Bob"]) {
    await page
      .getByRole("textbox", { name: "Player name", exact: true })
      .fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Player name", exact: true }),
    ).toHaveValue("");
  }
  await expect(page.locator(".player-row")).toHaveCount(2);
}
async function startRound(page: Page, first = true) {
  await page
    .getByRole("button", { name: "New round", exact: true })
    .first()
    .click();
  if (first) {
    await page
      .getByRole("button", { name: "Add a ticket for Alice", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add a ticket for Bob", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Let’s play", exact: true }).click();
  await page
    .getByRole("button", { name: "Number caller", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Call first number" }),
  ).toBeVisible();
}
async function awardAll(page: Page, winner: string) {
  await page.getByRole("button", { name: "Prizes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add winner", exact: true }).first(),
  ).toBeVisible();
  while (
    await page.getByRole("button", { name: "Add winner", exact: true }).count()
  ) {
    await page
      .getByRole("button", { name: "Add winner", exact: true })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: new RegExp(winner) })
      .check();
    await page
      .getByRole("button", { name: "Save winners", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await page.getByRole("button", { name: "Finish round", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Finish round", exact: true }),
  ).not.toBeVisible();
}
async function pay(page: Page, amount?: string) {
  await page
    .getByRole("button", { name: /Record payment/ })
    .first()
    .click();
  if (amount)
    await page.getByRole("dialog").getByRole("spinbutton").fill(amount);
  await page.getByRole("button", { name: "Confirm payment received" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

test("two rounds, caller recovery, a partial payment and final settlement", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await gathering(page);
  await startRound(page);
  await page.getByRole("button", { name: /Manual marking/ }).click();
  await page
    .getByRole("button", { name: "Number 42, not called", exact: true })
    .click();
  await expect(page.getByLabel("Latest number 42")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Latest number 42")).toBeVisible();
  await page.getByRole("button", { name: "Undo last", exact: true }).click();
  await expect(page.getByLabel("No numbers called")).toBeVisible();
  await page.getByRole("button", { name: "Call first number" }).click();
  await expect(page.locator(".number-ball")).toHaveText(/^\d+$/);
  await awardAll(page, "Bob");
  await page.getByRole("link", { name: "Settle up" }).click();
  await expect(page.locator(".transfer-amount")).toHaveText("₹20");
  await pay(page, "5");
  await expect(page.locator(".transfer-amount")).toHaveText("₹15");
  await page.getByRole("link", { name: "The table", exact: true }).click();
  await startRound(page, false);
  await awardAll(page, "Alice");
  await page.getByRole("link", { name: "Settle up" }).click();
  await expect(page.locator(".transfer-people strong")).toHaveText("Bob Alice");
  await expect(page.locator(".transfer-amount")).toHaveText("₹5");
  await pay(page);
  await expect(page.getByText("Nothing baaki. Nice.")).toBeVisible();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText("Alice paid Bob ₹5.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Bob paid Alice ₹5.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish gathering", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish gathering", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reopen gathering" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Reopen gathering" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a second tab is read-only and restoring cannot replace an open gathering", async ({
  page,
  context,
}) => {
  await gathering(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByText(/Another tab is managing/)).toBeVisible();
  await expect(
    other.getByRole("button", { name: "Add player", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Player name", exact: true })
    .fill("Chitra");
  await page.getByRole("button", { name: "Add player", exact: true }).click();
  await expect(other.locator(".player-row")).toHaveCount(3);
  await page.close();
  await other.reload();
  await expect(
    other.getByRole("textbox", { name: "Player name", exact: true }),
  ).toBeEnabled();
});

test("drafts, invalid budgets, winner corrections and payment reversals", async ({
  page,
}) => {
  await gathering(page);
  await page
    .getByRole("button", { name: "New round", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Let’s play", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page
    .getByRole("button", { name: "Add a ticket for Alice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add a ticket for Bob", exact: true })
    .click();
  await page.getByRole("button", { name: "Prizes", exact: true }).click();
  await page.getByLabel("Value for prize 1", { exact: true }).fill("10");
  await expect(page.getByText("5% left to allocate")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review round", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Balance last prize" }).click();
  await page.getByRole("button", { name: "Save draft for later" }).click();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Prizes", exact: true }).click();
  await expect(
    page.getByLabel("Value for prize 1", { exact: true }),
  ).toHaveValue("10");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Let’s play", exact: true }).click();
  await awardAll(page, "Bob");
  await page.getByRole("link", { name: "Settle up" }).click();
  await pay(page);
  await page
    .getByRole("button", { name: "Reverse payment from Alice to Bob" })
    .click();
  await page
    .getByRole("button", { name: "Reverse payment", exact: true })
    .click();
  await expect(page.locator(".transfer-amount")).toHaveText("₹20");
  await page.getByRole("link", { name: "Rounds & caller" }).click();
  await page
    .getByRole("button", { name: "Correct winners", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: /Bob/ })
    .uncheck();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: /Alice/ })
    .check();
  await page.getByRole("button", { name: "Save winners", exact: true }).click();
  await page.getByRole("link", { name: "Settle up" }).click();
  await expect(page.locator(".transfer-amount")).toHaveText("₹16");
});

test("backup validation, explicit restore, and safe replacement", async ({
  page,
  context,
}) => {
  await gathering(page);
  const gatheringUrl = page.url();
  await page.getByRole("link", { name: "Housie Baaki home" }).click();
  await page.getByRole("link", { name: "Backup & restore" }).click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await pendingDownload;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.gatherings[0].players).toHaveLength(2);
  await page.getByLabel("Choose backup file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":999}'),
  });
  await expect(page.getByRole("alert")).toContainText("invalid or unsupported");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const other = await context.newPage();
  await other.goto(gatheringUrl);
  await expect(
    other.getByRole("button", { name: "New round", exact: true }).first(),
  ).toBeEnabled();
  exported.gatherings[0].name = "Restored Friday";
  await page.getByLabel("Choose backup file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Replace & restore" }).click();
  await expect(page.getByRole("alert")).toContainText("open in another tab");
  await other.close();
  await page.getByRole("button", { name: "Replace & restore" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Restored Friday" }),
  ).toBeVisible();
});

test("production PWA reloads offline, serves local assets, and uses the Pages subpath", async ({
  page,
  context,
  request,
}) => {
  const external: string[] = [];
  page.on("request", (req) => {
    if (
      !req.url().startsWith("http://127.0.0.1:4173") &&
      !req.url().startsWith("blob:")
    )
      external.push(req.url());
  });
  await gathering(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const base = process.env.VITE_BASE_PATH || "/housie-baaki/";
  const manifest = await (
    await request.get(`${base}manifest.webmanifest`)
  ).json();
  expect(manifest.start_url).toBe(base);
  expect(manifest.scope).toBe(base);
  expect((await request.get(`${base}icon-192.png`)).ok()).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Friday night", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New round", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Add a ticket for Alice", exact: true })
    .click();
  await page.getByRole("button", { name: "Save draft for later" }).click();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Tickets for Alice", { exact: true }),
  ).toHaveValue("1");
  expect(external).toEqual([]);
});

test("phone and desktop layout, keyboard navigation and accessible screens", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: /Your game night/ }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("home-desktop.png"),
    fullPage: true,
  });
  const homeScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(homeScan.violations).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute(
    "aria-label",
    "Housie Baaki home",
  );
  for (const width of [556, 820, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const overlap = await page.evaluate(() => {
      const title = document
        .querySelector(".hero-copy h2")!
        .getBoundingClientRect();
      const art = document
        .querySelector(".art-ticket")!
        .getBoundingClientRect();
      return (
        title.left < art.right &&
        title.right > art.left &&
        title.top < art.bottom &&
        title.bottom > art.top
      );
    });
    expect(
      overlap,
      `Hero text must stay clear of the illustration at ${width}px`,
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(`home-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("home-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await gathering(page);
  await startRound(page);
  await page.screenshot({
    path: testInfo.outputPath("round-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Call first number" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const roundScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(roundScan.violations).toEqual([]);
});

test("custom fixed prizes, ticket-weighted shared wins, sitting out, and cancellation", async ({
  page,
}) => {
  await gathering(page);
  await page
    .getByRole("button", { name: "New round", exact: true })
    .first()
    .click();
  await page.getByLabel("Tickets for Alice", { exact: true }).fill("2");
  await page.getByLabel("Tickets for Bob", { exact: true }).fill("1");
  await page.getByLabel("Price per ticket", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Prizes", exact: true }).click();
  await page.getByRole("button", { name: "₹ Amounts", exact: true }).click();
  for (const prize of ["Second row", "Third row", "Early five", "Full house"]) {
    await page
      .getByRole("button", { name: `Remove ${prize}`, exact: true })
      .click();
  }
  await page
    .getByLabel("Prize 1 name", { exact: true })
    .fill("Corners & edges");
  await page.getByLabel("Value for prize 1", { exact: true }).fill("300");
  await page.getByLabel("Enable number caller", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Let’s play", exact: true }).click();
  await page
    .getByRole("button", { name: "Number caller", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Enable number caller" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Prizes", exact: true }).click();
  await page.getByRole("button", { name: "Add winner", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /Alice/ }).check();
  await dialog.getByLabel("Winning tickets").fill("2");
  await dialog.getByRole("checkbox", { name: /Bob/ }).check();
  await expect(
    dialog.getByText("2 bought · ₹200", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("1 bought · ₹100", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save winners", exact: true }).click();
  await expect(page.locator(".prize-card.awarded")).toHaveCount(1);
  await page.getByRole("button", { name: "Finish round", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Finish round", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("link", { name: "Settle up", exact: true }).click();
  await expect(page.getByText("Nothing baaki. Nice.")).toBeVisible();
  await page.getByRole("link", { name: "The table", exact: true }).click();
  await page
    .locator(".player-row")
    .filter({ hasText: "Bob" })
    .getByRole("button", { name: "Sit out", exact: true })
    .click();
  await expect(page.getByText("Sitting out future rounds")).toBeVisible();
  await page
    .getByRole("button", { name: "New round", exact: true })
    .first()
    .click();
  await expect(
    page.getByLabel("Tickets for Alice", { exact: true }),
  ).toHaveValue("2");
  await expect(page.getByLabel("Tickets for Bob", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Prizes", exact: true }).click();
  await expect(
    page.getByText("₹100 over the pool", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Balance last prize" }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Let’s play", exact: true }).click();
  await page.getByRole("button", { name: "Cancel round", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel round", exact: true })
    .click();
  await expect(
    page.getByText("This round was cancelled.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settle up", exact: true }).click();
  await expect(page.getByText("Nothing baaki. Nice.")).toBeVisible();
});

test.describe("Phone application experience", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("short setup steps, bottom sheets, contextual navigation and reachable controls", async ({
    page,
  }, testInfo) => {
    await page.goto("./");
    await page.getByRole("button", { name: "Start a gathering" }).click();
    const sheet = await page.getByRole("dialog").boundingBox();
    expect(sheet!.width).toBe(390);
    await expect
      .poll(async () => {
        const rect = await page.getByRole("dialog").boundingBox();
        return Math.round(rect!.y + rect!.height);
      })
      .toBe(844);
    await page.getByLabel("Gathering name").fill("Sunday with the gang");
    await page
      .getByRole("button", { name: "Start gathering", exact: true })
      .click();
    for (const name of ["Riya", "Aman"]) {
      await page.getByLabel("Player name", { exact: true }).fill(name);
      await page
        .getByRole("button", { name: "Add player", exact: true })
        .click();
      await expect(page.getByLabel("Player name", { exact: true })).toHaveValue(
        "",
      );
    }
    await page
      .getByRole("button", { name: "New round", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Tickets", exact: true }),
    ).toHaveAttribute("aria-current", "step");
    await expect(page.locator(".tickets-step")).toBeVisible();
    await expect(page.locator(".prizes-step")).not.toBeVisible();
    await page
      .getByRole("button", { name: "Add a ticket for Riya", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add a ticket for Aman", exact: true })
      .click();
    await page.screenshot({
      path: testInfo.outputPath("phone-setup.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Next: prizes", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Prizes", exact: true }),
    ).toHaveAttribute("aria-current", "step");
    await expect(page.locator(".tickets-step")).not.toBeVisible();
    await page
      .getByRole("button", { name: "Review round", exact: true })
      .click();
    await expect(page.locator(".setup-summary")).toBeVisible();
    await page.getByRole("button", { name: "Let’s play", exact: true }).click();
    await expect(page.locator(".prizes-panel")).toBeVisible();
    await expect(page.locator(".caller-panel")).not.toBeVisible();
    const firstAward = page
      .getByRole("button", { name: "Add winner", exact: true })
      .first();
    const awardBounds = await firstAward.boundingBox();
    const actionBounds = await page
      .locator(".round-complete-bar")
      .boundingBox();
    expect(awardBounds!.height).toBeGreaterThanOrEqual(44);
    expect(awardBounds!.y + awardBounds!.height).toBeLessThanOrEqual(
      actionBounds!.y,
    );
    await page.screenshot({
      path: testInfo.outputPath("phone-prizes.png"),
      fullPage: true,
    });
    await firstAward.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: /Riya/ })
      .check();
    await page.screenshot({
      path: testInfo.outputPath("phone-winner-sheet.png"),
    });
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    await page
      .getByRole("button", { name: "Save winners", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Number caller", exact: true })
      .click();
    const callBounds = await page
      .getByRole("button", { name: "Call first number", exact: true })
      .boundingBox();
    expect(callBounds!.y + callBounds!.height).toBeLessThanOrEqual(
      actionBounds!.y,
    );
    await page.getByRole("button", { name: /Manual marking/ }).click();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const tile = await page
        .locator(".number-board button:not(:disabled)")
        .first()
        .boundingBox();
      expect(tile!.width).toBeGreaterThanOrEqual(44);
      expect(tile!.height).toBeGreaterThanOrEqual(44);
      for (const link of await page
        .getByRole("navigation", { name: "Gathering sections" })
        .getByRole("link")
        .all()) {
        const rect = await link.boundingBox();
        expect(rect!.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
