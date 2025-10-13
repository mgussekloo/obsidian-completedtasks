import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Remember to rename these classes and interfaces!

interface CompletedTasksSettings {
	ignoreSubstrings: string[],
	sortedStatuses: string[],
	sortedSubstrings: string[],
	intervalSeconds: number,
}

interface OCTLine {
	line: string,
	sublines: OCTLine[],
	hasCursor: boolean,
	statusSortval: number,
	subSortval: number,
}

interface OCTBlock {
	lines: OCTLine[],
	hasChecklists: boolean,
	ignoreBlock: boolean
}

interface IndexableObj { [key: string]: any; }

// ---

const DEFAULT_SETTINGS: CompletedTasksSettings = {
	ignoreSubstrings: [
		'#donotsort'
	],
	sortedStatuses: [
		'- [/]',
		'- [ ]',
		'- [x]',
		'- [-]',
		'- [>]',
		'- [<]',
	],
	sortedSubstrings: [
		'🔺',
		'⏫',
		'🔽',
		'⏬',
	],
	intervalSeconds: 5
}

// ---

let shouldReorderCheckboxes = false;

export default class CompletedTasksPlugin extends Plugin {
	settings: CompletedTasksSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CompletedTasksSettingsTab(this.app, this));

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'reorder-completed-tasks',
			name: 'Reorder completed tasks',
			callback: () => {
				this.reorderCheckboxes();
			}
		});

		// reorder if content in editor changes
		this.registerEvent(this.app.vault.on('modify', (file) => {
			shouldReorderCheckboxes = true;
		}))

		// periodically check if we need to reorder
		this.registerInterval(window.setInterval(() => {
			if (shouldReorderCheckboxes) {
				shouldReorderCheckboxes = false;

				const activeLeaf = this.app.workspace.activeLeaf;
				if (activeLeaf) {
					const view = activeLeaf.getViewState()

					if (view && view.state && view.state.mode == 'preview') {
						activeLeaf.setViewState({
							...view,
							state: {
								mode: 'source',
								source: false
							}
						})
					}

					this.reorderCheckboxes();

					if (view && view.state && view.state.mode == 'preview') {
						window.setTimeout(() => {
							activeLeaf.setViewState(view)
						}, 10);
					}
				}
			}
		}, this.settings.intervalSeconds * 1000));

	}

	onunload() {

	}

	findSortval(line: string, arr: string[], _anywhere: boolean = false) {
		for (const [key, value] of arr.entries()) {

			if (_anywhere && line.indexOf(value) >= 0) {
				return key;
			}

			if (line.startsWith(value)) {
				return key;
			}
		}
		return 0;
	}

	lineHasChecklist(line: string) {
		return this.settings.sortedStatuses.some(value => line.startsWith(value));
	}

	reorderCheckboxes() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		const editor = activeView.editor as Editor;

		// Store cursor position before modifications
		const cursorAnchor = editor.getCursor("anchor");
		const cursorHead = editor.getCursor("head");
		const currentText = editor.getValue();

		// prepare vars
		let blocks: OCTBlock[] = []; // Stores different text blocks
		let lineCollector: OCTLine[] = []; // Stores lines within a block
		let lastRootChecklistIndex = -1; // Index of last root checklist

		let ignoreBlock = false;
		let ignoreNextBlock = false;

		const lines = currentText.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const prevLine: any = i > 0 ? lines[i - 1] : false;
			const nextLine: any = i + 1 < lines.length ? lines[i + 1] : false;
			const hasCursor: boolean = i === cursorHead.line;

			if (!ignoreNextBlock && this.settings.ignoreSubstrings.some(key => line.indexOf(key) >= 0)) {
				ignoreNextBlock = true;
			}

			// Determine if the current and next lines contain checklists
			const currentLineHasChecklist = this.lineHasChecklist(line.trim());
			const nextLineHasChecklist = nextLine ? this.lineHasChecklist(nextLine.trim()) : false;
			const isRootChecklist = this.lineHasChecklist(line);

			if (!isRootChecklist && currentLineHasChecklist) {
				// Line is a sub-checklist item, attach it to the last root checklist
				if (lastRootChecklistIndex >= 0) {
					lineCollector[lastRootChecklistIndex].sublines.push({
						line,
						sublines: [],
						hasCursor,
						statusSortval: 0,
						subSortval: 0
					});
				}
			} else {
				// Store root checklist or non-checklist lines
				lineCollector.push({
					line,
					sublines: [],
					hasCursor,
					statusSortval: 0,
					subSortval: 0

				});

				if (isRootChecklist) {
					lastRootChecklistIndex = lineCollector.length - 1;
				}
			}

			// If this is the last line or we detect a change in block type, store the block
			if (!nextLine || currentLineHasChecklist !== nextLineHasChecklist) {
				let hasChecklists = lastRootChecklistIndex >= 0;

				if (hasChecklists) {
					ignoreBlock = ignoreNextBlock
					ignoreNextBlock = false;
				}

				blocks.push({
					lines: lineCollector,
					hasChecklists,
					ignoreBlock
				});

				// Reset for the next block
				lineCollector = [];
				lastRootChecklistIndex = -1;
			}
		}

		// If no checklists were found, exit
		if (!blocks.some(block => block.hasChecklists)) {
			return
		};

		// Sort checklist blocks while keeping non-checklist blocks unchanged
		const sortedLines = blocks
		.map(block => {
			if (block.ignoreBlock || !block.hasChecklists) {
				return block.lines;
			}

			return block.lines
			.map((line: OCTLine) => {
				line.statusSortval = this.findSortval(line.line, this.settings.sortedStatuses);
				line.subSortval = this.findSortval(line.line, this.settings.sortedStatuses, true);
				return line;
			})
			.sort((a: OCTLine, b: OCTLine) => {
				if (a.statusSortval != b.statusSortval) {
					return a.statusSortval > b.statusSortval ? 1 : -1;
				}
				if (a.subSortval != b.subSortval) {
					return a.subSortval > b.subSortval ? 1 : -1;
				}
				return 0;
			})
		})
		.flat();

		let cursorIsAtLine = cursorHead.line;
		let newLines: string[] = [];

		// Reconstruct text while maintaining cursor position
		sortedLines.forEach((line, index) => {
			if (line.hasCursor) cursorIsAtLine = index;
			newLines.push(line.line);

			line.sublines.forEach((subline, subindex) => {
				if (subline.hasCursor) cursorIsAtLine = index + subindex;
				newLines.push(subline.line);
			});
		});

		const newText = newLines.join("\n");

		// Update text if changes were made
		if (newText !== currentText) {
			editor.setValue(newText);
			editor.setSelection({ line: cursorIsAtLine, ch: cursorHead.ch });
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class CompletedTasksSettingsTab extends PluginSettingTab {
	plugin: CompletedTasksPlugin;

	constructor(app: App, plugin: CompletedTasksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
		.setName('Sorting')
		.setDesc('Comma separated. Task statuses, from high to low.')
		.addTextArea(text => text
			.setValue(this.plugin.settings.sortedStatuses.join(','))
			.onChange(async (value) => {
				this.plugin.settings.sortedStatuses = value.split(',').map(item => item && item.trim());
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('Subsorting')
			.setDesc('Comma separated. Strings for sub-sorting, from high to low.')
			.addTextArea(text => text
				.setValue(this.plugin.settings.sortedSubstrings.join(','))
				.onChange(async (value) => {
					this.plugin.settings.sortedSubstrings = value.split(',').map(item => item && item.trim());
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Blacklist words')
			.setDesc('Comma separated. Add any of these above a list to have this plugin ignore it.')
			.addTextArea(text => text
				.setValue(this.plugin.settings.ignoreSubstrings.join(','))
				.onChange(async (value) => {
					this.plugin.settings.ignoreSubstrings = value.split(',').map(item => item && item.trim());
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Interval')
			.setDesc('Interval at which the plugin runs, in seconds.')
			.addText(text => text
				.setValue('' + this.plugin.settings.intervalSeconds)
				.onChange(async (value) => {
					this.plugin.settings.intervalSeconds = Math.max(0, Math.min(999, parseInt(value) ));
					await this.plugin.saveSettings();
				}));
	}
}
