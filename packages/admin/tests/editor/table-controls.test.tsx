import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
	getTableControlState,
	runTableAction,
	type TableActionId,
} from "../../src/components/editor/TableActions";
import { insertTable, TableSizePicker } from "../../src/components/editor/TableControls";
import {
	EmDashTable,
	EmDashTableCell,
	EmDashTableHeader,
	EmDashTableRow,
	TableIdentity,
} from "../../src/components/editor/TableExtensions";
import { render } from "../utils/render.tsx";

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];

function tableContent(rows = 2, columns = 2): JSONContent {
	return {
		type: "doc",
		content: [
			{
				type: "table",
				attrs: { emdashKey: "table" },
				content: Array.from({ length: rows }, (_rowValue, row) => ({
					type: "tableRow",
					attrs: { emdashKey: `row-${row}` },
					content: Array.from({ length: columns }, (_columnValue, column) => ({
						type: "tableCell",
						attrs: {
							emdashKey: `cell-${row}-${column}`,
							emdashData: row === 0 && column === 0 ? { future: "anchor" } : null,
							colwidth: [128 + column * 32],
							textAlign: "left",
						},
						content: [
							{
								type: "paragraph",
								content: [{ type: "text", text: String.fromCharCode(65 + row * columns + column) }],
							},
						],
					})),
				})),
			},
		],
	};
}

function createEditor(content = tableContent()) {
	const host = document.createElement("div");
	document.body.append(host);
	hosts.push(host);
	const editor = new Editor({
		element: host,
		extensions: [
			StarterKit,
			EmDashTable.configure({ resizable: false }),
			EmDashTableRow,
			EmDashTableHeader,
			EmDashTableCell,
			TableIdentity,
		],
		content,
	});
	editors.push(editor);
	return editor;
}

function cellPositions(editor: Editor) {
	const positions: number[] = [];
	editor.state.doc.descendants((node, position) => {
		if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
			positions.push(position);
		}
	});
	return positions;
}

function selectCells(editor: Editor, anchor: number, head = anchor) {
	const positions = cellPositions(editor);
	editor.view.dispatch(
		editor.state.tr.setSelection(
			CellSelection.create(editor.state.doc, positions[anchor]!, positions[head]!),
		),
	);
}

function dimensions(editor: Editor) {
	const table = editor.state.doc.firstChild!;
	const map = TableMap.get(table);
	return [map.height, map.width];
}

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
	for (const host of hosts.splice(0)) host.remove();
});

describe("table controls", () => {
	it("navigates and confirms the fine-pointer size grid", async () => {
		const onInsert = vi.fn();
		const screen = await render(<TableSizePicker onInsert={onInsert} onCancel={vi.fn()} />);
		const grid = screen.getByRole("grid", { name: "Table size" });
		await expect.element(grid).toBeVisible();
		await expect.element(grid).toHaveAttribute("aria-multiselectable", "true");
		await vi.waitFor(() =>
			expect(screen.getByRole("gridcell", { name: "1 × 1 table" }).element()).toHaveFocus(),
		);

		await userEvent.keyboard("{ArrowRight}{ArrowDown}{End}");
		await vi.waitFor(() =>
			expect(screen.getByRole("gridcell", { name: "2 × 10 table" }).element()).toHaveFocus(),
		);
		await userEvent.keyboard("{Enter}");
		expect(onInsert).toHaveBeenCalledWith(2, 10, true);
	});

	it("inverts horizontal grid movement in RTL and supports Control+End", async () => {
		const onInsert = vi.fn();
		const screen = await render(
			<div dir="rtl">
				<TableSizePicker onInsert={onInsert} onCancel={vi.fn()} />
			</div>,
		);
		await vi.waitFor(() =>
			expect(screen.getByRole("gridcell", { name: "1 × 1 table" }).element()).toHaveFocus(),
		);

		await userEvent.keyboard("{ArrowLeft}{Control>}{End}{/Control}{ }");

		expect(onInsert).toHaveBeenCalledWith(10, 10, true);
	});

	it("uses the shared header-row choice for pointer insertion", async () => {
		const onInsert = vi.fn();
		const screen = await render(<TableSizePicker onInsert={onInsert} onCancel={vi.fn()} />);
		const header = screen.getByRole("switch", { name: "Header row" });
		await expect.element(header).toBeChecked();
		header.element().click();
		screen.getByRole("gridcell", { name: "2 × 2 table" }).element().click();

		expect(onInsert).toHaveBeenCalledWith(2, 2, false);
	});

	it("keeps hover preview separate from keyboard focus and exposes real grid rows", async () => {
		const screen = await render(<TableSizePicker onInsert={vi.fn()} onCancel={vi.fn()} />);
		const first = screen.getByRole("gridcell", { name: "1 × 1 table" }).element();
		const hovered = screen.getByRole("gridcell", { name: "3 × 4 table" }).element();
		expect(screen.getByRole("row").all()).toHaveLength(10);

		await userEvent.hover(hovered);
		expect(first).toHaveFocus();
		expect(first.tabIndex).toBe(0);
		expect(hovered.tabIndex).toBe(-1);
		await userEvent.keyboard("{ArrowRight}");
		await vi.waitFor(() =>
			expect(screen.getByRole("gridcell", { name: "1 × 2 table" }).element()).toHaveFocus(),
		);
	});

	it("keeps the header choice before confirmation in the coarse keyboard flow", async () => {
		const original = window.matchMedia;
		window.matchMedia = vi.fn((query: string) => ({
			matches: query === "(any-pointer: coarse)",
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})) as typeof window.matchMedia;
		try {
			const screen = await render(<TableSizePicker onInsert={vi.fn()} onCancel={vi.fn()} />);
			const rows = screen.getByRole("combobox", { name: "Rows" }).element();
			const header = screen.getByRole("switch", { name: "Header row" }).element();
			const insert = screen.getByRole("button", { name: "Insert table" }).element();
			await vi.waitFor(() => expect(rows).toHaveFocus());
			expect(
				header.compareDocumentPosition(insert) & Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
			header.focus();
			await userEvent.keyboard(" ");
			expect(header).not.toBeChecked();
		} finally {
			window.matchMedia = original;
		}
	});

	it("inserts beside a top-level container instead of nesting an unsupported table", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "blockquote",
					content: [{ type: "paragraph", content: [{ type: "text", text: "Quote" }] }],
				},
			],
		});
		editor.commands.setTextSelection(3);
		const before = editor.getJSON();
		expect(insertTable(editor, 2, 2, true)).toBe(true);
		expect(editor.state.doc.content.content.map((node) => node.type.name)).toEqual([
			"blockquote",
			"table",
			"paragraph",
		]);
		expect(editor.commands.undo()).toBe(true);
		expect(editor.getJSON()).toEqual(before);
	});

	it.each([
		["select-row", [1, 3]],
		["select-column", [3, 1]],
		["select-table", [3, 3]],
	] as Array<[TableActionId, number[]]>)(
		"%s selects the expected rectangle",
		(action, expected) => {
			const editor = createEditor(tableContent(3, 3));
			selectCells(editor, 4);
			const before = editor.getJSON();

			expect(runTableAction(editor, action)).toBe(true);
			expect(getTableControlState(editor)).toMatchObject({
				rows: expected[0],
				columns: expected[1],
			});
			expect(editor.getJSON()).toEqual(before);
			expect(runTableAction(editor, action)).toBe(false);
		},
	);

	it("recognizes a reverse row selection as already selected", () => {
		const editor = createEditor(tableContent(3, 3));
		const cells = cellPositions(editor);
		editor.view.dispatch(
			editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[2]!, cells[0]!)),
		);
		expect(getTableControlState(editor)?.can["select-row"]).toBe(false);
		expect(runTableAction(editor, "select-row")).toBe(false);
	});

	it.each([
		["add-row-before", [3, 2]],
		["add-row-after", [3, 2]],
		["add-column-before", [2, 3]],
		["add-column-after", [2, 3]],
		["delete-row", [1, 2]],
		["delete-column", [2, 1]],
	] as Array<[TableActionId, number[]]>)(
		"%s changes geometry in one undo step",
		(action, expected) => {
			const editor = createEditor();
			selectCells(editor, 0);
			const before = editor.getJSON();

			expect(runTableAction(editor, action)).toBe(true);
			expect(dimensions(editor)).toEqual(expected);
			expect(editor.commands.undo()).toBe(true);
			expect(editor.getJSON()).toEqual(before);
			expect(editor.commands.redo()).toBe(true);
			expect(dimensions(editor)).toEqual(expected);
		},
	);

	it.each([
		["delete-row", 0, 5, [1, 3]],
		["delete-column", 0, 7, [3, 1]],
	] as Array<[TableActionId, number, number, number[]]>)(
		"%s removes a rectangular multi-selection in one history step",
		(action, anchor, head, expected) => {
			const editor = createEditor(tableContent(3, 3));
			selectCells(editor, anchor, head);
			const before = editor.getJSON();
			expect(runTableAction(editor, action)).toBe(true);
			expect(dimensions(editor)).toEqual(expected);
			expect(editor.commands.undo()).toBe(true);
			expect(editor.getJSON()).toEqual(before);
		},
	);

	it("normalizes a whole-table node selection for structural commands", () => {
		const editor = createEditor();
		editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
		expect(getTableControlState(editor)?.can["delete-table"]).toBe(true);
		expect(runTableAction(editor, "delete-table")).toBe(true);
		expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
		expect(editor.commands.undo()).toBe(true);
		expect(editor.state.doc.firstChild?.type.name).toBe("table");
	});

	it("toggles the first header row and column", () => {
		const editor = createEditor();
		selectCells(editor, 3);

		expect(runTableAction(editor, "header-row")).toBe(true);
		expect(runTableAction(editor, "header-column")).toBe(true);
		const table = editor.state.doc.firstChild!;
		expect(table.firstChild?.child(0).type.spec.tableRole).toBe("header_cell");
		expect(table.firstChild?.child(1).type.spec.tableRole).toBe("header_cell");
		expect(table.lastChild?.child(0).type.spec.tableRole).toBe("header_cell");
	});

	it("reports row and column header states independently at their intersection", () => {
		const editor = createEditor();
		selectCells(editor, 3);
		expect(runTableAction(editor, "header-row")).toBe(true);
		expect(getTableControlState(editor)).toMatchObject({
			headerRow: true,
			headerColumn: false,
		});
		expect(runTableAction(editor, "header-column")).toBe(true);
		expect(getTableControlState(editor)).toMatchObject({
			headerRow: true,
			headerColumn: true,
		});
		expect(runTableAction(editor, "header-row")).toBe(true);
		expect(getTableControlState(editor)).toMatchObject({
			headerRow: false,
			headerColumn: true,
		});
	});

	it("uses row precedence for a 1 × 1 header and disables unrepresentable axes", () => {
		const editor = createEditor(tableContent(1, 1));
		selectCells(editor, 0);
		expect(runTableAction(editor, "header-row")).toBe(true);
		expect(getTableControlState(editor)).toMatchObject({
			headerRow: true,
			headerColumn: false,
			can: { "header-row": true, "header-column": false },
		});
		expect(runTableAction(editor, "header-row")).toBe(true);
		expect(editor.state.doc.firstChild?.firstChild?.firstChild?.type.spec.tableRole).toBe("cell");
	});

	it.each([
		["header-row", { colspan: 1, rowspan: 2, colwidth: [128] }],
		["header-column", { colspan: 2, rowspan: 1, colwidth: [128, 160] }],
	] as const)("disables %s when a spanning edge makes the scope ambiguous", (action, attrs) => {
		const value = tableContent(2, 2);
		value.content![0]!.content![0]!.content![0]!.attrs = {
			...value.content![0]!.content![0]!.content![0]!.attrs,
			...attrs,
		};
		const editor = createEditor(value);
		selectCells(editor, 0);
		expect(getTableControlState(editor)?.can[action]).toBe(false);
	});

	it.each([
		["header-column", "header-row", 2],
		["header-row", "header-column", 1],
	] as const)("keeps %s intersection spans blocking %s", (enabledAxis, blockedAxis, head) => {
		const editor = createEditor();
		selectCells(editor, 0, head);
		expect(runTableAction(editor, "merge")).toBe(true);
		expect(runTableAction(editor, enabledAxis)).toBe(true);
		expect(getTableControlState(editor)?.can[blockedAxis]).toBe(false);
	});

	it("merges content and splits with stable anchor metadata and fresh identities", () => {
		const value = tableContent(1, 2);
		value.content![0]!.content![0]!.content![1]!.attrs!.emdashData = {};
		const editor = createEditor(value);
		selectCells(editor, 0, 1);
		const before = editor.getJSON();

		expect(runTableAction(editor, "merge")).toBe(true);
		let row = editor.state.doc.firstChild!.firstChild!;
		expect(row.childCount).toBe(1);
		expect(row.firstChild?.attrs).toMatchObject({
			colspan: 2,
			emdashKey: "cell-0-0",
			emdashData: { future: "anchor" },
		});
		expect(row.firstChild?.firstChild?.content.content.map((node) => node.type.name)).toEqual([
			"text",
			"hardBreak",
			"text",
		]);
		expect(editor.commands.undo()).toBe(true);
		expect(editor.getJSON()).toEqual(before);
		expect(editor.commands.redo()).toBe(true);
		editor.commands.setTextSelection(cellPositions(editor)[0]! + 2);
		expect(editor.state.selection).not.toBeInstanceOf(CellSelection);

		expect(runTableAction(editor, "split")).toBe(true);
		row = editor.state.doc.firstChild!.firstChild!;
		expect(row.childCount).toBe(2);
		expect(row.child(0).attrs.emdashKey).toBe("cell-0-0");
		expect(row.child(0).attrs.emdashData).toEqual({ future: "anchor" });
		expect(row.child(1).attrs.emdashKey).not.toBe("cell-0-0");
		expect(row.child(1).attrs.emdashData).toBeNull();
		expect(editor.commands.undo()).toBe(true);
		expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(1);
	});

	it("preserves automatic and sub-minimum width preferences when merging", () => {
		const value = tableContent(1, 2);
		const cells = value.content![0]!.content![0]!.content!;
		cells[0]!.attrs = { ...cells[0]!.attrs, colwidth: [1] };
		cells[1]!.attrs = { ...cells[1]!.attrs, colwidth: null };
		const editor = createEditor(value);
		selectCells(editor, 0, 1);

		expect(runTableAction(editor, "merge")).toBe(true);
		expect(editor.state.doc.firstChild?.firstChild?.firstChild?.attrs.colwidth).toEqual([1, 0]);
	});

	it("changes, distributes, and resets column widths", () => {
		const editor = createEditor();
		selectCells(editor, 0);

		expect(runTableAction(editor, "increase-width")).toBe(true);
		expect(editor.state.doc.firstChild?.firstChild?.child(0).attrs.colwidth).toEqual([144]);
		expect(runTableAction(editor, "decrease-width")).toBe(true);
		expect(editor.state.doc.firstChild?.firstChild?.child(0).attrs.colwidth).toEqual([128]);
		expect(runTableAction(editor, "distribute-widths")).toBe(true);
		const distributed = editor.state.doc.firstChild!.firstChild!;
		expect(distributed.child(0).attrs.colwidth).toEqual(distributed.child(1).attrs.colwidth);
		expect(getTableControlState(editor)?.can["distribute-widths"]).toBe(false);
		expect(runTableAction(editor, "reset-widths")).toBe(true);
		expect(editor.state.doc.firstChild?.firstChild?.child(0).attrs.colwidth).toBeNull();
	});

	it("distributes from the rendered table width and clamps the portable value", () => {
		const editor = createEditor();
		selectCells(editor, 0);
		const table = editor.view.dom.querySelector("table")!;
		table.getBoundingClientRect = () => ({ width: 10_000 }) as DOMRect;
		expect(runTableAction(editor, "distribute-widths")).toBe(true);
		expect(editor.state.doc.firstChild?.firstChild?.child(0).attrs.colwidth).toEqual([4096]);
		expect(getTableControlState(editor)?.can["distribute-widths"]).toBe(false);
	});

	it("detects later-row widths that still need distribution", () => {
		const value = tableContent();
		const rows = value.content![0]!.content!;
		for (const cell of rows[0]!.content!) cell.attrs!.colwidth = [256];
		rows[1]!.content![0]!.attrs!.colwidth = [128];
		rows[1]!.content![1]!.attrs!.colwidth = [160];
		const editor = createEditor(value);
		selectCells(editor, 0);
		editor.view.dom.querySelector("table")!.getBoundingClientRect = () =>
			({ width: 512 }) as DOMRect;
		expect(getTableControlState(editor)?.can["distribute-widths"]).toBe(true);
		expect(runTableAction(editor, "distribute-widths")).toBe(true);
		expect(
			editor.state.doc.firstChild!.content.content.flatMap((row) =>
				row.content.content.map((cell) => cell.attrs.colwidth),
			),
		).toEqual([[256], [256], [256], [256]]);

		const subminimum = tableContent(1, 2);
		subminimum.content![0]!.content![0]!.content![0]!.attrs!.colwidth = [1];
		subminimum.content![0]!.content![0]!.content![1]!.attrs!.colwidth = [2];
		const compact = createEditor(subminimum);
		selectCells(compact, 0);
		compact.view.dom.querySelector("table")!.getBoundingClientRect = () =>
			({ width: 192 }) as DOMRect;
		expect(getTableControlState(compact)?.can["distribute-widths"]).toBe(true);
	});

	it("reuses adjacent empty paragraphs and deletes the table", () => {
		const editor = createEditor();
		selectCells(editor, 0);
		expect(runTableAction(editor, "paragraph-after")).toBe(true);
		expect(editor.state.doc.childCount).toBe(2);
		selectCells(editor, 0);
		expect(runTableAction(editor, "paragraph-after")).toBe(true);
		expect(editor.state.doc.childCount).toBe(2);
		selectCells(editor, 0);
		expect(runTableAction(editor, "delete-table")).toBe(true);
		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
	});
});
