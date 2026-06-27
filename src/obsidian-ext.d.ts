import "obsidian";

declare module "obsidian" {
	interface App {
		commands: {
			executeCommandById(customCommand: string): unknown;
			listCommands(): { id: string; name: string }[];
		};
	}
}
