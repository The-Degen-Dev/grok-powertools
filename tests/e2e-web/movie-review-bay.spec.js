const { test, expect } = require("@playwright/test");
const { seedReviewMovie } = require("./support/movie-fixtures");

test("Review Bay first viewport exposes operator regions", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("banner", { name: /Movie Review Header/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Drafts and Director/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Inspector/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Clip Strip/i })).toBeVisible();
});

test("Keyboard keep and reject move candidates into the right lanes", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByRole("button", { name: "asset-video-1", exact: true })).toBeVisible();
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1").first()).toBeVisible();
  await page.keyboard.press("KeyX");
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByText("asset-video-2")).toHaveCount(0);
});
