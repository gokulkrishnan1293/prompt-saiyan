// media/main.js
(function() {
    const vscode = acquireVsCodeApi();

    const serverUrlInput = document.getElementById('serverUrl');
    const saveSettingsButton = document.getElementById('saveSettings');
    const historyContainer = document.getElementById('historyContainer');
    const clearHistoryButton = document.getElementById('clearHistory');

    // Request initial settings and history when the webview loads
    vscode.postMessage({ type: 'getSettings' });
    vscode.postMessage({ type: 'getHistory' });

    saveSettingsButton.addEventListener('click', () => {
        const serverUrl = serverUrlInput.value;
        vscode.postMessage({ type: 'saveSettings', serverUrl: serverUrl });
    });

    clearHistoryButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearHistory' });
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