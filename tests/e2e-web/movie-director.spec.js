const { test, expect } = require("@playwright/test");
const { seedReviewMovie } = require("./support/movie-fixtures");

async function expectReviewReady(page) {
  await expect(page.getByRole("banner", { name: /Movie Review Header/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByRole("button", { name: "Select Clip 1" }).first()).toBeVisible();
}

test("Director creates reviewable proposals without mutating the current cut", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  const before = await page.getByRole("region", { name: /Clip Strip/i }).textContent();
  await page.getByRole("tab", { name: /Director/i }).click();
  await page.getByRole("button", { name: /Run rule-based Director/i }).click();
  await expect(page.getByRole("article", { name: /Director proposal/i })).toBeVisible();
  const after = await page.getByRole("region", { name: /Clip Strip/i }).textContent();
  expect(after).toBe(before);
});

test("Director partial accept applies selected changes only", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.getByRole("tab", { name: /Director/i }).click();
  await page.getByRole("button", { name: /Run rule-based Director/i }).click();
  await page.getByLabel(/Select Director change 1/i).check();
  await page.getByRole("button", { name: /Apply selected changes/i }).click();
  await expect(page.getByLabel(/^Partial$/i)).toBeVisible();
  await expect(page.locator('[title="Partially applied"]')).toBeVisible();
});
