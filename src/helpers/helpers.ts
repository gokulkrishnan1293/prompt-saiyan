import * as vscode from 'vscode';

const promptSaiyanOutputChannel = vscode.window.createOutputChannel('PromptSaiyan');

function getMcpServerUrl(): string {
    return vscode.workspace.getConfiguration('promptsaiyan').get('serverUrl', 'http://127.0.0.1:8001/enrich'); // Default if not set
}

export { promptSaiyanOutputChannel,getMcpServerUrl };