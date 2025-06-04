# Prompt Saiyan

Prompt Saiyan is a VS Code extension designed to enhance your development workflow by leveraging AI capabilities. It provides a sidebar interface to interact with a language model, sending prompts and receiving responses, potentially enriched by an MCP (Model Context Protocol) server.

## Features

*   **Sidebar Webview:** Interact with an AI model directly within VS Code through a dedicated sidebar.
*   **Prompt Submission:** Send prompts to the AI and view responses.
*   **History:** Keeps a history of your prompts and responses.
*   **Settings Management:** Configure settings such as the MCP server URL.
*   **Workspace Context:** The extension can analyze your workspace structure to provide more relevant AI responses.
*   **MCP Server Integration:** Optionally connect to an MCP server for enriched AI interactions.
    *   Users can leverage the MCP server to provide "enhance prompt principles" (custom instructions or guidelines) to tailor the AI's prompt construction, leading to more relevant and friendly responses based on their specific needs.
*   **Output Channel:** Provides an output channel named "PromptSaiyan" for logging and debugging.

## Core Components

### 1. Extension Activation ([`src/extension.ts`](src/extension.ts:5))
*   The `activate` function initializes the extension.
*   It registers a `SidebarViewProvider` which manages the webview interface in the VS Code sidebar.
*   The `SidebarViewProvider` handles messages from the webview, such as:
    *   `getSettings`: Retrieves current settings.
    *   `saveSettings`: Saves updated settings.
    *   `getHistory`: Fetches prompt history.
    *   `clearHistory`: Clears the prompt history.
    *   `submitPrompt`: Sends the user's prompt to the AI, potentially via the `promptSaiyan` function.
*   It also registers a `promptSaiyanTool`, which seems to be a language model tool for invoking the AI.

### 2. Prompt Processing ([`src/prompt/promptSaiyan.ts`](src/prompt/promptSaiyan.ts:150))
*   The `promptSaiyan` function is a core part of the extension.
*   It takes a prompt, language ID, and an optional project type.
*   It can gather workspace structure information using `getWorkspaceStructure` to provide context to the AI.
*   This function likely orchestrates the call to the AI model and/or the MCP server.

### 3. MCP Server Interaction ([`src/mcpserver/mcpserver.ts`](src/mcpserver/mcpserver.ts:11))
*   The `callMcpServer` function handles communication with an external MCP server.
*   It takes the initial prompt, workspace information, and language ID to make a request to the configured MCP server URL.

### 4. Helper Utilities ([`src/helpers/helpers.ts`](src/helpers/helpers.ts:1))
*   Provides utility functions like:
    *   `getMcpServerUrl()`: Retrieves the MCP server URL from VS Code configuration.
    *   `promptSaiyanOutputChannel`: A dedicated VS Code output channel for logging.

### 5. Webview Interface ([`src/webview/`](src/webview/))
*   Contains the HTML, CSS, and JavaScript for the sidebar interface.
    *   [`index.html`](src/webview/index.html:1): Structure of the webview.
    *   [`main.js`](src/webview/main.js:1): Client-side logic for the webview, handling UI events and communication with the extension.
    *   [`styles.css`](src/webview/styles.css:1): Styles for the webview.

## How to Use (Inferred)

1.  Install the Prompt Saiyan extension in VS Code.
2.  Open the Prompt Saiyan sidebar.
3.  Optionally, configure the MCP server URL in VS Code settings if you have an MCP server running.
4.  Type your prompts into the sidebar and submit them.
5.  View responses and manage your prompt history.

## Future Enhancements (Placeholder)

*   (Add potential future features here)

---

This README provides an overview based on the current understanding of the codebase. Further details can be added as the project evolves.