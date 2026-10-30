import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

// Serve two worker revisions on an isolated origin to exercise a real PWA update.
test("Update app checks online, retains games, and defers a waiting update during play", async ({
  page,
  context,
}, testInfo) => {
  let revision = 1;
  const base = process.env.VITE_BASE_PATH || "/housie-baaki/";
  const root = resolve("dist");
  const mime: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      if (!url.pathname.startsWith(base)) {
        res.writeHead(404).end();
        return;
      }
      const path = resolve(
        root,
        decodeURIComponent(url.pathname.slice(base.length) || "index.html"),
      );
      if (!path.startsWith(root + sep)) {
        res.writeHead(404).end();
        return;
      }
      let bytes = await readFile(path);
      if (path === resolve(root, "sw.js"))
        bytes = Buffer.concat([
          bytes,
          Buffer.from(`\n// Test release ${revision}\n`),
        ]);
      res
        .writeHead(200, {
          "Content-Type": mime[extname(path)] || "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  const app = `http://127.0.0.1:${port}${base}`;
  try {
    await page.goto(app);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await page
      .getByRole("button", { name: "Start a gathering", exact: true })
      .click();
    await page.getByLabel("Gathering name").fill("Keep my games");
    await page
      .getByRole("button", { name: "Start gathering", exact: true })
      .click();
    await page.getByLabel("Player name", { exact: true }).fill("Alice");
    await page.getByRole("button", { name: "Add player", exact: true }).click();
    await expect(page.getByLabel("Player name", { exact: true })).toHaveValue(
      "",
    );
    const gatheringUrl = page.url();
    await page.goto(app + "#/backup");
    const updates = page.getByRole("region", { name: "App updates" });
    await updates
      .getByRole("button", { name: "Update app", exact: true })
      .click();
    await expect(updates.getByRole("status")).toHaveText(
      "You’re using the latest app.",
    );
    await context.setOffline(true);
    await updates
      .getByRole("button", { name: "Update app", exact: true })
      .click();
    await expect(updates.getByRole("status")).toContainText("You’re offline");
    await context.setOffline(false);
    revision++;
    await Promise.all([
      page.waitForEvent("load"),
      updates.getByRole("button", { name: "Update app", exact: true }).click(),
    ]);
    await page.goto(gatheringUrl);
    await expect(
      page.getByRole("heading", { name: "Keep my games", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".player-row")).toContainText("Alice");
    await page
      .getByRole("button", { name: "New round", exact: true })
      .first()
      .click();
    await page.getByLabel("Tickets for Alice", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Let’s play", exact: true }).click();
    const roundUrl = page.url();
    revision++;
    await page
      .getByRole("button", { name: "How it works", exact: true })
      .click();
    const helpUpdates = page
      .getByRole("dialog")
      .getByRole("region", { name: "App updates" });
    await helpUpdates
      .getByRole("button", { name: "Update app", exact: true })
      .click();
    await expect(helpUpdates.getByRole("status")).toContainText(
      "Finish or cancel the current round",
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting,
        ),
      )
      .toBe(true);
    expect(page.url()).toBe(roundUrl);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Show round QR", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cancel round", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel round", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await context.setOffline(true);
    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("button", { name: "Update app", exact: true }).click(),
    ]);
    await expect(
      page.getByText("This round was cancelled.", { exact: false }),
    ).toBeVisible();
    await page.goto(app + "#/backup");
    await page.screenshot({
      path: testInfo.outputPath("app-updates.png"),
      fullPage: true,
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
