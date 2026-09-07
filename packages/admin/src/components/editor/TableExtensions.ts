import { Extension } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import type { ResolvedPos } from "@tiptap/pm/model";
import { Plugin, type EditorState } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

const TABLE_NODE_ROLES = new Set(["table", "row", "cell", "header_cell"]);
const TABLE_ALIGNMENTS = new Set(["left", "center", "right", "justify"]);

function hiddenAttribute(defaultValue: unknown = null) {
	return {
		default: defaultValue,
		parseHTML: () => null,
		rendered: false,
	};
}

function tableAttributes(parent: Record<string, unknown>) {
	return {
		...parent,
		emdashKey: hiddenAttribute(),
		emdashData: hiddenAttribute(),
	};
}

function cellAttributes(parent: Record<string, unknown>) {
	return {
		...tableAttributes(parent),
		textAlign: {
			default: null,
			parseHTML: (element: HTMLElement) => {
				const value = element.style.textAlign;
				return TABLE_ALIGNMENTS.has(value) ? value : null;
			},
			renderHTML: (attributes: Record<string, unknown>) => {
				const value = attributes.textAlign;
				return typeof value === "string" && TABLE_ALIGNMENTS.has(value)
					? { style: `text-align: ${value}` }
					: {};
			},
		},
	};
}

function createTableKey(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	return uuid ? uuid.replaceAll("-", "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
}

function containsTableStructure(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsTableStructure);
	if (typeof value !== "object" || value === null) return false;
	const type = "type" in value ? value.type : undefined;
	if (
		typeof type === "string" &&
		["table", "tableRow", "tableCell", "tableHeader"].includes(type)
	) {
		return true;
	}
	return Object.values(value).some(containsTableStructure);
}

export function selectionTouchesTable(state: EditorState): boolean {
	const { selection } = state;
	for (const position of [selection.$from, selection.$to]) {
		for (let depth = position.depth; depth > 0; depth--) {
			if (position.node(depth).type.spec.tableRole === "table") return true;
		}
	}
	let found = false;
	state.doc.nodesBetween(selection.from, selection.to, (node) => {
		if (node.type.spec.tableRole === "table") found = true;
		return !found;
	});
	return found;
}

function tableCellPosition(position: ResolvedPos): number | null {
	for (let depth = position.depth; depth > 0; depth--) {
		const role = position.node(depth).type.spec.tableRole;
		if (role === "cell" || role === "header_cell") return position.before(depth);
	}
	return null;
}

export function selectionIsContainedInTableCells(state: EditorState): boolean {
	if (state.selection instanceof CellSelection) return true;
	const from = tableCellPosition(state.selection.$from);
	return from !== null && from === tableCellPosition(state.selection.$to);
}

export const EmDashTable = Table.extend({
	addAttributes() {
		return tableAttributes(this.parent?.() ?? {});
	},
});

export const EmDashTableRow = TableRow.extend({
	addAttributes() {
		return tableAttributes(this.parent?.() ?? {});
	},
});

export const EmDashTableCell = TableCell.extend({
	content: "paragraph+",
	addAttributes() {
		return cellAttributes(this.parent?.() ?? {});
	},
});

export const EmDashTableHeader = TableHeader.extend({
	content: "paragraph+",
	addAttributes() {
		return cellAttributes(this.parent?.() ?? {});
	},
});

export const TableIdentity = Extension.create({
	name: "tableIdentity",

	addProseMirrorPlugins() {
		return [
			new Plugin({
				appendTransaction(transactions, oldState, newState) {
					const addsTableStructure = transactions.some((transaction) =>
						transaction.steps.some((step) => containsTableStructure(step.toJSON())),
					);
					if (!addsTableStructure) return null;
					const survivingPositions = new Map<string, Set<number>>();
					oldState.doc.descendants((node, position) => {
						const key = node.attrs.emdashKey;
						if (
							typeof node.type.spec.tableRole !== "string" ||
							!TABLE_NODE_ROLES.has(node.type.spec.tableRole) ||
							typeof key !== "string" ||
							key.length === 0
						) {
							return;
						}
						let mapped = position;
						for (const transaction of transactions) {
							const result = transaction.mapping.mapResult(mapped, 1);
							if (result.deleted) return false;
							mapped = result.pos;
						}
						const surviving = newState.doc.nodeAt(mapped);
						if (
							surviving?.type.spec.tableRole === node.type.spec.tableRole &&
							surviving.attrs.emdashKey === key
						) {
							const positions = survivingPositions.get(key) ?? new Set<number>();
							positions.add(mapped);
							survivingPositions.set(key, positions);
						}
						return;
					});
					const topLevelSurvivorKeys = new Set<string>();
					for (const [key, positions] of survivingPositions) {
						for (const position of positions) {
							if (
								newState.doc.resolve(position).depth === 0 &&
								newState.doc.nodeAt(position)?.type.spec.tableRole === "table"
							) {
								topLevelSurvivorKeys.add(key);
								break;
							}
						}
					}
					const seenTopLevelTableKeys = new Set<string>();

					const repairs: Array<{
						position: number;
						attributes: Record<string, unknown>;
					}> = [];

					newState.doc.descendants((node, position) => {
						if (node.type.spec.tableRole !== "table") return;
						const isTopLevelTable = newState.doc.resolve(position).depth === 0;

						const entries = [{ node, position }];
						node.descendants((descendant, relativePosition) => {
							const role = descendant.type.spec.tableRole;
							if (typeof role === "string" && TABLE_NODE_ROLES.has(role)) {
								entries.push({
									node: descendant,
									position: position + relativePosition + 1,
								});
							}
						});
						const reserved = new Set(
							entries
								.map((entry) => entry.node.attrs.emdashKey)
								.filter((key): key is string => typeof key === "string" && key.length > 0),
						);
						const seen = new Set<string>();
						const survivingKeys = new Set<string>();
						for (const entry of entries) {
							const key = entry.node.attrs.emdashKey;
							if (typeof key === "string" && survivingPositions.get(key)?.has(entry.position)) {
								survivingKeys.add(key);
							}
						}

						for (const entry of entries) {
							const currentKey =
								typeof entry.node.attrs.emdashKey === "string" &&
								entry.node.attrs.emdashKey.length > 0
									? entry.node.attrs.emdashKey
									: null;
							const duplicate =
								currentKey !== null &&
								(seen.has(currentKey) ||
									(survivingKeys.has(currentKey) &&
										!survivingPositions.get(currentKey)?.has(entry.position)) ||
									(isTopLevelTable &&
										entry.position === position &&
										(seenTopLevelTableKeys.has(currentKey) ||
											(topLevelSurvivorKeys.has(currentKey) &&
												!survivingPositions.get(currentKey)?.has(entry.position)))));
							let emdashKey = currentKey;
							const isTopLevelEntry = isTopLevelTable && entry.position === position;
							if (!emdashKey || duplicate) {
								for (;;) {
									emdashKey = createTableKey();
									if (
										!reserved.has(emdashKey) &&
										!seen.has(emdashKey) &&
										(!isTopLevelEntry ||
											(!seenTopLevelTableKeys.has(emdashKey) &&
												!topLevelSurvivorKeys.has(emdashKey)))
									) {
										break;
									}
								}
							}
							seen.add(emdashKey);
							if (isTopLevelEntry) {
								seenTopLevelTableKeys.add(emdashKey);
							}
							if (!currentKey || duplicate) {
								repairs.push({
									position: entry.position,
									attributes: { ...entry.node.attrs, emdashKey },
								});
							}
						}
						return false;
					});

					if (repairs.length === 0) return null;

					const transaction = newState.tr;
					for (const repair of repairs) {
						transaction.setNodeMarkup(repair.position, undefined, repair.attributes);
					}
					return transaction.setMeta("addToHistory", false);
				},
			}),
		];
	},
});
