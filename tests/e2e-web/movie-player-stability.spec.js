const { test, expect } = require("@playwright/test");
const { seedReviewMovie } = require("./support/movie-fixtures");

async function expectReviewReady(page) {
  await expect(page.getByRole("banner", { name: /Movie Review Header/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByRole("button", { name: "asset-video-1", exact: true })).toBeVisible();
}

test("Movie Review Bay avoids repeated active-video seek spam", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1").first()).toBeVisible();
  await page.keyboard.press("Digit3");
  await expect(page.getByRole("region", { name: /Clip preview/i })).toBeVisible();
  const seekCount = await page.evaluate(async () => {
    let writes = 0;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    if (!descriptor || !descriptor.set || !descriptor.get) return -1;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        writes += 1;
        descriptor.set.call(this, value);
      },
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    await new Promise((resolve) => setTimeout(resolve, 750));
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", descriptor);
    return writes;
  });
  expect(seekCount).toBeLessThan(8);
});
