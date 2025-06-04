import * as vscode from 'vscode';
import { promptSaiyan } from './prompt/promptSaiyan';
//import { promptSaiyanOutputChannel } from './helpers';

export function activate(context: vscode.ExtensionContext) {

    const regex = /Visual Studio Code/;
    if (!regex.test(vscode.env.appName)) {
        vscode.window.showErrorMessage("This extension can only be used with Visual Studio Code. Using it in any other product could cause unexpected behavior, performance, or security issues.", { modal: true });
        return;
    }

    registerAgentTools(context);

   

    // Register the Sidebar View Provider
    const sidebarProvider = new SidebarViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider)
    );
}


export function registerAgentTools(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.lm.registerTool('promptsaiyan', new promptSaiyanTool()));
}

// Store a reference to the sidebar provider to allow other parts of the extension to interact with it
let sidebarViewProvider: SidebarViewProvider | undefined;

class SidebarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'promptsaiyan.sidebarView';

    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        context: vscode.ExtensionContext
    ) {
        this._context = context;
        sidebarViewProvider = this; // Store the instance
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist', 'media')]
        };

        this._getHtmlForWebview(webviewView.webview).then(html => {
            webviewView.webview.html = html;
        });

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'getSettings': {
                    const serverUrl = vscode.workspace.getConfiguration('promptsaiyan').get('serverUrl');
                    webviewView.webview.postMessage({ type: 'settings', serverUrl: serverUrl });
                    break;
                }
                case 'saveSettings': {
                    await vscode.workspace.getConfiguration('promptsaiyan').update('serverUrl', data.serverUrl, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('Prompt Saiyan settings saved.');
                    break;
                }
                case 'getHistory': {
                    const history = this._context.globalState.get<Array<{prompt: string, response: string}>>('promptHistory', []);
                    webviewView.webview.postMessage({ type: 'history', history: history });
                    break;
                }
                case 'clearHistory': {
                    await this._context.globalState.update('promptHistory', []);
                    webviewView.webview.postMessage({ type: 'history', history: [] });
                    vscode.window.showInformationMessage('Prompt history cleared.');
                    break;
                }
            }
        });

        // Send initial settings and history
        const serverUrl = vscode.workspace.getConfiguration('promptsaiyan').get('serverUrl');
        webviewView.webview.postMessage({ type: 'settings', serverUrl: serverUrl });
        const history = this._context.globalState.get<Array<{prompt: string, response: string}>>('promptHistory', []);
        webviewView.webview.postMessage({ type: 'history', history: history });
    }

    public addHistoryEntry(prompt: string, response: string) {
        if (this._view) {
            const history = this._context.globalState.get<Array<{prompt: string, response: string}>>('promptHistory', []);
            history.unshift({ prompt, response }); // Add to the beginning
            // Keep history to a reasonable size, e.g., last 50 entries
            if (history.length > 10) {
                history.length = 10;
            }
            this._context.globalState.update('promptHistory', history);
            this._view.webview.postMessage({ type: 'history', history: history });
        }
    }


private async _getHtmlForWebview(webview: vscode.Webview): Promise<string> {
    // Path to the index.html file within the dist/media directory
    const htmlUri = vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'index.html');

    // URIs for webview resources, also pointing to dist/media
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'styles.css'));
    
    const nonce = getNonce(); // Helper function to generate a nonce
    const csp = webview.cspSource;
    
    const buffer = await vscode.workspace.fs.readFile(htmlUri);
    let html = buffer.toString();
    html = html
        .replace(/{{cspSource}}/g, csp)
        .replace(/{{nonce}}/g, nonce)
        .replace(/{{styleUri}}/g, styleUri.toString())
        .replace(/{{scriptUri}}/g, scriptUri.toString());
    return html;
}


};

// Function to get nonce for CSP
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// Modify promptSaiyan function to record history
// We need to find where promptSaiyan is called and pass the response back.
// For now, let's assume promptSaiyanTool's invoke method is the primary place.

interface IPromptBoostParameters {
    promptText: string;
}

export class promptSaiyanTool implements vscode.LanguageModelTool<IPromptBoostParameters> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IPromptBoostParameters>,
        _token: vscode.CancellationToken
    ) {
        const params = options.input as IPromptBoostParameters;
        const editor = vscode.window.activeTextEditor;
        const languageId = editor?.document.languageId;
        const result = await promptSaiyan(params.promptText, languageId); // Pass languageId

        // Record history
        if (sidebarViewProvider) {
            sidebarViewProvider.addHistoryEntry(params.promptText, result);
        }

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)]);
    }

    async prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<IPromptBoostParameters>,
        _token: vscode.CancellationToken
    ) {
        return {
            invocationMessage: `Boosting your prompt...`
        };
    }
}

export function deactivate() { }