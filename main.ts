import {
	App,
	Plugin,
	TFile,
	moment,
	MarkdownView,
	PluginSettingTab,
	Setting,
	TAbstractFile,
} from "obsidian";

declare module "obsidian" {
	interface App {
		commands: {
			executeCommandById(customCommand: string): unknown;
			listCommands(): { id: string; name: string }[];
		};
	}
}

interface FrontMatterTimestampsSettings {
	autoUpdate: boolean;
	autoAddTimestamps: boolean;
	createdPropertyName: string;
	modifiedPropertyName: string;
	dateFormat: string;
	allowNonEmptyNewFile: boolean;
	delayAddingTimestamps: number;
	delayModifiedUpdate: number;
	excludedFolders: string[];
	customCommand: string;
	debug: boolean;
}

const DEFAULT_SETTINGS: FrontMatterTimestampsSettings = {
	autoUpdate: true,
	autoAddTimestamps: true,
	createdPropertyName: "created",
	modifiedPropertyName: "modified",
	dateFormat: "YYYY-MM-DDTHH:mm:ssZ",
	allowNonEmptyNewFile: false,
	delayAddingTimestamps: 1000,
	delayModifiedUpdate: 1000,
	excludedFolders: [],
	customCommand: "",
	debug: false,
};

async function getFileContent(app: App, file: TFile): Promise<string> {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) {
			return view.getViewData();
		}
	}
	return app.vault.read(file);
}

export default class FrontMatterTimestampsPlugin extends Plugin {
	settings: FrontMatterTimestampsSettings;
	private lastActiveFile: TFile | null = null;
	private lastChecksum: string | null = null;

	private pendingNewFiles = new Set<string>();
	private pendingModifiedUpdates = new Map<string, number>();

	private isPathExcluded(filePath: string): boolean {
		// Immediate return if there are no excluded folders
		if (this.settings.excludedFolders.length === 0) {
			return false;
		}

		const pathSegments = filePath.split("/");
		// Generate all possible subpaths to compare against excluded folders
		const fullPathChecks = pathSegments.map((_, index) =>
			pathSegments.slice(0, index + 1).join("/"),
		);
		return this.settings.excludedFolders.some((excludedPath) =>
			fullPathChecks.includes(excludedPath),
		);
	}

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new FrontMatterTimestampsSettingTab(this.app, this));

		// Register the command to manually update modified time
		this.addCommand({
			id: "update-modified-time",
			name: "Update modified time",
			checkCallback: (checking: boolean) => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView?.file) {
					if (!checking) {
						void this.updateModifiedTime(markdownView.file, true);
					}
					return true;
				}
				return false;
			},
		});

		// Listen for new file creations
		this.registerEvent(
			this.app.vault.on("create", (f: TAbstractFile) => {
				if (this.settings.debug) {
					console.log(`File created: ${f.path}`);
				}

				// Only process TFile, not TFolder
				switch (f.constructor) {
					case TFile:
						// Handle TFile
						break;
					default:
						// TFolder or other types - ignore
						return;
				}

				const file = f as TFile;

				if (Date.now() - file.stat.ctime > 30000) {
					// If the note was actually created a long time ago, skip
					if (this.settings.debug) {
						console.log(
							`Skipping timestamps on ${file.path}; ctime is older than 60s.`,
						);
					}
					return;
				}

				// Mark this file as newly created so we can process it after a delay
				if (
					this.settings.autoAddTimestamps &&
					file.extension === "md" &&
					!this.isPathExcluded(file.path)
				) {
					this.pendingNewFiles.add(file.path);
					this.handleNewFileTimestamps(file);
				}
			}),
		);

		// Listen for active leaf changes if autoUpdate is enabled
		if (this.settings.autoUpdate) {
			this.registerEvent(
				this.app.workspace.on("active-leaf-change", () =>
					this.handleFileChange(),
				),
			);
		}
	}

	private cancelPendingModifiedUpdate(filePath: string) {
		const timeoutId = this.pendingModifiedUpdates.get(filePath);
		if (timeoutId !== undefined) {
			window.clearTimeout(timeoutId);
			this.pendingModifiedUpdates.delete(filePath);
		}
	}

	private async handleNewFileTimestamps(file: TFile) {
		const { debug } = this.settings;

		// If not allowed to treat non-empty new files as new, check content
		if (!this.settings.allowNonEmptyNewFile) {
			const fileContent = await this.app.vault.read(file);
			if (fileContent.trim()) {
				if (debug) {
					console.log(
						`File ${file.path} is not empty, skipping initial timestamps.`,
					);
				}
				this.pendingNewFiles.delete(file.path);
				return;
			}
		}

		// Wait the configured delay to allow other plugins (e.g. Templater) to do their work
		if (debug) {
			console.log(
				`Waiting ${this.settings.delayAddingTimestamps}ms before adding timestamps to ${file.path}.`,
			);
		}
		await new Promise((resolve) =>
			setTimeout(resolve, this.settings.delayAddingTimestamps),
		);

		// Check if file still exists after delay
		if (!(await this.app.vault.adapter.exists(file.path))) {
			if (debug) {
				console.log(
					`File ${file.path} no longer exists after delay, skipping timestamp addition.`,
				);
			}
			this.pendingNewFiles.delete(file.path);
			return;
		}

		const currentTime = moment().format(this.settings.dateFormat);

		try {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter) => {
					if (!frontmatter[this.settings.createdPropertyName]) {
						frontmatter[this.settings.createdPropertyName] =
							currentTime;
					}
					if (!frontmatter[this.settings.modifiedPropertyName]) {
						frontmatter[this.settings.modifiedPropertyName] =
							currentTime;
					}
				},
			);
			if (debug) {
				console.log(`Timestamps added to new file ${file.path}`);
			}
		} catch (error) {
			console.error(
				`Error adding timestamps to new file ${file.path}`,
				error,
			);
		} finally {
			this.pendingNewFiles.delete(file.path);
		}
	}

	async handleFileChange() {
		const { debug } = this.settings;
		const markdownView =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		const currentFile = markdownView ? markdownView.file : null;

		if (debug) {
			console.log("handleFileChange called");
		}

		// If no active file, check the previously active file for modifications
		if (!currentFile) {
			if (
				this.lastActiveFile &&
				!this.isPathExcluded(this.lastActiveFile.path)
			) {
				try {
					const fileExists = await this.app.vault.adapter.exists(
						this.lastActiveFile.path,
					);
					if (fileExists) {
						const currentChecksum = await getFileContent(
							this.app,
							this.lastActiveFile,
						);
						if (this.lastChecksum !== currentChecksum) {
							if (debug) {
								console.log(
									`File ${this.lastActiveFile.path} changed while inactive, updating modified time.`,
								);
							}
							void this.updateModifiedTime(this.lastActiveFile);
						}
					} else if (debug) {
						console.log(
							`Last active file ${this.lastActiveFile.path} no longer exists.`,
						);
					}
				} catch (error) {
					console.error(
						`Error checking checksum for ${this.lastActiveFile.path}:`,
						error,
					);
				}
			}
			this.lastActiveFile = null;
			this.lastChecksum = null;
			return;
		}

		if (this.isPathExcluded(currentFile.path)) return;

		this.cancelPendingModifiedUpdate(currentFile.path);

		// Check if switching away from another file
		if (
			this.lastActiveFile &&
			this.lastActiveFile.path !== currentFile.path
		) {
			try {
				const lastFileExists = await this.app.vault.adapter.exists(
					this.lastActiveFile.path,
				);
				if (lastFileExists) {
					const lastFileChecksum = await getFileContent(
						this.app,
						this.lastActiveFile,
					);
					if (this.lastChecksum !== lastFileChecksum) {
						if (debug) {
							console.log(
								`File ${this.lastActiveFile.path} changed before switching, updating modified time.`,
							);
						}
						void this.updateModifiedTime(this.lastActiveFile);
					}
				}
			} catch (error) {
				console.error(
					`Error checking checksum for ${this.lastActiveFile.path}:`,
					error,
				);
			}
		}

		// Update the last active file and checksum if the current file has changed
		if (
			!this.lastActiveFile ||
			this.lastActiveFile.path !== currentFile.path
		) {
			this.lastActiveFile = currentFile;
			this.lastChecksum = await getFileContent(this.app, currentFile);
		}
	}

	async updateModifiedTime(file: TFile | null, immediate = false) {
		const { debug } = this.settings;
		if (!file?.path) return;
		if (this.isPathExcluded(file.path)) return;

		if (file.extension !== "md") {
			if (debug) {
				console.log("File is not a markdown file, skipping.");
			}
			return;
		}

		const apply = async () => {
			if (!immediate) {
				const activeView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView?.file?.path === file.path) {
					if (debug) {
						console.log(
							`Skipping modified time update for ${file.path}; file is the active editor.`,
						);
					}
					return;
				}
			}

			if (!(await this.app.vault.adapter.exists(file.path))) {
				if (debug) {
					console.log(
						`File ${file.path} no longer exists, skipping modified time update.`,
					);
				}
				return;
			}

			for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
				const view = leaf.view;
				if (
					view instanceof MarkdownView &&
					view.file?.path === file.path
				) {
					await view.save();
					break;
				}
			}

			const currentTime = moment().format(this.settings.dateFormat);

			try {
				await this.app.fileManager.processFrontMatter(
					file,
					(frontmatter) => {
						frontmatter[this.settings.modifiedPropertyName] =
							currentTime;
					},
				);

				if (debug) {
					console.log(`File frontmatter updated for ${file.path}`);
				}

				if (this.settings.customCommand) {
					this.app.commands.executeCommandById(
						this.settings.customCommand,
					);
				}
			} catch (error) {
				console.error(
					`Error updating frontmatter for file ${file.path}`,
					error,
				);
			}
		};

		if (immediate) {
			await apply();
			return;
		}

		this.cancelPendingModifiedUpdate(file.path);
		const delay = Math.min(this.settings.delayModifiedUpdate, 250);
		if (debug) {
			console.log(
				`Updating modified time for ${file.path} after a delay of ${delay}ms.`,
			);
		}

		const timeoutId = window.setTimeout(() => {
			this.pendingModifiedUpdates.delete(file.path);
			void apply();
		}, delay);
		this.pendingModifiedUpdates.set(file.path, timeoutId);
	}

	onunload() {
		for (const timeoutId of this.pendingModifiedUpdates.values()) {
			window.clearTimeout(timeoutId);
		}
		this.pendingModifiedUpdates.clear();
	}

	async loadSettings() {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		// Migrate: older installs used delayAddingTimestamps for modified updates too
		if (loaded?.delayModifiedUpdate === undefined) {
			this.settings.delayModifiedUpdate =
				loaded?.delayAddingTimestamps ??
				DEFAULT_SETTINGS.delayModifiedUpdate;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class FrontMatterTimestampsSettingTab extends PluginSettingTab {
	plugin: FrontMatterTimestampsPlugin;

	constructor(app: App, plugin: FrontMatterTimestampsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Automatic update")
			.setDesc("Automatically update modified time on file change")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoUpdate)
					.onChange(async (value) => {
						this.plugin.settings.autoUpdate = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Automatic timestamps")
			.setDesc(
				"Automatically add created and modified timestamps to new notes",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAddTimestamps)
					.onChange(async (value) => {
						this.plugin.settings.autoAddTimestamps = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Created property name")
			.setDesc("Customise the property name for creation timestamp")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.createdPropertyName)
					.onChange(async (value) => {
						this.plugin.settings.createdPropertyName = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Modified property name")
			.setDesc("Customise the property name for modification timestamp")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.modifiedPropertyName)
					.onChange(async (value) => {
						this.plugin.settings.modifiedPropertyName =
							value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Date and time format")
			.setDesc(
				"Specify the desired date and time format using Moment.js tokens. Example: YYYY-MM-DDTHH:mm",
			)
			.addText((text) => {
				text.setPlaceholder("YYYY-MM-DDTHH:mm:ssZ")
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat =
							value.trim() || DEFAULT_SETTINGS.dateFormat;
						await this.plugin.saveSettings();
					});

				const resetButton = text.inputEl.parentElement!.createEl(
					"button",
					{
						text: "Reset",
						cls: "mod-ghost",
					},
				);

				resetButton.addEventListener("click", async () => {
					text.setValue(DEFAULT_SETTINGS.dateFormat);

					this.plugin.settings.dateFormat =
						DEFAULT_SETTINGS.dateFormat;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Allow non-empty file to be treated as new note")
			.setDesc(
				"Newly created file does not have to be empty to add timestamps. Enable if using plugins that automatically add content to new notes (Templater, Daily Notes, etc.).",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.allowNonEmptyNewFile)
					.onChange(async (value) => {
						this.plugin.settings.allowNonEmptyNewFile = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Delay adding timestamps to new notes")
			.setDesc(
				"Delay in milliseconds before adding timestamps to new notes to avoid conflicts with other plugins that also add content to new notes. The default value of 1000 milliseconds should be sufficient for most cases, but you can adjust it as needed. Set to 0 to disable the delay if you are not experiencing any issues or not using such plugins.",
			)
			.addText((text) =>
				text
					.setValue(
						this.plugin.settings.delayAddingTimestamps.toString(),
					)
					.onChange(async (value) => {
						const delay = parseInt(value.trim(), 10);
						if (!isNaN(delay)) {
							this.plugin.settings.delayAddingTimestamps = delay;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Delay modified time update")
			.setDesc(
				"Maximum delay in milliseconds before a modified timestamp is written after you leave a note. When switching tabs, the update runs sooner (up to 250 ms) so background tabs do not block it. The update is always skipped while the note is your active editor.",
			)
			.addText((text) =>
				text
					.setValue(
						this.plugin.settings.delayModifiedUpdate.toString(),
					)
					.onChange(async (value) => {
						const delay = parseInt(value.trim(), 10);
						if (!isNaN(delay)) {
							this.plugin.settings.delayModifiedUpdate = delay;
							await this.plugin.saveSettings();
						}
					}),
			);

		const excludedFoldersSetting = new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc(
				"Manage folders that are excluded from timestamp updates. You can add subfolder paths as needed. For example, 'folder/subfolder' will exclude 'subfolder' but not 'folder'.",
			);

		const listContainer = excludedFoldersSetting.settingEl.createDiv();

		const updateFolderList = () => {
			listContainer.empty();
			this.plugin.settings.excludedFolders.forEach((folder, index) => {
				const folderDiv = listContainer.createDiv("folder-entry");
				folderDiv.style.display = "flex";
				folderDiv.style.alignItems = "center";
				folderDiv.style.justifyContent = "space-between";
				folderDiv.style.marginBottom = "10px";

				const folderNameSpan = folderDiv.createSpan({ text: folder });
				folderNameSpan.style.flex = "1";
				folderNameSpan.style.marginRight = "20px";

				const removeButton = folderDiv.createEl("button", {
					text: "Remove",
				});
				removeButton.onclick = async () => {
					this.plugin.settings.excludedFolders.splice(index, 1);
					await this.plugin.saveSettings();
					updateFolderList();
				};
			});

			const addButtonDiv = listContainer.createDiv();
			addButtonDiv.style.display = "flex";
			addButtonDiv.style.alignItems = "center";

			const addInput = addButtonDiv.createEl("input", {
				type: "text",
				placeholder: "Add new folder path...",
			});
			addInput.style.flex = "1";
			addInput.style.marginRight = "10px";

			addInput.addEventListener("keypress", async (event) => {
				if (event.key === "Enter" && addInput.value.trim().length > 0) {
					const trimmedValue = addInput.value
						.trim()
						.replace(/\/+$/, "");
					this.plugin.settings.excludedFolders.push(trimmedValue);
					await this.plugin.saveSettings();
					addInput.value = "";
					updateFolderList();
					event.preventDefault();
				}
			});

			const addButton = addButtonDiv.createEl("button", { text: "Add" });
			addButton.onclick = async () => {
				if (addInput.value.trim().length > 0) {
					const trimmedValue = addInput.value
						.trim()
						.replace(/\/+$/, "");
					this.plugin.settings.excludedFolders.push(trimmedValue);
					await this.plugin.saveSettings();
					addInput.value = "";
					updateFolderList();
				}
			};
		};

		updateFolderList();

		const commandSetting = new Setting(containerEl)
			.setName("Execute command after update")
			.setDesc(
				"Select a command to run after the modified time is successfully updated",
			);

		const select = commandSetting.controlEl.createEl("select");

		let noneOption = select.createEl("option", { text: "None" });
		noneOption.value = "";
		if (this.plugin.settings.customCommand === "") {
			noneOption.selected = true;
		}

		this.app.commands
			.listCommands()
			.forEach((command: { name: any; id: string }) => {
				let option = select.createEl("option", { text: command.name });
				option.value = command.id;
				if (command.id === this.plugin.settings.customCommand) {
					option.selected = true;
				}
			});

		select.addEventListener("change", async () => {
			this.plugin.settings.customCommand = select.value;
			await this.plugin.saveSettings();
		});

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc("Enable debug mode to display detailed logs")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debug)
					.onChange(async (value) => {
						this.plugin.settings.debug = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
