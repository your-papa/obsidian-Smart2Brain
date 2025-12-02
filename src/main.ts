import { App, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/ChatView";
import type { SmartSecondBrainSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import { AgentManager } from "./agent/AgentManager";

// Helper function to generate a date/time-based thread ID and filename
function generateChatId(): { threadId: string; filename: string } {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	const hours = String(now.getHours()).padStart(2, '0');
	const minutes = String(now.getMinutes()).padStart(2, '0');
	const seconds = String(now.getSeconds()).padStart(2, '0');

	// Format: Chat YYYY-MM-DD HH-MM-SS
	const threadId = `Chat ${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
	const filename = threadId; // Use same format so getFilePath can find it

	return { threadId, filename };
}

export default class SmartSecondBrainPlugin extends Plugin {
	settings!: SmartSecondBrainSettings;
	agentManager!: AgentManager;

	async onload() {
		await this.loadSettings();

		// Register .chat extension
		this.registerExtensions(["chat"], VIEW_TYPE_CHAT);

		// Register the chat view
		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		// Add ribbon icon to create and open a fresh chat
		this.addRibbonIcon("message-square", "New S2B Chat", () => {
			this.createNewChat();
		});

		// Add command to open latest chat
		this.addCommand({
			id: "open-chat",
			name: "Open S2B Chat",
			callback: () => {
				this.activateView();
			},
		});

		// Add command to create a new chat
		this.addCommand({
			id: "new-chat",
			name: "Create New S2B Chat",
			callback: () => {
				this.createNewChat();
			},
		});

		// Add settings tab
		this.addSettingTab(new SmartSecondBrainSettingTab(this.app, this));

		// Initialize agent manager
		this.agentManager = new AgentManager(this);
		await this.agentManager.initialize();
	}

	onunload() {
		// Cleanup agent manager
		if (this.agentManager) {
			this.agentManager.cleanup();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Reinitialize agent when settings change
		if (this.agentManager) {
			await this.agentManager.initialize();
		}
	}

	async createNewChat() {
		const { workspace } = this.app;
		const chatsFolder = this.settings.chatsFolder || "Chats";

		// Ensure folder exists
		if (!(await this.app.vault.adapter.exists(chatsFolder))) {
			await this.app.vault.createFolder(chatsFolder);
		}

		// Create a new chat file with date/time-based name
		const { threadId, filename } = generateChatId();
		const newPath = normalizePath(`${chatsFolder}/${filename}.chat`);
		// Initialize with minimal valid JSON
		const initialData = {
			threadId: threadId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			checkpoints: {},
			writes: {}
		};
		const file = await this.app.vault.create(newPath, JSON.stringify(initialData, null, 2));

		// Open it
		await workspace.getLeaf(false).openFile(file);
	}

	async activateView() {
		const { workspace } = this.app;
		const chatsFolder = this.settings.chatsFolder || "Chats";

		// Ensure folder exists
		if (!(await this.app.vault.adapter.exists(chatsFolder))) {
			await this.app.vault.createFolder(chatsFolder);
		}

		// Find latest chat file
		const files = this.app.vault.getFiles()
			.filter(f => f.path.startsWith(chatsFolder) && f.extension === "chat")
			.sort((a, b) => b.stat.mtime - a.stat.mtime);

		let fileToOpen = files[0];

		if (!fileToOpen) {
			// Create a new chat file with date/time-based name
			const { threadId, filename } = generateChatId();
			const newPath = normalizePath(`${chatsFolder}/${filename}.chat`);
			// Initialize with minimal valid JSON
			const initialData = {
				threadId: threadId,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				checkpoints: {},
				writes: {}
			};
			fileToOpen = await this.app.vault.create(newPath, JSON.stringify(initialData, null, 2));
		}

		await workspace.getLeaf(false).openFile(fileToOpen);
	}
}

class SmartSecondBrainSettingTab extends PluginSettingTab {
	plugin: SmartSecondBrainPlugin;

	constructor(app: App, plugin: SmartSecondBrainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Smart Second Brain Settings" });

		new Setting(containerEl)
			.setName("Chats Folder")
			.setDesc("Folder to store chat history files")
			.addText((text) => {
				text
					.setPlaceholder("Chats")
					.setValue(this.plugin.settings.chatsFolder)
					.onChange(async (value) => {
						this.plugin.settings.chatsFolder = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Readable Line Length")
			.setDesc("Limit chat view width to 75 characters for better readability")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.readableLineLength ?? false)
					.onChange(async (value) => {
						this.plugin.settings.readableLineLength = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("LLM Provider")
			.setDesc("Choose your LLM provider")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("openai", "OpenAI")
					.addOption("anthropic", "Anthropic")
					.addOption("ollama", "Ollama")
					.addOption("sap-ai-core", "SAP AI Core")
					.addOption("custom", "Custom")
					.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider = value as any;
						await this.plugin.saveSettings();
						// Refresh the settings display to update descriptions
						await this.display();
					});
			});

		const apiKeySetting = new Setting(containerEl)
			.setName("API Key / Base URL")
			.addText((text) => {
				text
					.setPlaceholder(
						this.plugin.settings.provider === "ollama"
							? "http://localhost:11434"
							: "Enter your API key"
					)
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
						// Reload models when API key changes
						if (updateModelDropdown) {
							await updateModelDropdown();
						}
					});
			});

		// Set description based on provider
		if (this.plugin.settings.provider === "ollama") {
			apiKeySetting.setDesc("Ollama base URL (e.g., http://localhost:11434) - API key not required");
		} else if (this.plugin.settings.provider === "sap-ai-core") {
			apiKeySetting.setDesc("SAP AI Core configuration (API key or connection details)");
		} else {
			apiKeySetting.setDesc("Your API key for the selected provider");
		}

		const modelSetting = new Setting(containerEl)
			.setName("Model")
			.setDesc("Select a model from the available options");

		let modelDropdown: any;
		modelSetting.addDropdown((dropdown) => {
			modelDropdown = dropdown;
			dropdown
				.addOption("", "Loading models...")
				.setValue("")
				.setDisabled(true);
		});

		// Function to update model dropdown
		const updateModelDropdown = async () => {
			const provider = this.plugin.settings.provider;
			const apiKey = this.plugin.settings.apiKey;

			// Skip if custom provider or no API key (except for Ollama which has default)
			if (provider === "custom" || (!apiKey && provider !== "ollama")) {
				modelDropdown.selectEl.empty();
				modelDropdown.addOption("", "Enter API key first");
				modelDropdown.setValue("");
				modelDropdown.setDisabled(true);
				return;
			}

			// Show loading state
			modelDropdown.selectEl.empty();
			modelDropdown.addOption("", "Loading models...");
			modelDropdown.setValue("");
			modelDropdown.setDisabled(true);

			try {
				const models = await this.plugin.agentManager.getAvailableModels(
					provider,
					apiKey
				);

				// Clear and populate dropdown
				modelDropdown.selectEl.empty();
				if (models.length === 0) {
					modelDropdown.addOption("", "No models available");
					modelDropdown.setValue("");
					modelDropdown.setDisabled(true);
				} else {
					for (const model of models) {
						modelDropdown.addOption(model, model);
					}
					// Set to current model if it's in the list, otherwise first model
					const currentModel = this.plugin.settings.modelName;
					if (models.includes(currentModel)) {
						modelDropdown.setValue(currentModel);
					} else {
						modelDropdown.setValue(models[0]);
						this.plugin.settings.modelName = models[0];
						await this.plugin.saveSettings();
					}
					modelDropdown.setDisabled(false);
				}
			} catch (error) {
				modelDropdown.selectEl.empty();
				modelDropdown.addOption(
					"",
					`Error: ${error instanceof Error ? error.message : "Failed to load models"}`
				);
				modelDropdown.setValue("");
				modelDropdown.setDisabled(true);
			}
		};

		// Set up dropdown change handler
		modelDropdown.onChange(async (value: string) => {
			if (value) {
				this.plugin.settings.modelName = value;
				await this.plugin.saveSettings();
			}
		});

		// Load models initially
		await updateModelDropdown();

		containerEl.createEl("h3", { text: "MCP Servers" });

		new Setting(containerEl)
			.setName("MCP Server Configuration")
			.setDesc("JSON configuration for MCP servers (see langchain docs)")
			.addTextArea((text) => {
				text
					.setPlaceholder(`{
  "tavily": {
    "url": "https://mcp.tavily.com/mcp/?tavilyApiKey=..."
  },
  "math": {
    "transport": "stdio",
    "command": "node",
    "args": ["/path/to/math_server.js"]
  }
}`)
					.setValue(JSON.stringify(this.plugin.settings.mcpServers || {}, null, 2))
					.onChange(async (value) => {
						try {
							const parsed = JSON.parse(value);
							this.plugin.settings.mcpServers = parsed;
							await this.plugin.saveSettings();
						} catch (e) {
							console.error("Invalid JSON for MCP servers");
						}
					});
				text.inputEl.rows = 10;
				text.inputEl.cols = 50;
			});

		containerEl.createEl("h3", { text: "Telemetry" });

		new Setting(containerEl)
			.setName("Enable LangSmith Telemetry")
			.setDesc("Enable tracing with LangSmith")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableLangSmith || false)
					.onChange(async (value) => {
						this.plugin.settings.enableLangSmith = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide API key field
					});
			});

		if (this.plugin.settings.enableLangSmith) {
			new Setting(containerEl)
				.setName("LangSmith API Key")
				.setDesc("Your LangSmith API Key (starts with lsv2_...)")
				.addText((text) => {
					text
						.setPlaceholder("lsv2_...")
						.setValue(this.plugin.settings.langSmithApiKey || "")
						.onChange(async (value) => {
							this.plugin.settings.langSmithApiKey = value;
							await this.plugin.saveSettings();
						});
				});

			new Setting(containerEl)
				.setName("LangSmith Project")
				.setDesc("Project name for traces")
				.addText((text) => {
					text
						.setPlaceholder("default")
						.setValue(this.plugin.settings.langSmithProject || "obsidian-agent")
						.onChange(async (value) => {
							this.plugin.settings.langSmithProject = value;
							await this.plugin.saveSettings();
						});
				});

			new Setting(containerEl)
				.setName("LangSmith Endpoint")
				.setDesc("API endpoint for LangSmith (EU: https://eu.api.smith.langchain.com)")
				.addText((text) => {
					text
						.setPlaceholder("https://api.smith.langchain.com")
						.setValue(this.plugin.settings.langSmithEndpoint || "https://api.smith.langchain.com")
						.onChange(async (value) => {
							this.plugin.settings.langSmithEndpoint = value;
							await this.plugin.saveSettings();
						});
				});
		}
	}
}

