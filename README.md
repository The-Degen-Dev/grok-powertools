# Grok PowerTools Extension

A powerful Chrome Extension for automating media downloads and management on Grok (grok.com). This tool enhances the `grok.com/imagine` experience by enabling bulk downloads, deterministic file naming, and automated retry mechanisms for video generation.

## Features

*   **Bulk Media Scraping**: Automates the traversal of your Grok gallery (Favorites/Generated) to download images and videos.
*   **Smart Traversal**: Uses a visual sorting algorithm (Masonry-aware) to download items in a logical order (Top-Left -> Bottom-Right), preventing skips.
*   **Deterministic Naming**: Generates filenames based on the unique UUID of the media item (extracted from URL), ensuring that re-downloading the same library doesn't create duplicates (e.g., `UUID.png` instead of `image (1).png`).
*   **Robust Deduplication**: Tracks processed item IDs in `chrome.storage.local` to skip already downloaded items, even across browser restarts.
*   **Video Auto-Retry**: Automatically detects "Content Moderated" errors during video generation and clicks retry (up to a configurable limit).
*   **Persistent Logging**: Keeps a detailed activity log in the extension popup that survives page reloads.

## File Breakdown

### `manifest.json`
The configuration file for the Chrome Extension. It defines:
*   **Permissions**: `storage`, `activeTab`, `scripting`, `downloads`.
*   **Host Permissions**: Access to `grok.com`, `x.com`, and `imagine-public.x.ai` (for raw image downloads).
*   **Content Scripts**: Specifies that `content.js` should run on Grok domains.
*   **Background Worker**: Registers `background.js` as the service worker.

### `content.js`
The core logic script injected into the web page. It operates in two modes:
1.  **Main Scraper Mode (`grok.com`)**:
    *   **State Machine**: Manages states (`IDLE`, `LIST`, `DETAIL`) to navigate the gallery.
    *   **Visual Sorter**: Scrapes all visible images, sorts them by screen position, and finds the next unprocessed item.
    *   **VideoRetryManager**: A dedicated observer class that watches for "Content Moderated" errors and auto-clicks the "Make video" button.
2.  **Raw Image Mode (`imagine-public.x.ai`)**:
    *   Detects when a raw image tab is opened, triggers a download via message passing, and closes the tab.

### `background.js`
The service worker that handles background tasks:
*   **Determining Filenames**: Intercepts downloads to apply the `GrokVault/YYYY-MM-DD_Auto/UUID.ext` naming convention.
*   **Message Passing**: Acts as a bridge between `content.js` and `popup.js` for logging.
*   **Tab Management**: Handles `CLOSE_TAB` requests from the content script.

### `popup.html` & `popup.js`
The user interface for the extension:
*   **Controls**: Start/Stop buttons for the scraper.
*   **Video Tools**: Settings for "Auto-Retry Moderation" (Enable/Disable, Max Retries).
*   **Activity Log**: A scrollable list of actions taken by the scraper (saved to storage).

## Installation

1.  Clone this repository.
2.  Open Chrome and go to `chrome://extensions`.
3.  Enable **Developer mode** (top right).
4.  Click **Load unpacked**.
5.  Select the directory containing this repo.
6.  Go to `grok.com/imagine` and open the extension to start using it!
