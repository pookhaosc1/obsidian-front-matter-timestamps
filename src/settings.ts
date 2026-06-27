export interface FrontMatterTimestampsSettings {
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

export const DEFAULT_SETTINGS: FrontMatterTimestampsSettings = {
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
