/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    DidCloseTextDocumentParams,
    DocumentUri,
    TextDocumentIdentifier} from 'vscode-languageclient/node';
import { RoslynLanguageServer } from '../../../lsptoolshost/roslynLanguageServer';
import { UriConverter } from '../../../lsptoolshost/uriConverter';
import { RazorDocumentManager } from '../Document/RazorDocumentManager';
import { RazorLogger } from '../RazorLogger';
import { ProvideDynamicFileParams } from './ProvideDynamicFileParams';
import { ProvideDynamicFileResponse } from './ProvideDynamicFileResponse';
import { RemoveDynamicFileParams } from './RemoveDynamicFileParams';

// Handles Razor generated doc communication between the Roslyn workspace and Razor.
// didChange behavior for Razor generated docs is handled in the RazorDocumentManager.
export class DynamicFileInfoHandler {
    public static readonly provideDynamicFileInfoCommand = 'razor.provideDynamicFileInfo';
    public static readonly removeDynamicFileInfoCommand = 'razor.removeDynamicFileInfo';

    constructor(
        private readonly documentManager: RazorDocumentManager,
        private readonly logger: RazorLogger) { }

    public register() {
        vscode.commands.registerCommand(DynamicFileInfoHandler.provideDynamicFileInfoCommand, async (request: ProvideDynamicFileParams) => {
            return this.provideDynamicFileInfo(request);
        });
        vscode.commands.registerCommand(DynamicFileInfoHandler.removeDynamicFileInfoCommand, async (request: RemoveDynamicFileParams) => {
            this.removeDynamicFileInfo(request);
        });
    }

    // Given Razor document URIs, returns associated generated doc URIs
    private async provideDynamicFileInfo(request: ProvideDynamicFileParams): Promise<ProvideDynamicFileResponse> {
        const uris = request.razorFiles;
        const virtualUris = new Array<DocumentUri | null>();
        try {
            for (const razorDocumentUri of uris) {
                const vscodeUri = vscode.Uri.parse('file:' + razorDocumentUri, true);
                const razorDocument = await this.documentManager.getDocument(vscodeUri);
                if (razorDocument === undefined) {
                    virtualUris.push(null);
                    this.logger.logWarning(`Could not find Razor document ${razorDocumentUri}; adding null as a placeholder in URI array.`);
                } else {
                    // Retrieve generated doc URIs for each Razor URI we are given
                    let virtualCsharpUri = UriConverter.serialize(razorDocument.csharpDocument.uri);
                    virtualUris.push(virtualCsharpUri); 
                }
            }

            // Execute any pending didChange notifications that were queued before Roslyn activated.
            for (const didChangeNotification of this.documentManager.getPendingChangeNotifications) {
                vscode.commands.executeCommand(RoslynLanguageServer.roslynDidChangeCommand, didChangeNotification); 
            }

            this.documentManager.clearPendingDidChangeNotifications();
            this.documentManager.roslynActivated = true;
        } catch (error) {
            this.logger.logWarning(`${DynamicFileInfoHandler.provideDynamicFileInfoCommand} failed with ${error}`);
        }

        return new ProvideDynamicFileResponse(virtualUris);
    }

    private async removeDynamicFileInfo(request: RemoveDynamicFileParams) {
        try {
            const uris = request.razorFiles;
            for (const razorDocumentUri of uris) {
                const vscodeUri = vscode.Uri.parse('file:' + razorDocumentUri, true);
                if (this.documentManager.isRazorDocumentOpenInCSharpWorkspace(vscodeUri)) {
                    this.documentManager.didCloseRazorCSharpDocument(vscodeUri);
                    const textDocumentIdentifier = TextDocumentIdentifier.create(vscodeUri.path);

                    // Send textDocument/didClose request to Roslyn
                    const didCloseRequest: DidCloseTextDocumentParams = {
                        textDocument: textDocumentIdentifier
                    };

                    vscode.commands.executeCommand(RoslynLanguageServer.roslynDidCloseCommand, didCloseRequest);
                }
            }    
        } catch (error) {
            this.logger.logWarning(`${DynamicFileInfoHandler.removeDynamicFileInfoCommand} failed with ${error}`);
        }
    }
}