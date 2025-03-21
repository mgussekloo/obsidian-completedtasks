import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Remember to rename these classes and interfaces!

interface CompletedTasksSettings {
	mySetting: string;
}

interface OCTLine {
	line: string,
	sublines: OCTLine[],
	hasCursor: boolean
}

interface OCTBlock {
	lines: OCTLine[],
	hasChecklists: boolean
}

const DEFAULT_SETTINGS: CompletedTasksSettings = {
	mySetting: 'default'
}

const checklistLineOrdering = {
	'- [ ]': 0,
	'- [/]': 1,
	'- [x]': 2,
	'- [-]': 3,
	'- [>]': 3,
	'- [<]': 3,
}

const checklistLineOrderingEntries = Object.entries(checklistLineOrdering);
const checklistLineOrderingKeys = Object.keys(checklistLineOrdering);

let shouldReorderCheckboxes = false;

export default class CompletedTasksPlugin extends Plugin {
	settings: CompletedTasksSettings;

	async onload() {
		await this.loadSettings();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'reorder-completed-tasks',
			name: 'Reorder completed tasks',
			callback: () => {
				this.reorderCheckboxes();
			}
		});

		// reorder if user clicks a checkbox
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			if (evt && evt.target) {
				const target = evt.target as HTMLSpanElement;
				if (target.classList.contains("task-list-item-checkbox")) {
					shouldReorderCheckboxes = true;
				}
			}
		});

		// reorder if content in editor changes
		this.registerEvent(this.app.workspace.on('editor-change', (editor, info) => {
			shouldReorderCheckboxes = true;
		}))

		// periodically check if we need to reorder
		this.registerInterval(window.setInterval(() => {
			if (shouldReorderCheckboxes) {
				shouldReorderCheckboxes = false;

				this.reorderCheckboxes();
			}

		},  10 * 1000));
	}

	onunload() {

	}

	lineSortValue(line: string) {
		for (const [key, value] of checklistLineOrderingEntries) {
			if (line.startsWith(key)) {
				return value;
			}
		}
		return 0;
	}

	lineHasChecklist(line: string) {
		return checklistLineOrderingKeys.some(key => line.startsWith(key));
	}

	reorderCheckboxes() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		const editor = activeView.editor as Editor;

		// Store cursor position before modifications
		const cursorAnchor = editor.getCursor("anchor");
		const cursorHead = editor.getCursor("head");

		const currentText = editor.getValue();

		let blocks: OCTBlock[] = []; // Stores different text blocks
		let lineCollector: OCTLine[] = []; // Stores lines within a block
		let lastRootChecklistIndex = -1; // Index of last root checklist

		const lines = currentText.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const prevLine: any = i > 0 ? lines[i - 1] : false;
			const nextLine: any = i + 1 < lines.length ? lines[i + 1] : false;
			const hasCursor: boolean = i === cursorHead.line;

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
						hasCursor
					});
				}
			} else {
				// Store root checklist or non-checklist lines
				lineCollector.push({
					line,
					sublines: [],
					hasCursor
				});

				if (isRootChecklist) {
					lastRootChecklistIndex = lineCollector.length - 1;
				}
			}

			// If this is the last line or we detect a change in block type, store the block
			if (!nextLine || currentLineHasChecklist !== nextLineHasChecklist) {
				blocks.push({
					lines: lineCollector,
					hasChecklists: lastRootChecklistIndex >= 0
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

		console.log(blocks);

		// Sort checklist blocks while keeping non-checklist blocks unchanged
		const sortedLines = blocks
			.map(block => {
				if (block.hasChecklists) {
					return block.lines.sort((a, b) => this.lineSortValue(a.line) - this.lineSortValue(b.line))
				}
				return block.lines;
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
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
