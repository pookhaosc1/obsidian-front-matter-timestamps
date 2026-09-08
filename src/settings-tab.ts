import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "./settings";
import type FrontMatterTimestampsPlugin from "./main";

export class FrontMatterTimestampsSettingTab extends PluginSettingTab {
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
			.setDesc("Automatically update modified time after editing")
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
				"Idle time in milliseconds after an edit before updating the modified timestamp.",
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
