// media/main.js
(function() {
    const vscode = acquireVsCodeApi();

    const serverUrlInput = document.getElementById('serverUrl');
    const saveSettingsButton = document.getElementById('saveSettings');
    const historyContainer = document.getElementById('historyContainer');
    const clearHistoryButton = document.getElementById('clearHistory');

    const promptInput = document.getElementById('promptInput');
    const submitPromptButton = document.getElementById('submitPrompt');
    const promptOutput = document.getElementById('promptOutput');
    const copyPromptOutputButton = document.getElementById('copyPromptOutput');


    // Request initial settings and history when the webview loads
    vscode.postMessage({ type: 'getSettings' });
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
    });

    clearHistoryButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearHistory' });
    });
    
    submitPromptButton.addEventListener('click', () => {
        const promptText = promptInput.value;
        if (promptText) {
            promptOutput.textContent = 'Enhancing...'; // Provide immediate feedback
            vscode.postMessage({ type: 'submitPrompt', text: promptText });
        }
    });

    copyPromptOutputButton.addEventListener('click', () => {
        const textToCopy = promptOutput.textContent;
        if (textToCopy && textToCopy !== 'Output will appear here...' && textToCopy !== 'Enhancing...') {
            navigator.clipboard.writeText(textToCopy).then(() => {
                // Optional: Show a temporary "Copied!" message or change button text
                const originalButtonText = copyPromptOutputButton.textContent;
                copyPromptOutputButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyPromptOutputButton.textContent = originalButtonText;
                }, 1500);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
                // You could inform the user about the error if desired
                vscode.postMessage({ type: 'error', text: 'Failed to copy text to clipboard.' });
            });
        }
    });
    
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'settings':
                if (message.serverUrl) {
                    serverUrlInput.value = message.serverUrl;
                }
                break;
            case 'history':
                renderHistory(message.history);
                break;
            case 'enhancedPrompt':
                promptOutput.textContent = message.text;
                // Optionally, clear the input field after successful enhancement
                // promptInput.value = '';
                break;
            case 'promptError':
                promptOutput.textContent = `Error: ${message.error}`;
                break;
        }
    });
    
    function renderHistory(history) {
        if (!history || history.length === 0) {
            historyContainer.innerHTML = '<p>No history yet.</p>';
            return;
        }

        historyContainer.innerHTML = ''; // Clear previous history

        const ul = document.createElement('ul');
        ul.className = 'history-list';

        history.forEach(entry => {
            const li = document.createElement('li');
            li.className = 'history-entry';

            const promptDiv = document.createElement('div');
            promptDiv.className = 'prompt-section';
            const promptHeader = document.createElement('strong');
            promptHeader.textContent = 'Prompt:';
            promptDiv.appendChild(promptHeader);
            const promptPre = document.createElement('pre');
            promptPre.textContent = entry.prompt;
            promptDiv.appendChild(promptPre);

            const responseDiv = document.createElement('div');
responseDiv.className = 'response-section';
            const responseHeader = document.createElement('strong');
            responseHeader.textContent = 'Response:';
            responseDiv.appendChild(responseHeader);
            const responsePre = document.createElement('pre');
            responsePre.textContent = entry.response;
            responseDiv.appendChild(responsePre);

            li.appendChild(promptDiv);
            li.appendChild(responseDiv);
            ul.appendChild(li);
        });
        historyContainer.appendChild(ul);
    }
}());