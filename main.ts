import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Remember to rename these classes and interfaces!

interface CompletedTasksSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: CompletedTasksSettings = {
	mySetting: 'default'
}

const checklistLineOrdering = {
	'- [ ]': 0,
	'- [x]': 1,
}

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
			if (evt.target.classList.contains("task-list-item-checkbox")) {
				shouldReorderCheckboxes = true;
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

		},  5 * 1000));
	}

	onunload() {

	}

	lineSortValue(line) {
		for (const [key, value] of Object.entries(checklistLineOrdering)) {
		  if (line.startsWith(key)) {
		  	return value;
		  }
		}
		return 0;
	}

	lineHasChecklist(line) {
		return Object.keys(checklistLineOrdering)
		.filter(key => line.startsWith(key))
		.length;
	}

	reorderCheckboxes() {
		const leaf = app.workspace.activeLeaf;
		if (!leaf || !leaf.view || !leaf.view.editor) {
		  new Notice("🔴 error: no active editor");
		  return;
		}

		const editor = leaf.view.editor;

		const cursorAnchor = editor.getCursor("anchor");
		const cursorHead = editor.getCursor("head");

		const currentText = editor.getValue();

		let blocks = [];
		let lineCollector = [];
		let sublineCollector = [];

		const lines = currentText.split("\n");
		let lastRootChecklistIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const prevLine = (i - 1 >= 0) ? lines[i - 1] : false;
			const nextLine = (i + 1 < lines.length) ? lines[i + 1] : false;

			const hasCursor = i == cursorHead.line;

			const currentLineHasRootOrSubChecklist = this.lineHasChecklist(line.trim());
			const nextLineHasRootOrSubChecklist = nextLine ? this.lineHasChecklist(nextLine.trim()) : nextLine;
			const currentLineHasRootChecklist = this.lineHasChecklist(line);

			// if this line has NO root checklist, but does have a checklist somewhere,
			// we've spotted a sub-item
			if (!currentLineHasRootChecklist && currentLineHasRootOrSubChecklist) {
				if (lastRootChecklistIndex >= 0) {
					lineCollector[lastRootChecklistIndex].sublines.push({
						line,
						hasCursor
					});
				}
			// else this is a normal line, either a root checklist or a non-checklist line
			} else {
				lineCollector.push({
					line,
					sublines: [],
					hasCursor
				});

				// remember if we passed a root checklist, so we can
				// add sublines when we encounter them later
				if (currentLineHasRootChecklist) {
					lastRootChecklistIndex = lineCollector.length - 1;
				}
			}

			// if we encounter the end of the file,
			// or if we encounter a "block change": either a block of (sub)checkboxes or a block of non (sub)checkboxes
			// then we save the previous lines as a new block and start again
			if (
				nextLine === false
				|| (currentLineHasRootOrSubChecklist != nextLineHasRootOrSubChecklist)
			) {
				blocks.push({
					lines: lineCollector,
					hasChecklists: currentLineHasRootChecklist
				});

				lineCollector = [];
				lastRootChecklistIndex = -1;
			}
		}

		// if there are no checklists anywhere, we bail
		if (blocks.filter(block => block.hasChecklists).length == 0) {
			return;
		}

		// sorting the rootlines
		const sortedLines = blocks
		.map(block => {
			let lines = block.lines;

			if (block.hasChecklists) {
				lines = lines.sort((a, b) => this.lineSortValue(a.line) - this.lineSortValue(b.line));
			}

			return lines;
		})
		.flat();

		// now make a new array of root lines and their sublines
		let cursorIsAtLine = cursorHead.line;
		let newLines = [];

		sortedLines.forEach((line, index) => {
			cursorIsAtLine = line.hasCursor ? index : cursorIsAtLine;

			newLines.push(line.line);
			line.sublines.forEach((subline, subindex) => {
				cursorIsAtLine = subline.hasCursor ? index + subindex : cursorIsAtLine;
				newLines.push(subline.line)
			});
		})

		const newText = newLines.join("\n");

		// if something happened...
		if (newText != currentText) {
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
