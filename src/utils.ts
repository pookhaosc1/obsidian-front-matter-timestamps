import { App, MarkdownView, TFile } from "obsidian";

function normalizeForComparison(content: string): string {
	return content.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

export async function getFileContent(app: App, file: TFile): Promise<string> {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) {
			await view.save();
			break;
		}
	}
	const content = await app.vault.read(file);
	return normalizeForComparison(content);
}
