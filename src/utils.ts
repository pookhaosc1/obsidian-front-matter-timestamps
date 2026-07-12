import { App, TFile } from "obsidian";

export async function getFileContent(app: App, file: TFile): Promise<string> {
	return app.vault.read(file);
}
