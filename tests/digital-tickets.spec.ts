import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function readyOffline(context: BrowserContext, page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
}
async function hostRound(page: Page) {
  await page.goto("./");
  await page
    .getByRole("button", { name: "Start a gathering", exact: true })
    .click();
  await page.getByLabel("Gathering name").fill("Offline ticket night");
  await page
    .getByRole("button", { name: "Start gathering", exact: true })
    .click();
  for (const name of ["Alice", "Bob"]) {
    await page.getByLabel("Player name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
    await expect(page.getByLabel("Player name", { exact: true })).toHaveValue(
      "",
    );
  }
  await page
    .getByRole("button", { name: "New round", exact: true })
    .first()
    .click();
  for (const name of ["Alice", "Bob"])
    await page.getByLabel(`Tickets for ${name}`, { exact: true }).fill("1");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Let’s play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show round QR", exact: true }),
  ).toBeVisible();
}
async function openClaim(page: Page, code: string, player = "Alice") {
  await page.getByRole("button", { name: "Prizes", exact: true }).click();
  const prize = page.locator(".prize-card").filter({
    has: page.getByRole("heading", { name: "First row", exact: true }),
  });
  await prize.getByRole("button", { name: /Add winner|Edit winners/ }).click();
  await page
    .getByRole("button", { name: "Verify digital ticket", exact: true })
    .click();
  await page
    .getByLabel("Winner", { exact: true })
    .selectOption({ label: player });
  await page.getByLabel("Four-digit ticket ID", { exact: true }).fill(code);
}

test("QR generation, image decoding, tickets, claims, ties and undo all work offline", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await hostRound(page);
  await readyOffline(context, page);
  const hostUrl = page.url();
  await page
    .getByRole("button", { name: "Show round QR", exact: true })
    .click();
  const image = page.getByAltText("Round 1 QR code", { exact: true });
  await expect(image).toBeVisible();
  const imageUrl = (await image.getAttribute("src"))!;
  const qr = Buffer.from(imageUrl.split(",")[1], "base64");
  const roundLink = await page
    .getByLabel("Round link", { exact: true })
    .inputValue();
  await page.screenshot({ path: testInfo.outputPath("host-round-qr.png") });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: "Show round QR", exact: true })
    .click();
  await expect(page.getByLabel("Round link", { exact: true })).toHaveValue(
    roundLink,
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  // Exercise the bundled JS worker rather than relying on native BarcodeDetector support.
  await playerContext.addInitScript(() => {
    Reflect.deleteProperty(window, "BarcodeDetector");
  });
  const player = await playerContext.newPage();
  const external: string[] = [];
  player.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4173") &&
      !request.url().startsWith("data:") &&
      !request.url().startsWith("blob:")
    )
      external.push(request.url());
  });
  await player.goto("./");
  await readyOffline(playerContext, player);
  await player.getByRole("link", { name: "My tickets", exact: true }).click();
  await player
    .getByRole("link", { name: "Scan round QR", exact: true })
    .click();
  await player
    .getByLabel("Choose round QR image")
    .setInputFiles({ name: "round.png", mimeType: "image/png", buffer: qr });
  await expect(player.locator(".ticket-code strong")).toHaveText(/^\d{4}$/);
  const code = (await player.locator(".ticket-code strong").textContent())!;
  const cells = await player
    .locator(".digital-ticket-grid > *")
    .allTextContents();
  const row = cells.slice(0, 9).filter(Boolean).map(Number);
  expect(row).toHaveLength(5);
  const all = cells.filter(Boolean).map(Number);
  await player
    .getByRole("button", { name: `Mark number ${all[0]}`, exact: true })
    .click();
  await expect(
    player.getByRole("button", {
      name: `Unmark number ${all[0]}`,
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await player.reload();
  await expect(player.locator(".ticket-code strong")).toHaveText(code);
  await expect(
    player.getByRole("button", {
      name: `Unmark number ${all[0]}`,
      exact: true,
    }),
  ).toBeVisible();
  await player.screenshot({
    path: testInfo.outputPath("player-markable-ticket.png"),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page: player })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await second.goto("./");
  await readyOffline(secondContext, second);
  await second.goto(roundLink);
  await expect(second.locator(".ticket-code strong")).toHaveText(/^\d{4}$/);
  const secondCode = await second.locator(".ticket-code strong").textContent();
  await second.reload();
  await expect(second.locator(".ticket-code strong")).toHaveText(secondCode!);

  await page
    .getByRole("button", { name: "Number caller", exact: true })
    .click();
  await page.getByRole("button", { name: /Manual marking/ }).click();
  for (const number of row.slice(0, 4))
    await page
      .getByRole("button", {
        name: `Number ${number}, not called`,
        exact: true,
      })
      .click();
  await openClaim(page, code);
  await page
    .getByRole("button", { name: "Verify & award", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "not valid yet",
  );
  const hostCells = await page
    .locator(".claim-result .digital-ticket-grid > *")
    .allTextContents();
  expect(hostCells).toEqual(cells);
  await expect(
    page.getByText("0 of 5 prizes awarded", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("failed-claim-ticket.png"),
  });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: "Number caller", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Number ${row[4]}, not called`, exact: true })
    .click();
  await openClaim(page, code);
  await page
    .getByRole("button", { name: "Verify & award", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText(`Alice · #${code} verified`, { exact: false }),
  ).toBeVisible();
  await openClaim(page, code);
  await page
    .getByRole("button", { name: "Verify & award", exact: true })
    .click();
  await expect(page.locator(".winner-chips>span")).toHaveCount(1);
  await openClaim(page, code, "Bob");
  await expect(
    page.getByText("The tickets are identical", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Verify & award", exact: true })
    .click();
  await expect(page.locator(".winner-chips>span")).toHaveCount(2);
  await expect(page.locator(".winner-chips>span strong")).toHaveText([
    "₹3",
    "₹3",
  ]);
  await page
    .getByRole("button", { name: "Number caller", exact: true })
    .click();
  await page.getByRole("button", { name: "Undo last", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "invalidate a verified claim",
  );
  await expect(
    page.getByLabel(`Latest number ${row[4]}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Prizes", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit winners", exact: true })
    .first()
    .click();
  for (const name of ["Alice", "Bob"])
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: new RegExp(name) })
      .uncheck();
  await page
    .getByRole("button", { name: "Clear winners", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Number caller", exact: true })
    .click();
  await page.getByRole("button", { name: "Undo last", exact: true }).click();
  await expect(
    page.getByLabel(`Latest number ${row[3]}`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show round QR", exact: true })
    .click();
  await expect(page.getByLabel("Round link", { exact: true })).toHaveValue(
    roundLink,
  );
  expect(page.url()).toBe(hostUrl);

  await player
    .getByRole("link", { name: "Scan another round QR", exact: true })
    .click();
  await player.getByLabel("Round link", { exact: true }).fill(roundLink);
  await player
    .getByRole("button", { name: "Open my ticket", exact: true })
    .click();
  await expect(player.locator(".ticket-code strong")).toHaveText(code);
  await expect(
    player.getByRole("button", {
      name: `Unmark number ${all[0]}`,
      exact: true,
    }),
  ).toBeVisible();
  await player
    .getByRole("link", { name: "Backup & restore", exact: true })
    .click();
  const pendingDownload = player.waitForEvent("download");
  await player
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const download = await pendingDownload,
    stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const backup = JSON.parse(Buffer.concat(chunks).toString());
  expect(backup.version).toBe(2);
  expect(backup.playerTickets).toHaveLength(1);
  expect(backup.playerTickets[0].ticketId).toBe(code);
  expect(backup.playerTickets[0].marks).toEqual([all[0]]);
  const bad = structuredClone(backup);
  bad.playerTickets[0].marks = [
    Array.from({ length: 90 }, (_, i) => i + 1).find((n) => !all.includes(n)),
  ];
  await player
    .getByLabel("Choose backup file")
    .setInputFiles({
      name: "bad-marks.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bad)),
    });
  await expect(player.getByRole("alert")).toContainText(
    "invalid or unsupported",
  );
  await expect(player.getByRole("dialog")).not.toBeVisible();
  await player
    .getByLabel("Choose backup file")
    .setInputFiles({
      name: "tickets.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await expect(player.getByRole("dialog")).toContainText("1 saved tickets");
  await player
    .getByRole("button", { name: "Replace & restore", exact: true })
    .click();
  await expect(player.getByRole("dialog")).not.toBeVisible();
  await player.getByRole("link", { name: "My tickets", exact: true }).click();
  await player.locator(".wallet-ticket").click();
  await expect(player.locator(".ticket-code strong")).toHaveText(code);
  await expect(
    player.getByRole("button", {
      name: `Unmark number ${all[0]}`,
      exact: true,
    }),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await playerContext.close();
  await secondContext.close();
});

test("camera denial has offline fallbacks and camera streams stop on navigation", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.assign(window, { cameraRequests: 0 });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        (window as unknown as { cameraRequests: number }).cameraRequests++;
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
  });
  await page.goto("./");
  await readyOffline(context, page);
  await page.getByRole("link", { name: "Scan round QR", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { cameraRequests: number }).cameraRequests,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Camera unavailable or permission denied",
  );
  await page
    .getByLabel("Round link", { exact: true })
    .fill("https://example.com/not-a-round");
  await page
    .getByRole("button", { name: "Open my ticket", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("not a Housie Baaki");
  await expect(page.getByLabel("Choose round QR image")).toBeAttached();
});

test("an active scanner stops its mock camera stream when leaving the screen", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.assign(window, { cameraStreams: [] });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 480;
        canvas.height = 360;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 480, 360);
        const stream = canvas.captureStream(5);
        (
          window as unknown as { cameraStreams: MediaStream[] }
        ).cameraStreams.push(stream);
        return stream;
      },
    });
  });
  await page.goto("./");
  await page.getByRole("link", { name: "Scan round QR", exact: true }).click();
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop camera", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { cameraStreams: MediaStream[] }).cameraStreams
            .length,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { cameraStreams: MediaStream[] }
        ).cameraStreams.every((s) =>
          s.getTracks().every((t) => t.readyState === "ended"),
        ),
      ),
    )
    .toBe(true);
});
