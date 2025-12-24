# Grok Power Tools (Chrome Extension)

![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)

Supercharge your Grok experience with a premium floating dashboard for automated video generation, prompt management, and bulk downloading.

## Features

-   **Floating Power Panel**: A sleek, draggable glassmorphism dashboard overlay on Grok.
-   **Auto-Retry System**: Automatically handles "Content Moderated" errors and retries generation until successful.
-   **Video Goals**: Set a target (e.g., "Make 10 videos") and let the extension automate the process sequentially.
-   **Prompt Manager**: Save your favorite prompts, import/export them as JSON, and inject them with a single click.
-   **Smart Scraper**: Bulk download media from your feed or favorites with smart scrolling and duplicate detection.
-   **Raw Image Mode**: Specialized handler for `imagine-public.x.ai` to download raw assets.

## Installation

1.  Clone or download this repository.
2.  Open Chrome and go to `chrome://extensions/`.
3.  Enable **Developer mode** in the top-right corner.
4.  Click **Load unpacked**.
5.  Select the `chrome-extension-powertools` directory.
6.  Navigate to [grok.com/imagine](https://grok.com/imagine) to see the overlay!

## Usage

### The Overlay
The floating panel appears in the bottom-right corner. You can drag it by the header or minimize it by clicking the `_` icon.

### Auto-Retry & Goals
1.  Open the **Auto-Retry & Goals** section.
2.  Toggle **Auto-Retry Moderated** to automatically retry when Grok blocks a prompt.
3.  Set **Max Retries** and **Cooldown** (seconds to wait between actions).
4.  **Video Goal**: Enter a number and click "Start Video Goal" to automate continuous generation.

### Prompt Management
1.  Type a prompt in Grok's input box.
2.  Click the **+ (Plus)** icon in the overlay to save it.
3.  Click any saved tag to insert it back into the input.
4.  Use the **Import/Export** icons to backup your prompts.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for instructions on setting up the development environment, running tests, and contributing code.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
