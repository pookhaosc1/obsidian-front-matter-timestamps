import { Plugin, TFile, moment, MarkdownView, TAbstractFile } from "obsidian";
import {
	DEFAULT_SETTINGS,
	FrontMatterTimestampsSettings,
} from "./settings";
import { getFileContent } from "./utils";
import { FrontMatterTimestampsSettingTab } from "./settings-tab";

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

				// ctime is 0 when the filesystem cannot report a creation time
				// (e.g. NTFS mounts on Linux); treat it as unknown
				if (
					file.stat.ctime > 0 &&
					Date.now() - file.stat.ctime > 30000
				) {
					// If the note was actually created a long time ago, skip
					if (this.settings.debug) {
						console.log(
							`Skipping timestamps on ${file.path}; ctime is older than 30s.`,
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
