import * as vscode from 'vscode';
import axios from 'axios';
import { promptSaiyanOutputChannel,getMcpServerUrl } from '../helpers/helpers'; // Adjust the import path as necessary

interface WorkspaceInfo {
    file_counts: { [key: string]: number };
    project_type: string;
    original_heuristic: string; // Keep original heuristic for logging or server-side reference
}

async function callMcpServer(initialPrompt: string, workspaceInfo: WorkspaceInfo, languageId?: string): Promise<string> {
    const mcpUrl = getMcpServerUrl();
    promptSaiyanOutputChannel.appendLine(`[MCP Stage] Calling MCP Server at ${mcpUrl} for initial prompt: "${initialPrompt.substring(0, 100)}..."`);
    promptSaiyanOutputChannel.appendLine(`[MCP Stage] Workspace info being sent: ${JSON.stringify(workspaceInfo)}`);

    try {
        const response = await axios.post(mcpUrl, {
            raw_prompt: initialPrompt,
            workspace_info: workspaceInfo.project_type, // Send the structured workspace info
            language: languageId // Pass language if available
        });

        if (response.data && response.data.status === 'success' && response.data.enriched_prompt) {
            promptSaiyanOutputChannel.appendLine(`[MCP Stage] Received enriched prompt from MCP Server.`);
            return response.data.enriched_prompt;
        } else {
            promptSaiyanOutputChannel.appendLine(`[MCP Stage] MCP Server returned non-success or unexpected format: ${JSON.stringify(response.data)}`);
            vscode.window.showWarningMessage("MCP Server did not return a successful enrichment. Proceeding with original prompt for LLM refinement.");
            return ""; // Fallback to original if MCP fails gracefully
        }
    } catch (error: any) {
        promptSaiyanOutputChannel.appendLine(`[MCP Stage] Error calling MCP Server: ${error.message}`);
        if (axios.isAxiosError(error) && error.response) {
            promptSaiyanOutputChannel.appendLine(`[MCP Stage] MCP Server Response: ${JSON.stringify(error.response.data)}`);
        }
        vscode.window.showWarningMessage("Failed to connect to MCP Server for initial enrichment. Proceeding with original prompt for LLM refinement.");
        return ""; // Fallback to original prompt
    }
}

export { callMcpServer };