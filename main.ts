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

export default class MyPlugin extends Plugin {
	settings: CompletedTasksSettings;

	async onload() {
		await this.loadSettings();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	if (evt.target.classList.contains("task-list-item-checkbox")) {
		// 		shouldReorderCheckboxes = true;
		// 	}
		// });

		app.workspace.on("editor-change", (editor: Editor, view: MarkdownView) => {
			shouldReorderCheckboxes = true;
		})

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => {
			if (shouldReorderCheckboxes) {
				const leaf = app.workspace.activeLeaf;
				if (!leaf || !leaf.view || !leaf.view.editor) {
				  new Notice("🔴error: no active editor");
				  return;
				}

				const editor = leaf.view.editor;

				const cursorAnchor = editor.getCursor("anchor");
				const cursorHead = editor.getCursor("head");

				const currentText = editor.getValue();

				let blocks = [];
				let lineCollector = [];

				const lines = currentText.split("\n");

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					const nextLine = (i + 1 < lines.length) ? lines[i + 1] : false;
					const hasCursor = i == cursorHead.line;

					lineCollector.push({
						line,
						hasCursor
					});

					if (nextLine === false || this.lineHasChecklist(line) != this.lineHasChecklist(nextLine)) {
						blocks.push({
							lines: lineCollector,
							hasChecklists: this.lineHasChecklist(line)
						});
						lineCollector = [];
					}
				}

				const sortedLines = blocks
				.map(block => {
					let lines = block.lines;

					if (block.hasChecklists) {
						lines = lines.sort((a, b) => this.lineSortValue(a.line) - this.lineSortValue(b.line));
					}

					return lines;
				})
				.flat();

				const cursorIsAtLine = sortedLines.findIndex(line => line.hasCursor);
				const newText = sortedLines.map(line => line.line).join("\n");

				if (newText != currentText) {
					editor.setValue(newText);
					editor.setSelection({ line: cursorIsAtLine, ch: cursorHead.ch });
				}
			}

			shouldReorderCheckboxes = false;
		},  10 * 1000));
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
		// return (line.startsWith('- [ ]') || line.startsWith('- [x]'));
	}

	sortCheckboxes() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}



class CompletedTasksSettingsTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
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
