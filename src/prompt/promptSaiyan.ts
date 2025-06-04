import * as vscode from 'vscode';
import axios from 'axios'; // For making HTTP requests to your MCP server
import { promptSaiyanOutputChannel } from '../helpers/helpers'; // Assuming this is correctly exported
import { callMcpServer } from '../mcpserver/mcpserver'; // Import the MCP server call function

let currentModel: vscode.LanguageModelChat[] | undefined;


async function promptSaiyan(promptText: string, languageId?: string): Promise<string> {
    promptSaiyanOutputChannel.appendLine(`--- Starting PromptBoost for: "${promptText.substring(0, 100)}..." ---`);

    // Stage 1: MCP Server Enrichment
    const mcpEnhancedPrompt = await callMcpServer(promptText, languageId);

    // If MCP server returned an empty string or something went very wrong,
    // and we fell back to the original, ensure we have something to work with.
    // Or if MCP itself is the final step if LLM fails.
    if (!mcpEnhancedPrompt && promptText) {
        promptSaiyanOutputChannel.appendLine("[LLM Stage] MCP enhancement resulted in empty prompt, falling back to original for LLM.");
        // This case should ideally be handled by callMcpServer returning promptText
    }
    
    const promptForLlm = mcpEnhancedPrompt || promptText; // Ensure we have a prompt for the LLM

    promptSaiyanOutputChannel.appendLine(`[LLM Stage] Prompt after MCP (to be sent to LLM): "${promptForLlm.substring(0, 100)}..."`);

    // Stage 2: LLM Refinement (using the output from MCP server)

    // Model selection logic (seems fine, you can adjust priorities)
    if (!currentModel || currentModel.length === 0) {
        // Try models in preferred order
        const modelSelectors = [
            { vendor: 'copilot', family: 'gpt-4' }, // Or gpt-4-turbo, etc.
            { vendor: 'copilot', family: 'gpt-4o-mini' } // Default fallback
        ];

        for (const selector of modelSelectors) {
            currentModel = await vscode.lm.selectChatModels(selector);
            if (currentModel && currentModel.length > 0) {
                promptSaiyanOutputChannel.appendLine(`[LLM Stage] Selected model: ${currentModel[0].name} (Vendor: ${selector.vendor}, Family: ${selector.family})`);
                break;
            }
        }
    }

    if (!currentModel || currentModel.length === 0) {
        promptSaiyanOutputChannel.appendLine("[LLM Stage] No LLM model available after trying all options.");
        vscode.window.showWarningMessage("Sorry, no suitable LLM model available to refine the prompt. Returning MCP-enhanced prompt (if available) or original.");
        return promptForLlm; // Return whatever we have before LLM stage
    }

    const model = currentModel[0];
    promptSaiyanOutputChannel.appendLine(`[LLM Stage] Using LLM: ${model.name} for refinement.`);

    let chatResponse: vscode.LanguageModelChatResponse | undefined;

    // Your existing system prompt for the LLM is good.
    // It will now operate on the `promptForLlm` which came from the MCP server.
    const messages = [
        vscode.LanguageModelChatMessage.User(`
            You are a professional prompt engineer specializing in crafting precise, effective prompts.
            Your task is to enhance prompts by making them more specific, actionable, and effective.

            **Formatting Requirements:**
            - Use Markdown formatting in your response.
            - Present requirements, constraints, and steps as bulleted or numbered lists.
            - Separate context, instructions, and examples into clear paragraphs.
            - Use headings if appropriate.
            - Ensure the prompt is easy to read and visually organized.

            **Instructions:**
            - Improve the user prompt wrapped in \`<original_prompt>\` tags.
            - Make instructions explicit and unambiguous.
            - Add relevant context and constraints.
            - Remove redundant information.
            - Maintain the core intent.
            - Ensure the prompt is self-contained.
            - Use professional language.
            - Add references to documentation or examples if applicable.

            **For invalid or unclear prompts:**
            - Respond with clear, professional guidance.
            - Keep responses concise and actionable.
            - Maintain a helpful, constructive tone.
            - Focus on what the user should provide.
            - Use a standard template for consistency.

            **IMPORTANT:**  
            Your response must ONLY contain the enhanced prompt text, formatted as described.  
            Do not include any explanations, metadata, or wrapper tags.

            <original_prompt>
            ${promptForLlm} 
            </original_prompt>
          `),
    ];

    promptSaiyanOutputChannel.appendLine(`[LLM Stage] Sending to LLM: "${promptForLlm.substring(0, 200)}..."`);

    try {
        chatResponse = await model.sendRequest(
            messages,
            {}, // You can add model-specific options here if needed
            new vscode.CancellationTokenSource().token // Consider passing the token from the command/tool
        );
    } catch (err: any) {
        promptSaiyanOutputChannel.appendLine(`[LLM Stage] Error during LLM request: ${String(err)}`);
        vscode.window.showWarningMessage("Sorry, unable to refine the prompt with LLM at this time. Returning MCP-enhanced prompt (if available) or original.");
        return promptForLlm; // Fallback
    }

    if (!chatResponse) {
        promptSaiyanOutputChannel.appendLine(`[LLM Stage] No response from LLM.`);
        vscode.window.showWarningMessage("Sorry, no response from LLM to refine the prompt. Returning MCP-enhanced prompt (if available) or original.");
        return promptForLlm; // Fallback
    }

    try {
        let finalEnhancedPrompt = '';
        for await (const fragment of chatResponse.text) {
            finalEnhancedPrompt += fragment;
        }
        promptSaiyanOutputChannel.appendLine(`[LLM Stage] Final LLM refined prompt: "${finalEnhancedPrompt.substring(0, 200)}..."`);
        promptSaiyanOutputChannel.appendLine(`--- PromptBoost Finished ---`);
        return finalEnhancedPrompt;
    } catch (err) {
        promptSaiyanOutputChannel.appendLine(`[LLM Stage] Error processing LLM stream: ${String(err)}`);
        vscode.window.showWarningMessage("Sorry, error processing LLM response. Returning MCP-enhanced prompt (if available) or original.");
        return promptForLlm; // Fallback
    }
}

export { promptSaiyan };