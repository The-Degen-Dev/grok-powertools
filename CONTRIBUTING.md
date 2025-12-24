# Contributing to Grok Power Tools

Thank you for your interest in contributing! We welcome bug reports, feature requests, and pull requests.

## Development Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-username/grok-power-tools.git
    cd grok-power-tools
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```
    This will install development tools including Jest (unit tests), Playwright (E2E tests), ESLint, and Prettier.

3.  **Load the extension**:
    -   Open Chrome and navigate to `chrome://extensions/`.
    -   Enable "Developer mode" (toggle in top right).
    -   Click "Load unpacked" and select the repository folder.

## Testing

We use a combination of Unit Tests (Jest) and End-to-End Tests (Playwright).

-   **Run all tests**:
    ```bash
    npm test
    ```

-   **Run Unit Tests only**:
    ```bash
    npm run test:unit
    ```

-   **Run E2E Tests only**:
    ```bash
    npm run test:e2e
    ```

## Code Style

We enforce code style using ESLint and Prettier.

-   **Lint code**:
    ```bash
    npm run lint
    ```
-   **Format code**:
    ```bash
    npm run format
    ```

## Pull Request Process

1.  Fork the repo and create your branch (`git checkout -b feature/amazing-feature`).
2.  Commit your changes (`git commit -m 'Add some amazing feature'`).
3.  Ensure all tests pass (`npm test`).
4.  Push to the branch (`git push origin feature/amazing-feature`).
5.  Open a Pull Request.

## License

Distributed under the MIT License. See `LICENSE` for more information.
