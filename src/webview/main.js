// media/main.js
(function() {
    const vscode = acquireVsCodeApi();

    const serverUrlInput = document.getElementById('serverUrl');
    const saveSettingsButton = document.getElementById('saveSettings');
    const historyContainer = document.getElementById('historyContainer');
    const clearHistoryButton = document.getElementById('clearHistory');
    const historySearchInput = document.getElementById('historySearchInput');

    let fullHistory = []; // To store the complete history for filtering

    const promptInput = document.getElementById('promptInput');
    const submitPromptButton = document.getElementById('submitPrompt');
    const promptOutput = document.getElementById('promptOutput');
    const copyPromptOutputButton = document.getElementById('copyPromptOutput');
    const serverStatusSpan = document.getElementById('serverStatus');


    // Function to check MCP server health
    async function checkServerStatus(baseUrl) {
        if (!baseUrl) {
            serverStatusSpan.textContent = 'URL not set';
            serverStatusSpan.style.color = 'orange';
            return;
        }
        // Ensure the URL doesn't end with a slash before appending /health
        // Extract only the protocol, host, and port (ignore any path/query/hash)
        let healthUrl = "";
        try {
            const urlObj = new URL(baseUrl);
            const baseOrigin = urlObj.origin; // e.g., "http://localhost:8000"
            healthUrl = baseOrigin + '/health';
        } catch (e) {
            serverStatusSpan.textContent = 'Invalid URL';
            serverStatusSpan.style.color = 'orange';
            return;
        }
        serverStatusSpan.textContent = 'Checking...';
        serverStatusSpan.style.color = 'inherit'; // Reset color

        try {
            const response = await fetch(healthUrl);
            if (response.ok) {
                const data = await response.json(); // Assuming server returns JSON e.g. {"status": "ok"}
                serverStatusSpan.textContent = `Online (Status: ${data.status || 'OK'})`;
                serverStatusSpan.style.color = 'green';
            } else {
                serverStatusSpan.textContent = `Offline (HTTP ${response.status})`;
                serverStatusSpan.style.color = 'red';
            }
        } catch (error) {
            console.error('Health check failed:', error);
            serverStatusSpan.textContent = 'Error connecting';
            serverStatusSpan.style.color = 'red';
        }
    }

    // Request initial settings and history when the webview loads
    vscode.postMessage({ type: 'getSettings' }); // This will trigger checkServerStatus via the 'settings' message handler
    vscode.postMessage({ type: 'getHistory' });

    // Tab switching logic
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Deactivate all tabs and content
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // Activate clicked tab and its content
            button.classList.add('active');
            const tabId = button.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // Set initial active tab (optional, if not already set by HTML class)
    // document.querySelector('.tab-button[data-tab="enhanceTab"]').click();


    saveSettingsButton.addEventListener('click', () => {
        const serverUrl = serverUrlInput.value;
        vscode.postMessage({ type: 'saveSettings', serverUrl: serverUrl });
        checkServerStatus(serverUrl); // Check status immediately after trying to save
    });

    clearHistoryButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearHistory' });
    });
    
    function submitPrompt() {
        const promptText = promptInput.value.trim(); // Trim whitespace
        if (promptText) {
            document.getElementById('promptOutputContainer').classList.remove('hidden'); // Show output container
            promptOutput.textContent = 'Enhancing...';
            vscode.postMessage({ type: 'submitPrompt', text: promptText });
            promptInput.value = '';
            adjustTextareaHeight(); // Reset height after clearing
        }
    }

    submitPromptButton.addEventListener('click', submitPrompt);

    promptInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); // Prevent new line on Enter
            submitPrompt();
        }
    });

    promptInput.addEventListener('input', adjustTextareaHeight);

    function adjustTextareaHeight() {
        promptInput.style.height = 'auto'; // Reset height to shrink if text is deleted
        let newHeight = promptInput.scrollHeight;
        // Consider padding and border if box-sizing is content-box
        // For border-box, scrollHeight should be sufficient
        
        const computedStyle = getComputedStyle(promptInput);
        const maxHeight = parseInt(computedStyle.maxHeight, 10) || 100; // Fallback to 100px if not set

        if (newHeight > maxHeight) {
            newHeight = maxHeight;
            promptInput.style.overflowY = 'auto'; 
        } else {
            promptInput.style.overflowY = 'hidden';
        }
        promptInput.style.height = newHeight + 'px';
    }
    
    // Initial adjustment 
    adjustTextareaHeight();

    copyPromptOutputButton.addEventListener('click', () => {
        const textToCopy = promptOutput.textContent;
        if (textToCopy && textToCopy !== 'Output will appear here...' && textToCopy !== 'Enhancing...') {
            navigator.clipboard.writeText(textToCopy).then(() => {
                const originalButtonContent = copyPromptOutputButton.innerHTML;
                copyPromptOutputButton.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                `;
                setTimeout(() => {
                    copyPromptOutputButton.innerHTML = originalButtonContent;
                }, 1500);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
                // You could inform the user about the error if desired
                vscode.postMessage({ type: 'error', text: 'Failed to copy text to clipboard.' });
            });
        }
    });
    
    function createCopyButton(textToCopy, container) {
        const button = document.createElement('button');
        button.className = 'history-copy-button';
        button.title = 'Copy to clipboard';
        const originalIconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>`;
        const successIconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>`;
        button.innerHTML = originalIconSvg;

        button.addEventListener('click', () => {
            if (textToCopy) {
                navigator.clipboard.writeText(textToCopy).then(() => {
                    button.innerHTML = successIconSvg;
                    setTimeout(() => {
                        button.innerHTML = originalIconSvg;
                    }, 1500);
                }).catch(err => {
                    console.error('Failed to copy text from history: ', err);
                    vscode.postMessage({ type: 'error', text: 'Failed to copy text to clipboard.' });
                });
            }
        });
        container.appendChild(button);
        // Position the button absolutely within its container (promptDiv or responseDiv)
        // This requires the container to have position: relative
        container.style.position = 'relative';
    }

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'settings':
                if (message.serverUrl) {
                    serverUrlInput.value = message.serverUrl;
                    checkServerStatus(message.serverUrl); // Check status when settings are loaded
                } else {
                    checkServerStatus(null); // Handle case where serverUrl might be initially empty
                }
                break;
            case 'history':
                fullHistory = message.history || [];
                renderHistory(fullHistory); // Render all history initially
                break;
            case 'enhancedPrompt':
                document.getElementById('promptOutputContainer').classList.remove('hidden'); // Ensure it's visible
                promptOutput.textContent = message.text;
                break;
            case 'promptError':
                document.getElementById('promptOutputContainer').classList.remove('hidden'); // Ensure it's visible
                promptOutput.textContent = `Error: ${message.error}`;
                break;
        }
    });
    
    function renderHistory(historyToRender) {
        if (!historyToRender || historyToRender.length === 0) {
            const searchTerm = historySearchInput.value.trim();
            if (searchTerm) {
                historyContainer.innerHTML = '<p>No history matches your search.</p>';
            } else {
                historyContainer.innerHTML = '<p>No history yet.</p>';
            }
            return;
        }

        historyContainer.innerHTML = ''; // Clear previous history

        // This check is now at the beginning of the function
        // if (historyToRender.length === 0) {
        //     historyContainer.innerHTML = '<p>No history yet.</p>';
        //     return;
        // }

        const historyWrapper = document.createElement('div');
        historyWrapper.className = 'history-items-wrapper';

        historyToRender.forEach(entry => {
            const card = document.createElement('div');
            card.className = 'history-card';
            // Add data attributes for searching
            card.dataset.prompt = entry.prompt.toLowerCase();
            card.dataset.response = entry.response.toLowerCase();


            const promptDiv = document.createElement('div');
            promptDiv.className = 'prompt-section';
            const promptHeader = document.createElement('strong');
            promptHeader.textContent = 'Prompt:';
            promptDiv.appendChild(promptHeader);
            const promptPre = document.createElement('pre');
            promptPre.textContent = entry.prompt;
            
            const promptPreWrapper = document.createElement('div');
            promptPreWrapper.className = 'pre-wrapper';
            promptPreWrapper.appendChild(promptPre);
            createCopyButton(entry.prompt, promptPreWrapper); // Pass wrapper to copy button
            promptDiv.appendChild(promptPreWrapper);


            const responseDiv = document.createElement('div');
            responseDiv.className = 'response-section';
            const responseHeader = document.createElement('strong');
            responseHeader.textContent = 'Response:';
            responseDiv.appendChild(responseHeader);
            const responsePre = document.createElement('pre');
            responsePre.textContent = entry.response;

            const responsePreWrapper = document.createElement('div');
            responsePreWrapper.className = 'pre-wrapper';
            responsePreWrapper.appendChild(responsePre);
            createCopyButton(entry.response, responsePreWrapper); // Pass wrapper to copy button
            responseDiv.appendChild(responsePreWrapper);

            card.appendChild(promptDiv);
            card.appendChild(responseDiv);
            historyWrapper.appendChild(card);
        });
        historyContainer.appendChild(historyWrapper);
    }

    historySearchInput.addEventListener('input', () => {
        const searchTerm = historySearchInput.value.trim().toLowerCase();
        if (!searchTerm) {
            renderHistory(fullHistory); // If search is empty, show all history
            return;
        }

        const filteredHistory = fullHistory.filter(entry => {
            return entry.prompt.toLowerCase().includes(searchTerm) ||
                   entry.response.toLowerCase().includes(searchTerm);
        });
        renderHistory(filteredHistory);
    });

}());
