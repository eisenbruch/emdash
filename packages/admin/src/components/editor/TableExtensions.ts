import { Extension } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { Plugin } from "@tiptap/pm/state";

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
				appendTransaction(transactions, _oldState, newState) {
					const addsTableStructure = transactions.some((transaction) =>
						transaction.steps.some((step) => containsTableStructure(step.toJSON())),
					);
					if (!addsTableStructure) return null;

					const repairs: Array<{
						position: number;
						attributes: Record<string, unknown>;
					}> = [];

					newState.doc.descendants((node, position) => {
						if (node.type.spec.tableRole !== "table") return;

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

						for (const entry of entries) {
							const currentKey =
								typeof entry.node.attrs.emdashKey === "string" &&
								entry.node.attrs.emdashKey.length > 0
									? entry.node.attrs.emdashKey
									: null;
							const duplicate = currentKey !== null && seen.has(currentKey);
							let emdashKey = currentKey;
							if (!emdashKey || duplicate) {
								do {
									emdashKey = createTableKey();
								} while (reserved.has(emdashKey) || seen.has(emdashKey));
							}
							seen.add(emdashKey);
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
