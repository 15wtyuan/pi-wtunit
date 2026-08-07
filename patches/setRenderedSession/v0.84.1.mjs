/**
 * setRenderedSession — ExtensionUIContext API to render an external AgentSession
 * in the main TUI pipeline (see earendil-works/pi#7058 / #7059).
 *
 * Anchors verified against @earendil-works/pi-coding-agent@0.84.1 dist.
 * (Same anchors as 0.83.0; all transforms apply cleanly.)
 */
export default {
	id: "setRenderedSession",
	piVersion: "0.84.1",
	files: [
		{
			path: "dist/core/extensions/types.d.ts",
			markers: ["setRenderedSession(session: AgentSession | undefined)"],
			transforms: [
				{
					find: 'import type { Theme } from "../../modes/interactive/theme/theme.ts";\n',
					replace:
						'import type { Theme } from "../../modes/interactive/theme/theme.ts";\nimport type { AgentSession } from "../agent-session.ts";\n',
				},
				{
					find:
						"}): Promise<T>;\n    /** Paste text into the editor, triggering paste handling (collapse for large content). */\n    pasteToEditor(text: string): void;",
					replace: `}): Promise<T>;
    /**
     * Point the interactive renderer (chat transcript, footer, editor submit
     * routing, terminal title) at an external {@link AgentSession} — for example
     * an in-process subagent session — reusing the entire main render pipeline
     * instead of a simulated overlay. Pass \`undefined\` to return to the session
     * pi is actually running. Setting a new session while one is already rendered
     * switches directly.
     *
     * Unlike switchSession (which loads a session from a path and disposes the
     * current one), this neither creates nor destroys sessions — the running
     * session keeps executing in the background, and the passed session must
     * already be a fully initialized AgentSession (its extensions are NOT
     * re-bound). A real session switch (\`/new\`, \`/resume\`, \`/fork\`, \`/reload\`)
     * resets this override automatically.
     *
     * TUI mode only; a no-op in non-interactive modes.
     *
     * @pi-wtunit-patch setRenderedSession
     */
    setRenderedSession(session: AgentSession | undefined): Promise<void>;
    /** Paste text into the editor, triggering paste handling (collapse for large content). */
    pasteToEditor(text: string): void;`,
				},
			],
		},
		{
			path: "dist/core/extensions/runner.js",
			markers: ["setRenderedSession: async () => { }"],
			transforms: [
				{
					find: "custom: async () => undefined,\n    pasteToEditor: () => { },",
					replace:
						"custom: async () => undefined,\n    setRenderedSession: async () => { },\n    pasteToEditor: () => { },",
				},
			],
		},
		{
			path: "dist/modes/rpc/rpc-mode.js",
			markers: ["async setRenderedSession()"],
			transforms: [
				{
					find:
						"async custom() {\n            // Custom UI not supported in RPC mode\n            return undefined;\n        },\n        pasteToEditor(text) {",
					replace:
						"async custom() {\n            // Custom UI not supported in RPC mode\n            return undefined;\n        },\n        async setRenderedSession() {\n            // Session presentation not supported in RPC mode (no interactive renderer)\n        },\n        pasteToEditor(text) {",
				},
			],
		},
		{
			path: "dist/modes/interactive/interactive-mode.js",
			markers: [
				"presentedSession = undefined",
				"async setRenderedSession(session)",
				"setRenderedSession: (session) => this.setRenderedSession(session)",
			],
			transforms: [
				// 1. session getter override
				{
					find:
						"// Convenience accessors\n    get session() {\n        return this.runtimeHost.session;\n    }",
					replace:
						"// Convenience accessors\n    // pi-wtunit-patch:setRenderedSession — renderer follows presentedSession when set\n    presentedSession = undefined;\n    get session() {\n        return this.presentedSession ?? this.runtimeHost.session;\n    }",
				},
				// 2. clear override on real session invalidate
				{
					find:
						"this.runtimeHost.setBeforeSessionInvalidate(() => {\n            this.resetExtensionUI();\n        });",
					replace:
						"this.runtimeHost.setBeforeSessionInvalidate(() => {\n            // pi-wtunit-patch:setRenderedSession\n            this.presentedSession = undefined;\n            this.resetExtensionUI();\n        });",
				},
				// 3. methods after renderCurrentSessionState
				{
					find:
						"renderCurrentSessionState() {\n        this.loadedResourcesContainer.clear();\n        this.chatContainer.clear();\n        this.pendingMessagesContainer.clear();\n        this.compactionQueuedMessages = [];\n        this.streamingComponent = undefined;\n        this.streamingMessage = undefined;\n        this.pendingTools.clear();\n        this.renderInitialMessages();\n    }\n    /**\n     * Get a registered tool definition by name (for custom rendering).\n     */",
					replace:
						`renderCurrentSessionState() {
        this.loadedResourcesContainer.clear();
        this.chatContainer.clear();
        this.pendingMessagesContainer.clear();
        this.compactionQueuedMessages = [];
        this.streamingComponent = undefined;
        this.streamingMessage = undefined;
        this.pendingTools.clear();
        this.renderInitialMessages();
    }
    /**
     * Point the interactive renderer (transcript, footer, editor submit routing,
     * title) at an external AgentSession, or pass undefined to return to the
     * session pi is actually running. The running session keeps executing in the
     * background; nothing is disposed. Switching while one is already rendered
     * replaces it. A real session switch (/new, /resume, /fork, /reload) resets
     * the override first.
     *
     * @pi-wtunit-patch setRenderedSession
     */
    async setRenderedSession(session) {
        const target = session ?? undefined;
        if (this.presentedSession === target)
            return;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        // Not resetExtensionUI(): it clears extension widgets, which would drop the
        // caller's own fleet bar and strand the user in the presented session.
        this.presentedSession = target;
        this.syncSessionBoundUI();
        this.renderCurrentSessionState();
        this.subscribeToAgent();
        this.ui.requestRender();
    }
    /** @pi-wtunit-patch setRenderedSession */
    syncSessionBoundUI() {
        this.footer.setSession(this.session);
        this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
        this.footerDataProvider.setCwd(this.sessionManager.getCwd());
        this.updateEditorBorderColor();
        this.updateTerminalTitle();
    }
    /**
     * Get a registered tool definition by name (for custom rendering).
     */`,
				},
				// 4. expose on ExtensionUIContext
				{
					find:
						"custom: (factory, options) => this.showExtensionCustom(factory, options),\n            pasteToEditor: (text) => this.editor.handleInput(`\\x1b[200~${text}\\x1b[201~`),",
					replace:
						"custom: (factory, options) => this.showExtensionCustom(factory, options),\n            setRenderedSession: (session) => this.setRenderedSession(session),\n            pasteToEditor: (text) => this.editor.handleInput(`\\x1b[200~${text}\\x1b[201~`),",
				},
			],
		},
	],
};
