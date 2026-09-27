import {
	App,
	Editor,
	editorInfoField,
	getFrontMatterInfo,
	MarkdownView,
	parseYaml,
	stringifyYaml,
	TFile,
} from "obsidian";
import { EditorState, Transaction } from "@codemirror/state";

const timestampEditors = new WeakSet<Editor>();

export const timestampHistoryExtension = EditorState.transactionExtender.of(
	(transaction) => {
		const editor = transaction.startState.field(
			editorInfoField,
			false,
		)?.editor;
		return editor && timestampEditors.has(editor)
			? { annotations: Transaction.addToHistory.of(false) }
			: null;
	},
);

export async function processFrontMatter(
	app: App,
	file: TFile,
	update: (frontmatter: Record<string, unknown>) => void,
): Promise<void> {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (
			view instanceof MarkdownView &&
			view.file?.path === file.path &&
			view.getMode() === "source"
		) {
			const editor = view.editor;
			const content = editor.getValue();
			const info = getFrontMatterInfo(content);
			const frontmatter = info.exists
				? (parseYaml(info.frontmatter) ?? {})
				: {};
			if (typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
				throw new Error("Frontmatter must be a YAML mapping.");
			}
			update(frontmatter);
			const replacement = `---\n${stringifyYaml(frontmatter)}---\n`;
			const end = info.exists ? info.contentStart : 0;
			if (content.slice(0, end) === replacement) return;

			// Keep metadata out of undo history
			timestampEditors.add(editor);
			try {
				editor.replaceRange(
					replacement,
					{ line: 0, ch: 0 },
					editor.offsetToPos(end),
				);
			} finally {
				timestampEditors.delete(editor);
			}
			await view.save();
			return;
		}
	}
	await app.fileManager.processFrontMatter(file, update);
}

function normalizeForComparison(content: string): string {
	return content.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

export function getComparableContent(
	content: string,
	modifiedProperty: string,
): string {
	content = normalizeForComparison(content);
	const info = getFrontMatterInfo(content);
	try {
		const frontmatter = info.exists
			? (parseYaml(info.frontmatter) ?? {})
			: {};
		if (typeof frontmatter !== "object" || Array.isArray(frontmatter))
			return content;
		delete frontmatter[modifiedProperty];
		return (
			JSON.stringify(frontmatter) +
			"\n" +
			content.slice(info.contentStart)
		);
	} catch {
		return content;
	}
}

export async function getFileContent(
	app: App,
	file: TFile,
	modifiedProperty?: string,
): Promise<string> {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) {
			await view.save();
			break;
		}
	}
	const content = await app.vault.read(file);
	return modifiedProperty === undefined
		? normalizeForComparison(content)
		: getComparableContent(content, modifiedProperty);
}
