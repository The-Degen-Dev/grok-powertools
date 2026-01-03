# Grok Power Tools v0.2.0 Release

We are excited to introduce **Grok Power Tools v0.2.0**, a major upgrade to your Grok experience! 🚀

## What's New in v0.2.0

### 📝 Enhanced Prompt History
Never lose a prompt again.
-   **Smart Context Scraping**: Captures image and video prompts intelligently, even when the input box is empty (e.g., clicking "Make video" on a card).
-   **Visual Cues**: History items now show icons (🖼️ vs 🎥) so you know exactly what type of generation it was.
-   **Robust Capturing**: Improved "Capture Phase" logic ensures prompts are saved before the app clears them.

### 🎥 Accuracy Improvements
-   **Video Goals Fixed**: The "Videos Generated" counter now rigorously verifies that generation *actually started* before counting, eliminating false positives from rate limits or failures.
-   **Partial Prompts Fixed**: "Add Prompt Partial" now correctly injects text into the chat box in a way that React recognizes.

### 🔁 Robust Auto-Retry
Automatically detects "Content Moderated" blocks and retries generation for you.
-   **Configurable**: Set Max Retries and Cooldown timer.
-   **Status**: See exactly how many retries have been used.

### 🛠️ Developer Mode
For the power users:
-   Open **Settings** (Gear Icon).
-   Enable **Developer Mode** to see a real-time system log panel.

## Installation Steps

### 1. Update/Load Extension
1.  Navigate to `chrome://extensions/`.
2.  Enable **"Developer mode"**.
3.  Click **"Load unpacked"** (or "Update" if already loaded).
4.  Select the extension folder.
5.  **Refresh your Grok tab!**

---
*Open Source Power Tools for Grok.*
