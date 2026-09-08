import { App, MarkdownView, TFile } from "obsidian";

// The editor buffer and the bytes on disk can disagree without the file
// having been modified: CodeMirror normalizes line endings to "\n" and the
// trailing newline may differ between the two. Canonicalize both sources so
// comparing contents read through different paths never reports a change
// for a byte-identical file (see issue #17).
function normalizeForComparison(content: string): string {
	return content.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

// Returns the file content in a canonical form suitable only for change
// detection, preferring the (possibly unsaved) editor buffer over disk.
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
