import * as vscode from 'vscode';
import { baseprompt, promptSaiyanOutputChannel } from './helpers'; 
import { callMcpServer } from './mcpserver'; 

let currentModel: vscode.LanguageModelChat[] | undefined;


async function getWorkspaceStructure(): Promise<string> {
    promptSaiyanOutputChannel.appendLine('[Workspace Scan] Starting dynamic workspace scan for file types and counts...');
    try {
        const includePattern = '{package.json,requirements.txt,requirement.txt,**/*.sql,**/*.py,**/*.ts,**/*.js,**/*.tsx,**/*.jsx}';
        
        let excludePatterns: string[] = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.vscode-test/**'];

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const gitignoreUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.gitignore');
            try {
                const gitignoreContentBytes = await vscode.workspace.fs.readFile(gitignoreUri);
                const gitignoreContent = new TextDecoder().decode(gitignoreContentBytes); // Standard TextDecoder
                const gitignoreLines = gitignoreContent.split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'));
                
                const gitignoreGlobs = gitignoreLines.map(line => {
                    
                    if (line.startsWith('!')) { 
                        return '';
                    }
                    if (line.endsWith('/')) {
                        return `**/${line}**`;
                    }
                    if (line.startsWith('*.')) {
                         return `**/${line}`;
                    }
                    
                    if (!line.includes('/')) {
                         return `**/${line}`;
                    }
                    
                    return line.startsWith('/') ? line.substring(1) : `**/${line}`;
                }).filter(glob => glob !== ''); 

                excludePatterns.push(...gitignoreGlobs);
                promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Loaded ${gitignoreGlobs.length} patterns from .gitignore. Effective excludes: ${excludePatterns.length}`);
            } catch (e:any) {
                promptSaiyanOutputChannel.appendLine(`[Workspace Scan] .gitignore not found or could not be read at ${gitignoreUri.fsPath}. Error: ${e.message}`);
            }
        } else {
            promptSaiyanOutputChannel.appendLine('[Workspace Scan] No workspace folder found, cannot look for .gitignore.');
        }

        const finalExcludePattern = `{${excludePatterns.join(',')}}`;
        promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Using include pattern: ${includePattern}`);
        promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Using exclude pattern: ${finalExcludePattern}`);

        const files = await vscode.workspace.findFiles(includePattern, finalExcludePattern);

        if (files.length === 0) {
            promptSaiyanOutputChannel.appendLine('[Workspace Scan] No relevant files found based on scan criteria.');
            return JSON.stringify({ message: "No relevant files found based on scan criteria." });
        }

        const fileCounts: { [key: string]: number } = {};
        const path = await import('path');

        for (const file of files) {
            const fullPath = file.fsPath;
            const baseName = path.basename(fullPath);
            let key: string;

            if (baseName === 'package.json') {
                key = 'package.json';
            } else if (baseName === 'requirements.txt') {
                key = 'requirements.txt';
            } else if (baseName === 'requirement.txt') {
                key = 'requirement.txt';
            } else {
                key = path.extname(fullPath).toLowerCase(); 
            }

            if (key) {
                fileCounts[key] = (fileCounts[key] || 0) + 1;
            }
        }

        // Heuristic project type classification
        let project_type_heuristic = "undetermined";
        const feScore = (fileCounts['.js'] || 0) + (fileCounts['.ts'] || 0) + (fileCounts['.tsx'] || 0) + (fileCounts['.jsx'] || 0);
        const beScorePy = (fileCounts['.py'] || 0); 
        
        const beScore = beScorePy; 
        const dbScore = (fileCounts['.sql'] || 0);

        const totalRelevantScore = feScore + beScore + dbScore;

        if (totalRelevantScore === 0) {
            if (Object.keys(fileCounts).length > 0) { 
                project_type_heuristic = "no_primary_code_files_detected";
            } else {
                project_type_heuristic = "no_relevant_files_found";
            }
        } else if (totalRelevantScore < 3) { 
            project_type_heuristic = "insufficient_data_low_file_count";
        } else {
            const feRatio = feScore / totalRelevantScore;
            const beRatio = beScore / totalRelevantScore;
            const dbRatio = dbScore / totalRelevantScore;

            
            const minFilesForDominance = 2;
            if (feRatio >= 0.7 && feScore >= minFilesForDominance) {
                project_type_heuristic = "frontend";
            } else if (beRatio >= 0.7 && beScore >= minFilesForDominance) {
                project_type_heuristic = "backend-api";
            } else if (dbRatio >= 0.7 && dbScore >= minFilesForDominance) {
                project_type_heuristic = "database";
            } else {
                
                const typesPresent = [];
                if (feScore > 0) {typesPresent.push("frontend");};
                if (beScore > 0) {typesPresent.push("backend-api");};
                if (dbScore > 0) {typesPresent.push("database");};

                if (typesPresent.length > 1) {
                    project_type_heuristic = "mixed (" + typesPresent.join(", ") + ")";
                } else if (typesPresent.length === 1) {
                    
                    project_type_heuristic = typesPresent[0]; 
                } else {
                    
                    project_type_heuristic = "undetermined_ambiguous_distribution";
                }
            }
        }
        
        const resultPayload = { file_counts: fileCounts, project_type_heuristic: project_type_heuristic };
        const resultJson = JSON.stringify(resultPayload);
        promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Scan complete. Result: ${resultJson}`);
        return resultJson;

    } catch (error: any) {
        promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Error during workspace scan: ${error.message}`);
        return JSON.stringify({ error: "Error scanning workspace.", details: error.message });
    }
}

async function promptSaiyan(promptText: string, languageId?: string, clarifiedProjectType?: string): Promise<string> {
    promptSaiyanOutputChannel.appendLine(`--- Starting PromptBoost for: "${promptText.substring(0, 100)}..." ---`);
    let inputForRefinementLlm: string;
    let mcpWasSuccessful = false;
    let projectTypeToUse: string;
    let fileCounts: { [key: string]: number } = {};
    let heuristicType: string = "unknown";

    // Perform workspace scan
    const rawWorkspaceScanOutput = await getWorkspaceStructure();

    try {
        const parsedScan = JSON.parse(rawWorkspaceScanOutput);
        fileCounts = parsedScan.file_counts || {};
        heuristicType = parsedScan.project_type_heuristic || "error_parsing_scan_heuristic";

        if (clarifiedProjectType) {
            projectTypeToUse = clarifiedProjectType;
            promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Using user-clarified project type: "${projectTypeToUse}". Original heuristic: "${heuristicType}".`);
        } else {
            projectTypeToUse = heuristicType;
            const ambiguousTypePatterns = [
                "mixed", "undetermined", "insufficient_data", "no_primary_code", "error_parsing_scan"
            ]; 

            if (typeof projectTypeToUse === 'string' && ambiguousTypePatterns.some(pattern => projectTypeToUse.startsWith(pattern))) {
                promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Heuristic project type is ambiguous: "${projectTypeToUse}". Clarification required.`);
                
            }
            promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Using heuristic project type: "${projectTypeToUse}".`);
        }
    } catch (e: any) {
        promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Error processing workspace scan output: ${e.message}. Raw: ${rawWorkspaceScanOutput}`);
       
        projectTypeToUse = "";
       
    }
    
    const workspaceInfoForMcp = {
        file_counts: fileCounts,
        project_type: projectTypeToUse,
        original_heuristic: heuristicType 
    };
    
    // Stage 1: MCP Server Enrichment
    const mcpEnhancedOutput = await callMcpServer(promptText, workspaceInfoForMcp, languageId);

    if (mcpEnhancedOutput && mcpEnhancedOutput.trim().length > 0) {
        promptSaiyanOutputChannel.appendLine(`[MCP Stage] MCP Server returned successfully. Output: "${mcpEnhancedOutput.substring(0, 100)}..."`);
        // Wrap MCP output with the special tag
        inputForRefinementLlm = `<mcp_enhanced_input>\n${mcpEnhancedOutput}\n</mcp_enhanced_input>`;
        mcpWasSuccessful = true;
    } else {
        promptSaiyanOutputChannel.appendLine("[MCP Stage] MCP Server enhancement failed or returned empty. Falling back to original prompt for LLM refinement stage.");
        // Wrap original promptText with the fallback tag
        inputForRefinementLlm = `<original_prompt>\n${promptText}\n</original_prompt>`;
        mcpWasSuccessful = false; // Explicitly set
    }
    
    const promptForLlm = mcpEnhancedOutput || promptText; // Ensure we have a prompt for the LLM

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
            ${baseprompt}
            
            Format 1: Raw User Prompt
            <original_prompt>
            ${promptForLlm}
            </original_prompt>

            Format 2: MCP Server Pre-Enhanced Prompt
            <mcp_enhanced_input>
            ${promptForLlm}
            </mcp_enhanced_input>
          `),
          vscode.LanguageModelChatMessage.User(inputForRefinementLlm)
    ];

    promptSaiyanOutputChannel.appendLine(`[LLM Stage] Sending to LLM: "${promptForLlm.substring(0, 200)}..."`);

    try {
        chatResponse = await model.sendRequest(
            messages,
            {},
            new vscode.CancellationTokenSource().token 
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

    let rawResponseText = '';
    try {
        for await (const fragment of chatResponse.text) {
            rawResponseText += fragment;
        }
        promptSaiyanOutputChannel.appendLine(`[Refinement LLM] Raw full response received: ${rawResponseText.substring(0,300)}`);

        // --- DEFENSIVE CLEANING AND PARSING ---
        let cleanedJsonString = rawResponseText.trim();

        // Attempt to remove common prefixes like "```json" or "json" and suffixes "```"
        // More sophisticated regex might be needed if LLM varies its additions
        const jsonPrefixRegex = /^\s*(?:```(?:json)?\s*)?/i;
        const jsonSuffixRegex = /\s*(?:```\s*)?$/i;

        cleanedJsonString = cleanedJsonString.replace(jsonPrefixRegex, '');
        cleanedJsonString = cleanedJsonString.replace(jsonSuffixRegex, '');

        // Ensure it at least looks like it starts and ends with braces
        // This is a basic check; more robust validation could be added
        if (!cleanedJsonString.startsWith('{') || !cleanedJsonString.endsWith('}')) {
            promptSaiyanOutputChannel.appendLine(`[Refinement LLM] Cleaned response does not appear to be a valid JSON object structure. Original: ${rawResponseText}`);
            // Consider attempting to find the first '{' and last '}' if simple trimming fails
            const firstBrace = cleanedJsonString.indexOf('{');
            const lastBrace = cleanedJsonString.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                cleanedJsonString = cleanedJsonString.substring(firstBrace, lastBrace + 1);
                promptSaiyanOutputChannel.appendLine(`[Refinement LLM] Attempted extraction: ${cleanedJsonString}`);
            } else {
                vscode.window.showErrorMessage("LLM response is not in the expected JSON format (missing braces).");
                return promptForLlm; // Fallback
            }
        }
        
        //promptSaiyanOutputChannel.appendLine(`[Refinement LLM] Attempting to parse cleaned string: ${cleanedJsonString.substring(0,300)}...`);
        const responseObject = JSON.parse(cleanedJsonString);
        
        
        if (responseObject?.enhanced_prompt) {
            promptSaiyanOutputChannel.appendLine(`[Refinement LLM] Successfully parsed JSON response with 'enhanced_prompt'.`);
            promptSaiyanOutputChannel.appendLine(`Prompt Saiyan Finished'.`);
            return responseObject.enhanced_prompt;
        } else if (responseObject?.guidance_message) {
            vscode.window.showWarningMessage(`Guidance: ${responseObject.guidance_message}`);
            return promptForLlm; // Or original promptText
        } else {
            promptSaiyanOutputChannel.appendLine("[Refinement LLM] JSON response did not contain expected 'enhanced_prompt' or 'guidance_message' field.");
            vscode.window.showErrorMessage("Received an unexpected response structure from the refinement LLM.");
            return promptForLlm; // Fallback
        }

    } catch (error: any) {
        promptSaiyanOutputChannel.appendLine(`[Refinement LLM] Error processing LLM response. Error: ${error.message}`);
        promptSaiyanOutputChannel.appendLine(`[Refinement LLM] Raw response that caused error: ${rawResponseText}`); // Log the full raw response
        vscode.window.showErrorMessage("Failed to parse the JSON response from the refinement LLM.");
        return promptForLlm; // Fallback
}
}

export { promptSaiyan };