import {
	App,
	getFrontMatterInfo,
	MarkdownView,
	parseYaml,
	TFile,
} from "obsidian";

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
