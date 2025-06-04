import * as vscode from 'vscode';
import axios from 'axios'; // For making HTTP requests to your MCP server
import { promptSaiyanOutputChannel } from '../helpers/helpers'; // Assuming this is correctly exported
import { callMcpServer } from '../mcpserver/mcpserver'; // Import the MCP server call function

let currentModel: vscode.LanguageModelChat[] | undefined;


async function getWorkspaceStructure(): Promise<string> {
    promptSaiyanOutputChannel.appendLine('[Workspace Scan] Starting dynamic workspace scan for file types and counts...');
    try {
        const includePattern = '{package.json,requirements.txt,requirement.txt,**/*.sql,**/*.py,**/*.ts,**/*.js,**/*.tsx,**/*.jsx}';
        // Default exclude patterns
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
                    // Basic .gitignore pattern to glob conversion
                    if (line.startsWith('!')) { // Negation not directly supported by findFiles exclude, skip for simplicity
                        return '';
                    }
                    if (line.endsWith('/')) {
                        return `**/${line}**`;
                    }
                    if (line.startsWith('*.')) {
                         return `**/${line}`;
                    }
                    // If no slash, it can be a file or dir anywhere
                    if (!line.includes('/')) {
                         return `**/${line}`;
                    }
                    // If starts with /, treat from root (already handled by findFiles if not prepended with **)
                    // Otherwise, assume it can be anywhere if not specific
                    return line.startsWith('/') ? line.substring(1) : `**/${line}`;
                }).filter(glob => glob !== ''); // Remove empty strings from skipped negations

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
        const path = await import('path'); // Dynamically import path

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
                key = path.extname(fullPath).toLowerCase(); // Ensure consistent extension casing e.g. .SQL -> .sql
            }

            if (key) {
                fileCounts[key] = (fileCounts[key] || 0) + 1;
            }
        }

        // Heuristic project type classification
        let project_type_heuristic = "undetermined";
        const feScore = (fileCounts['.js'] || 0) + (fileCounts['.ts'] || 0) + (fileCounts['.tsx'] || 0) + (fileCounts['.jsx'] || 0);
        const beScorePy = (fileCounts['.py'] || 0); // Assuming .py is main backend for now
        // Add other backend languages here if needed, e.g. .java, .go, .rb
        const beScore = beScorePy; // Sum up all backend language scores
        const dbScore = (fileCounts['.sql'] || 0);

        const totalRelevantScore = feScore + beScore + dbScore;

        if (totalRelevantScore === 0) {
            if (Object.keys(fileCounts).length > 0) { // Other files like package.json might exist
                project_type_heuristic = "no_primary_code_files_detected";
            } else {
                project_type_heuristic = "no_relevant_files_found";
            }
        } else if (totalRelevantScore < 3) { // Threshold for meaningful classification
            project_type_heuristic = "insufficient_data_low_file_count";
        } else {
            const feRatio = feScore / totalRelevantScore;
            const beRatio = beScore / totalRelevantScore;
            const dbRatio = dbScore / totalRelevantScore;

            // Check for dominant types (e.g., > 70% and at least 2 files of that type)
            const minFilesForDominance = 2;
            if (feRatio >= 0.7 && feScore >= minFilesForDominance) {
                project_type_heuristic = "frontend";
            } else if (beRatio >= 0.7 && beScore >= minFilesForDominance) {
                project_type_heuristic = "backend-api";
            } else if (dbRatio >= 0.7 && dbScore >= minFilesForDominance) {
                project_type_heuristic = "database";
            } else {
                // No single dominant type, check for mixed types
                const typesPresent = [];
                if (feScore > 0) {typesPresent.push("frontend");};
                if (beScore > 0) {typesPresent.push("backend-api");};
                if (dbScore > 0) {typesPresent.push("database");};

                if (typesPresent.length > 1) {
                    project_type_heuristic = "mixed (" + typesPresent.join(", ") + ")";
                } else if (typesPresent.length === 1) {
                    // Only one type present, but not dominant enough by the 70% rule (e.g. 50% FE, 0% BE, 0% DB)
                    project_type_heuristic = typesPresent[0]; // Classify as that single present type
                } else {
                    // This case should ideally not be reached if totalRelevantScore > 0
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
            ]; // Simplified check for startsWith

            if (typeof projectTypeToUse === 'string' && ambiguousTypePatterns.some(pattern => projectTypeToUse.startsWith(pattern))) {
                promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Heuristic project type is ambiguous: "${projectTypeToUse}". Clarification required.`);
                /*return JSON.stringify({
                    status: "clarification_needed",
                    heuristic: projectTypeToUse,
                    file_counts: fileCounts,
                    original_prompt: promptText,
                    language_id: languageId
                });*/
            }
            promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Using heuristic project type: "${projectTypeToUse}".`);
        }
    } catch (e: any) {
        promptSaiyanOutputChannel.appendLine(`[Workspace Scan] Error processing workspace scan output: ${e.message}. Raw: ${rawWorkspaceScanOutput}`);
        // Fallback if parsing scan output fails, signal for clarification
        projectTypeToUse = "";
        /*return JSON.stringify({
            status: "clarification_needed",
            heuristic: "error_processing_scan_output",
            file_counts: {},
            original_prompt: promptText,
            language_id: languageId,
            error_details: e.message
        });*/
    }
    
    const workspaceInfoForMcp = {
        file_counts: fileCounts,
        project_type: projectTypeToUse,
        original_heuristic: heuristicType // Always log the original heuristic
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
            You are a professional prompt engineer, an expert agent specializing in the meticulous analysis and transformation of user-submitted prompts into highly effective, specific, and actionable instructions optimized for Large Language Models (LLMs).
            Your primary task is to either:
            1. Perform a concise final review and formatting pass on prompts pre-enhanced by an MCP Server.
            2. Execute a comprehensive enhancement on raw user prompts if no MCP pre-enhancement is detected.
            Your goal is always to maximize the clarity, relevance, and utility of the LLM's generated output based on the prompt you produce.

            **Input Source Handling:**
            - **If the input is wrapped in <mcp_enhanced_input> tags:** This indicates the prompt has been pre-processed by an MCP Server. Your role is to perform a final review and ensure it meets all "Formatting Requirements for Your Output" (see below). Assume the core intent, structure, and substantive content from the MCP Server are sound. Focus on minor refinements for clarity, conciseness, and strict adherence to the Markdown formatting rules. You will report your processing mode as "MCP-Enhanced Review".
            - **If the input is wrapped in <original_prompt> tags (and no <mcp_enhanced_input> is present):** This is a raw user prompt. You must apply the full "Fallback / Standard Enhancement Guidelines" (see below). You will report your processing mode as "Raw Prompt Full Enhancement".

            **Formatting Requirements for Your Output (for the "enhanced_prompt" or "guidance_message" content):**
            - The content of the "enhanced_prompt" or "guidance_message" field in your JSON response *must* be valid Markdown.
            - Employ headings (e.g., ## Objective, ### Key Instructions) to delineate major sections.
            - Utilize bulleted (-, *, or 1., 2.) lists for itemizing requirements, steps, constraints, or examples.
            - Ensure clear paragraph separation for distinct ideas or contextual blocks.
            - Use **bold** or *italics* for emphasis judiciously.
            - Ensure the content is easy to read and visually organized.

            **Concise Review Instructions for MCP Server Pre-Enhanced Input (when <mcp_enhanced_input> is detected):**
            - **Primary Focus:** Review the MCP-provided prompt for overall clarity, conciseness, and to ensure it strictly adheres to all points listed under "Formatting Requirements for Your Output."
            - **Trust MCP Core:** Assume the core intent, essential context, and primary instructions provided by the MCP server are largely correct and complete.
            - **Minor Refinements Only:** Make only necessary minor adjustments. This may include:
                - Improving flow or grammar.
                - Ensuring consistent use of terminology.
                - Adding or adjusting Markdown headings/lists to meet formatting standards if the MCP output was slightly off.
                - Ensuring no redundant information remains after MCP processing.
            - **Self-Containment Check:** Briefly verify the prompt remains self-contained.
            - **Professional Tone Check:** Ensure a professional tone is maintained.
            - **No Major Restructuring:** Do *not* fundamentally restructure or significantly rewrite content from the MCP server unless it glaringly violates a core principle or introduces severe ambiguity.

            **Fallback / Standard Enhancement Guidelines (when only <original_prompt> is detected):**
            - **Deconstruct Intent:** Identify the core objective of the <original_prompt> and rephrase it with utmost precision.
            - **Enrich Context:** If necessary, infer and incorporate minimal, essential background. Make implicit assumptions explicit.
            - **Clarify Instructions:** Convert vague requests into explicit, step-by-step instructions. Define key terms.
            - **Specify Constraints:** Articulate implied or necessary constraints.
            - **Eliminate Redundancy:** Remove superfluous information.
            - **Ensure Self-Containment:** Ensure the prompt is self-contained.
            - **Maintain Professional Tone:** Maintain a professional, formal, and direct tone.
            - **Add Illustrative Examples:** If beneficial, provide 1-2 concise, clearly labeled examples.
            - **Integrate References:** If applicable, suggest placeholder references.

            **For invalid or unclear prompts (applies to both input types if issues persist):**
            - **Polite Rejection/Guidance:** Do *not* attempt to enhance if fundamental flaws remain. Provide a concise, professional, and helpful message structured in the JSON output as described below. Report your processing mode as "Clarification Required".
            - **Guidance Template (for the "guidance_message" field):**
                [START MARKDOWN TEMPLATE for Guidance Message]
                ## Prompt Clarification Required

                The provided prompt (even if MCP processed) requires further clarification to be effectively finalized. Please consider the following:

                *   Specific Objective: Is the primary goal crystal clear?
                *   Necessary Context: Is all essential background information present and unambiguous?
                *   Desired Output: Are the expectations for the LLM's response well-defined?

                Please review and resubmit if necessary, or adjust MCP server logic.
                [END MARKDOWN TEMPLATE for Guidance Message]
            - **Maintain a helpful, constructive tone.**

            **Expected Output Structure:**
            Your entire response MUST be a single JSON object. Do NOT include any text or formatting outside of this JSON object.

            For successful enhancement:
            [START JSON STRUCTURE for Successful Enhancement]
            {
              "processing_mode": "MCP-Enhanced Review" OR "Raw Prompt Full Enhancement",
              "summary": "A brief one-sentence summary of the action taken based on the processing_mode (e.g., 'Reviewed and formatted MCP-enhanced input.' or 'Performed full enhancement on raw prompt.').",
              "enhanced_prompt": "The fully enhanced prompt text, formatted in Markdown as specified under 'Formatting Requirements for Your Output'."
            }
            [END JSON STRUCTURE for Successful Enhancement]

            For invalid or unclear prompts requiring clarification:
            [START JSON STRUCTURE for Clarification]
            {
              "processing_mode": "Clarification Required",
              "summary": "A brief one-sentence summary (e.g., 'Input prompt requires clarification; guidance provided.').",
              "guidance_message": "The clarification guidance message (using the template above), formatted in Markdown."
            }
            [END JSON STRUCTURE for Clarification]

            **IMPORTANT (Output Constraints):**
            - Your entire response MUST be a single, valid JSON object adhering to the "Expected Output Structure" described above.
            - The value of the "enhanced_prompt" or "guidance_message" field within the JSON object MUST be a string containing valid Markdown, following all "Formatting Requirements for Your Output."
            - Do NOT include any text, explanations, or metadata outside of this JSON object.
            - Do NOT use XML tags (like <original_prompt> or <mcp_enhanced_input>) in the values within the JSON output. These tags are for your input processing only.

            **User Input to Process (One of the following will be provided):**

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