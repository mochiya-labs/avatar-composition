import { Mesh, Object3D, type Material } from "three";
import { AvatarAsset } from "./asset.js";
import { NameResolver, type Match } from "./matching.js";
import {
	CompositionError,
	menuItems,
	type RemapCurve,
	type Condition,
	type CompositionWarning,
	type Selector,
} from "./schema.js";

import { operations, type Operation as Action } from "./operations.js";
import { ShapeDeletion, type DeleteTarget } from "./deletion.js";
import { bindArmatures, type ResolvedOperation } from "./rig.js";
export type { ResolvedOperation } from "./rig.js";

export interface ItemState {
	id: string;
	visible?: boolean;
	layerOrder?: number;
	controls?: Record<string, number | boolean>;
	nodeVisibility?: Record<number, boolean>;
}
export interface Attachment {
	id: string;
	asset: AvatarAsset;
	status: "attached" | "partial" | "unbound";
	warnings: CompositionWarning[];
	matchedBones: number;
	requestedBones: number;
	appliedActions: number;
	resolved: ResolvedOperation[];
}
type Binding = { key: string; get(): unknown; set(value: unknown): void };
type Compiled = {
	action: Action;
	condition: () => boolean;
	execute: () => void;
	reads: string[];
	writes: string[];
	conditionReads: string[];
	targets: string[];
	morphTargets?: { mesh: Mesh; index: number }[];
	deletions?: DeleteTarget[];
	diagnostic?: ResolvedOperation;
};
type Item = Attachment & {
	state: ItemState;
	resolver: NameResolver;
	actions: Compiled[];
	undo: (() => void)[];
};
const owners = new WeakMap<AvatarAsset, AvatarCompositionSession>();

export function evaluateCurve(
	curve: RemapCurve | undefined,
	value: number,
): number {
	if (!curve) return value;
	const points = curve.points;
	let i = points.findIndex((p) => p[0] > value) - 1;
	if (i < 0) i = value < points[0][0] ? 0 : points.length - 2;
	const a = points[i],
		b = points[i + 1];
	if (curve.interpolation === "step")
		return value >= points.at(-1)![0] ? points.at(-1)![1] : a[1];
	// MA remaps extrapolate their end segments, including weights outside 0..1.
	return a[1] + (b[1] - a[1]) * ((value - a[0]) / (b[0] - a[0]));
}

/** One session owns one live base. Host calls beforeVrmUpdate, updates base, then afterVrmUpdate. */
export class AvatarCompositionSession {
	readonly base: AvatarAsset;
	private readonly items = new Map<string, Item>();
	private readonly layers = new Map<
		string,
		{ binding: Binding; original: unknown; written: unknown }
	>();
	private readonly baseItem: Item;
	private disposed = false;
	private readonly deletion = new ShapeDeletion();
	constructor(options: { base: AvatarAsset }) {
		this.base = options.base;
		if (this.base.manifest?.assetKind === "attachment")
			throw new CompositionError(
				"INVALID_ASSET_KIND",
				"This file declares an attachment. Load an avatar as the base, then add this file as an attachment.",
			);
		if (owners.has(this.base))
			throw new CompositionError(
				"ASSET_ALREADY_ATTACHED",
				"The base is already owned by another composition session",
			);
		this.baseItem = {
			id: "base",
			asset: this.base,
			state: { id: "base" },
			resolver: new NameResolver(this.base, this.base),
			actions: [],
			undo: [],
			status: "attached",
			warnings: [],
			matchedBones: 0,
			requestedBones: 0,
			appliedActions: 0,
			resolved: [],
		};
		this.baseItem.actions = this.compileComponents(this.baseItem);
		this.checkGraph([this.baseItem]);
		owners.set(this.base, this);
		try {
			this.evaluate();
		} catch (error) {
			this.restoreLayers();
			this.deletion.dispose();
			owners.delete(this.base);
			throw error;
		}
	}
	get warnings(): readonly CompositionWarning[] {
		return this.baseItem.warnings;
	}
	get resolved(): readonly ResolvedOperation[] {
		return this.baseItem.resolved;
	}
	get attachments(): readonly Attachment[] {
		return [...this.items.values()];
	}
	attach(asset: AvatarAsset, state: ItemState): Attachment {
		this.requireLive();
		if (asset.manifest?.assetKind === "avatar")
			throw new CompositionError(
				"INVALID_ASSET_KIND",
				"This file declares an avatar. Load it as the base, or export the dependent asset as an attachment.",
			);
		if (!state.id || this.items.has(state.id))
			throw new CompositionError(
				"DUPLICATE_INSTANCE",
				`Duplicate or empty item ID: ${state.id}`,
			);
		if (owners.has(asset))
			throw new CompositionError(
				"ASSET_ALREADY_ATTACHED",
				"Load an independent asset instance before attaching it again",
			);
		this.restoreLayers();
		const item: Item = {
			id: state.id,
			asset,
			state: this.state(state),
			resolver: new NameResolver(this.base, asset),
			actions: [],
			undo: [],
			status: "attached",
			warnings: [],
			matchedBones: 0,
			requestedBones: 0,
			appliedActions: 0,
			resolved: [],
		};
		try {
			item.actions = this.compileComponents(item);
			this.checkGraph([this.baseItem, ...this.items.values(), item]);
			for (const other of this.items.values())
				for (const action of item.actions)
					if (
						other.actions.some(
							(previous) =>
								previous.action.type === action.action.type &&
								previous.writes.some((key) => action.writes.includes(key)),
						)
					)
						item.warnings.push({
							code: "OVERLAPPING_WRITERS",
							operation: action.action.id,
							message: `This action overlaps ${other.id}; layer order and instance ID determine the final value.`,
						});
			this.bindRig(item);
			item.status =
				item.requestedBones > 0 && item.matchedBones === 0
					? "unbound"
					: item.warnings.length
						? "partial"
						: "attached";
			item.appliedActions = item.actions.length;
			this.items.set(item.id, item);
			owners.set(asset, this);
			this.evaluate();
			return item;
		} catch (error) {
			this.restoreLayers();
			this.items.delete(item.id);
			owners.delete(asset);
			for (const undo of item.undo.reverse()) undo();
			this.evaluate();
			throw error;
		}
	}
	setItemState(id: string, patch: Partial<Omit<ItemState, "id">>): void {
		this.requireLive();
		const item = this.items.get(id);
		if (!item)
			throw new CompositionError("MISSING_INSTANCE", `Unknown item ${id}`);
		this.restoreLayers();
		const wasVisible = item.state.visible !== false;
		item.state = this.state({
			...item.state,
			...patch,
			controls: { ...item.state.controls, ...patch.controls },
			nodeVisibility: { ...item.state.nodeVisibility, ...patch.nodeVisibility },
		});
		if (!wasVisible && item.state.visible !== false)
			item.asset.vrm?.springBoneManager?.reset();
		this.evaluate();
	}
	setBaseControl(id: string, value: number | boolean): void {
		this.requireLive();
		this.restoreLayers();
		this.baseItem.state = this.state({
			...this.baseItem.state,
			controls: { ...this.baseItem.state.controls, [id]: value },
		});
		this.evaluate();
	}
	/** Use for explicit edits so removing an attachment never overwrites newer user values. */
	setBaseMorph(selector: Omit<Selector, "asset">, value: number): void {
		this.requireLive();
		if (!Number.isFinite(value)) throw new Error("Morph value must be finite");
		this.restoreLayers();
		const match = new NameResolver(this.base, this.base).morph({
			...selector,
			asset: "base",
		});
		for (const { mesh, index } of match.value ?? [])
			mesh.morphTargetInfluences![index] = value;
		this.evaluate();
	}
	beforeVrmUpdate(): void {
		this.requireLive();
		this.restoreLayers();
		this.evaluate("visibility");
	}
	afterVrmUpdate(delta: number): void {
		this.requireLive();
		for (const item of this.items.values()) {
			if (item.state.visible === false) continue;
			const vrm = item.asset.vrm;
			vrm?.expressionManager?.update();
			vrm?.nodeConstraintManager?.update();
			// Refresh spring sorting after attachment through public manager APIs (see bindRig).
			vrm?.springBoneManager?.update(delta);
		}
		this.evaluate("properties");
	}
	detach(id: string): void {
		const item = this.items.get(id);
		if (!item) return;
		this.restoreLayers();
		this.items.delete(id);
		owners.delete(item.asset);
		for (const undo of item.undo.reverse()) undo();
		item.asset.scene.updateWorldMatrix(true, true);
		this.refreshSprings(item.asset);
		this.evaluate();
	}
	dispose(): void {
		if (this.disposed) return;
		for (const id of [...this.items.keys()]) this.detach(id);
		this.restoreLayers();
		this.deletion.dispose();
		owners.delete(this.base);
		this.disposed = true;
	}
	private requireLive() {
		if (this.disposed) throw new Error("Composition session is disposed");
	}
	private state(state: ItemState): ItemState {
		if (!Number.isFinite(state.layerOrder ?? 0))
			throw new Error("Layer order must be finite");
		for (const value of Object.values(state.controls ?? {}))
			if (typeof value !== "boolean" && !Number.isFinite(value))
				throw new Error("Control value must be finite");
		return {
			...state,
			controls: { ...state.controls },
			nodeVisibility: { ...state.nodeVisibility },
		};
	}
	private orderedItems() {
		return [
			this.baseItem,
			...[...this.items.values()].sort(
				(a, b) =>
					(a.state.layerOrder ?? 0) - (b.state.layerOrder ?? 0) ||
					(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
			),
		];
	}
	private take<T>(
		item: Item,
		match: Match<T>,
		operation: string,
	): T | undefined {
		if (match.warning) item.warnings.push({ ...match.warning, operation });
		return match.value;
	}
	private bindRig(item: Item): void {
		const counts = bindArmatures(
			this.base,
			item.asset,
			item.warnings,
			item.resolved,
			item.undo,
		);
		item.matchedBones = counts.matched;
		item.requestedBones = counts.requested;
		this.refreshSprings(item.asset);
	}
	private compileComponents(item: Item): Compiled[] {
		return (item.asset.manifest?.components ?? []).flatMap(
			(component, order) => {
				if (!item.asset.nodes.has(component.sourceNode))
					throw new CompositionError(
						"INVALID_LOCAL_REFERENCE",
						`Missing component source ${component.sourceNode}`,
					);
				if (
					item === this.baseItem &&
					(component.type === "mergeArmature" || component.type === "boneProxy")
				) {
					item.warnings.push({
						code: "LOCAL_RIG_UNMERGED",
						operation: component.id,
						message:
							"Avatar armatures remain separate; base-to-attachment following is applied only when attaching an asset.",
					});
					const diagnostic: ResolvedOperation = {
						componentId: component.id,
						operation: "bone",
						sourceNode: component.sourceNode,
						status: "skipped",
						query: component.target,
					};
					item.resolved.push(diagnostic);
				}
				if (
					component.type === "menuItem" &&
					!component.automatic &&
					component.parameter
				)
					item.warnings.push({
						code: "MENU_PARAMETER_ONLY",
						operation: component.id,
						message:
							"Named menu parameter is available locally; arbitrary Animator parameter effects are not executed.",
					});
				return operations(component, order).flatMap((action) => {
					const compiled = this.compile(item, action);
					const diagnostic: ResolvedOperation = {
						componentId: component.id,
						operation: action.id,
						status: compiled ? "resolved" : "skipped",
						target: compiled?.targets.join(", "),
						query: action.type === "morph.sync" ? action.driven : action.target,
					};
					item.resolved.push(diagnostic);
					if (compiled) compiled.diagnostic = diagnostic;
					return compiled ?? [];
				});
			},
		);
	}
	private refreshSprings(asset: AvatarAsset) {
		const manager = asset.vrm?.springBoneManager;
		if (!manager) return;
		const joints = [...manager.joints];
		joints.forEach((j) => manager.deleteJoint(j));
		joints.forEach((j) => manager.addJoint(j));
		manager.setInitState();
	}
	private logicalActive(
		item: Item,
		node: Object3D,
		asset: AvatarAsset,
	): boolean {
		if (asset === item.asset && item.state.visible === false) return false;
		for (
			let current: Object3D | null = node;
			current && asset.authoredActive.has(current);
			current = asset.authoredParents.get(current) ?? null
		)
			if (!current.visible) return false;
		return true;
	}
	private condition(
		item: Item,
		condition?: Condition,
	): (() => boolean) | undefined {
		if (!condition) return () => true;
		if (condition.type === "control") {
			const controls = menuItems(item.asset.manifest).filter(
				(c) => (c.parameter ?? c.id) === condition.control,
			);
			const control =
				controls.find((c) => Number(c.defaultValue) !== 0) ?? controls[0];
			if (!control)
				throw new CompositionError(
					"INVALID_CONTROL",
					`Unknown control ${condition.control}`,
				);
			return () => {
				const value =
					item.state.controls?.[control.parameter ?? control.id] ??
					control.defaultValue;
				const result =
					condition.value === undefined
						? Boolean(value)
						: Number(value) === Number(condition.value);
				return condition.inverse ? !result : result;
			};
		}
		const selector: Selector = {
			asset: condition.asset ?? "self",
			node: condition.node,
			nodeKeywords: condition.nodeKeywords,
			path: condition.path,
		};
		const node = this.take(item, item.resolver.node(selector), "condition");
		if (!node) return undefined;
		const asset = item.resolver.asset(selector);
		const menus = menuItems(item.asset.manifest);
		let menu: (typeof menus)[number] | undefined;
		if (asset === item.asset) {
			for (
				let current: Object3D | undefined = node;
				current;
				current = asset.authoredParents.get(current) ?? undefined
			) {
				menu = menus.find((c) => asset.nodes.get(c.sourceNode) === current);
				if (menu) break;
			}
		}
		return () => {
			let active = this.logicalActive(item, node, asset);
			if (menu) {
				const key = menu.parameter ?? menu.id;
				const defaultValue =
					menus.find(
						(c) =>
							(c.parameter ?? c.id) === key && Number(c.defaultValue) !== 0,
					)?.defaultValue ?? menu.defaultValue;
				active &&=
					Number(item.state.controls?.[key] ?? defaultValue) === menu.value;
			}
			return condition.inverse ? !active : active;
		};
	}
	private morphBinding(mesh: Mesh, index: number): Binding {
		return {
			key: `${mesh.uuid}:morph:${index}`,
			get: () => mesh.morphTargetInfluences![index],
			set: (v) => {
				mesh.morphTargetInfluences![index] = Number(v);
			},
		};
	}
	private visibleBinding(node: Object3D): Binding {
		return {
			key: `${node.uuid}:active`,
			get: () => node.visible,
			set: (v) => {
				node.visible = Boolean(v);
			},
		};
	}
	private compile(item: Item, action: Action): Compiled | undefined {
		const condition = this.condition(item, action.condition);
		if (!condition) return;
		const result: Compiled = {
			action,
			condition,
			execute: () => {},
			reads: [],
			writes: [],
			conditionReads: [],
			targets: [],
		};
		if (action.condition?.type === "nodeActive") {
			const selector: Selector = {
				asset: action.condition.asset ?? "self",
				node: action.condition.node,
				nodeKeywords: action.condition.nodeKeywords,
				path: action.condition.path,
			};
			const asset = item.resolver.asset(selector);
			for (
				let node = item.resolver.node(selector).value;
				node;
				node = asset.authoredParents.get(node) ?? undefined
			) {
				if (!asset.authoredActive.has(node)) break;
				result.conditionReads.push(this.visibleBinding(node).key);
			}
		}
		if (
			action.type === "morph.sync" ||
			action.type === "morph.override" ||
			action.type === "geometry.delete"
		) {
			const targets = this.take(
				item,
				item.resolver.morph(
					action.type === "morph.sync" ? action.driven : action.target,
				),
				action.id,
			);
			if (!targets) return;
			const bindings = targets.map((t) => this.morphBinding(t.mesh, t.index));
			result.morphTargets = targets;
			result.targets = targets.map(
				({ mesh, index }) =>
					`${mesh.name}:${Object.keys(mesh.morphTargetDictionary ?? {}).find((name) => mesh.morphTargetDictionary![name] === index) ?? index}`,
			);
			result.writes = bindings.map((b) => b.key);
			if (action.type === "geometry.delete") {
				result.writes = bindings.map((b) => `${b.key}:delete`);
				result.deletions = targets.map(({ mesh, index }, i) => {
					const reasons = new Set<string>();
					return {
						mesh,
						index,
						threshold: action.threshold,
						diagnostic: {
							active: false,
							selectedVertices: 0,
							removedTriangles: 0,
						},
						fallback: (reason: string) => {
							if (!reasons.has(reason)) {
								reasons.add(reason);
								item.warnings.push({
									code: "SHAPE_DELETE_FALLBACK",
									operation: action.id,
									query: action.target,
									message: `${mesh.name}: ${reason} Delete uses reversible blendshape weight 0.`,
								});
								if (item.status === "attached") item.status = "partial";
							}
							this.write(bindings[i], 0);
						},
					};
				});
			} else if (action.type === "morph.override")
				result.execute = () =>
					bindings.forEach((b) => this.write(b, action.value));
			else {
				const source = this.take(
					item,
					item.resolver.morph(action.driver),
					action.id,
				);
				if (!source) return;
				const driver = this.morphBinding(source[0].mesh, source[0].index);
				result.reads = source.map(
					(t) => this.morphBinding(t.mesh, t.index).key,
				);
				result.execute = () =>
					bindings.forEach((b) =>
						this.write(b, evaluateCurve(action.curve, Number(driver.get()))),
					);
			}
		} else if (action.type === "node.active") {
			const target = this.take(
				item,
				item.resolver.node(action.target),
				action.id,
			);
			if (!target) return;
			const binding = this.visibleBinding(target);
			result.targets = [target.name];
			result.writes = [binding.key];
			result.execute = () => this.write(binding, action.value);
		} else if (action.type === "material.swap") {
			const target = this.take(
				item,
				item.resolver.node(action.target, "mesh"),
				action.id,
			);
			if (!target) return;
			const material = item.asset.materials[action.material];
			if (!material)
				throw new CompositionError(
					"INVALID_MATERIAL",
					`Missing local material ${action.material}`,
				);
			const targetAsset = item.resolver.asset(action.target);
			const meshes = targetAsset.nodeMeshes(target);
			const valid = meshes.filter((mesh, index) =>
				targetAsset.primitiveSlots.has(mesh)
					? targetAsset.primitiveSlots.get(mesh) === action.slot
					: !(target as Mesh).isMesh
						? index === action.slot
						: action.slot <
							(Array.isArray(mesh.material) ? mesh.material.length : 1),
			);
			if (!valid.length) {
				item.warnings.push({
					code: "MISSING_SLOT",
					operation: action.id,
					message: `Material slot ${action.slot} is unavailable.`,
				});
				return;
			}
			result.targets = valid.map(
				(mesh) => `${mesh.name}:material[${action.slot}]`,
			);
			result.writes = valid.map(
				(mesh) =>
					`${mesh.uuid}:material:${targetAsset.primitiveSlots.has(mesh) || !(target as Mesh).isMesh ? "primitive" : action.slot}`,
			);
			result.execute = () =>
				valid.forEach((mesh) => {
					const wholePrimitive =
						targetAsset.primitiveSlots.has(mesh) || !(target as Mesh).isMesh;
					const slot =
						targetAsset.primitiveSlots.has(mesh) || !(target as Mesh).isMesh
							? 0
							: action.slot;
					const binding: Binding = {
						key: `${mesh.uuid}:material:${wholePrimitive ? "primitive" : slot}`,
						get: () =>
							!wholePrimitive && Array.isArray(mesh.material)
								? mesh.material[slot]
								: mesh.material,
						set: (value) => {
							if (wholePrimitive)
								mesh.material = value as Material | Material[];
							else if (Array.isArray(mesh.material)) {
								mesh.material = [...mesh.material];
								mesh.material[slot] = value as Material;
							} else mesh.material = value as Material;
						},
					};
					this.write(binding, material);
				});
		}
		return result;
	}
	private checkGraph(items: Item[]): void {
		const actions = items.flatMap((i) => i.actions);
		// MA's initial sync profile disallows chains, including cross-attachment chains.
		const syncs = actions.filter((a) => a.action.type === "morph.sync");
		for (const a of syncs)
			for (const b of syncs)
				if (a.writes.some((k) => b.reads.includes(k)))
					throw new CompositionError(
						"SYNC_CHAIN",
						"Chained or cyclic morph synchronization is unsupported",
					);
		const visibility = actions.filter((a) => a.action.type === "node.active");
		const visiting = new Set<Compiled>(),
			done = new Set<Compiled>();
		const visit = (action: Compiled) => {
			if (visiting.has(action))
				throw new CompositionError(
					"VISIBILITY_CYCLE",
					"Cyclic visibility conditions are unsupported",
				);
			if (done.has(action)) return;
			visiting.add(action);
			for (const dependency of visibility)
				if (
					dependency.writes.some((key) => action.conditionReads.includes(key))
				)
					visit(dependency);
			visiting.delete(action);
			done.add(action);
		};
		visibility.forEach(visit);
	}
	private write(binding: Binding, value: unknown) {
		const layer = this.layers.get(binding.key) ?? {
			binding,
			original: binding.get(),
			written: undefined,
		};
		if (binding.get() !== value) binding.set(value);
		layer.written = value;
		this.layers.set(binding.key, layer);
	}
	private restoreLayers() {
		for (const { binding, original, written } of this.layers.values())
			if (binding.get() === written) binding.set(original);
		this.layers.clear();
	}
	private evaluate(phase: "all" | "visibility" | "properties" = "all") {
		const items = this.orderedItems();
		if (phase !== "properties") {
			for (const item of items) {
				if (item !== this.baseItem)
					this.write(
						this.visibleBinding(item.asset.scene),
						item.state.visible !== false,
					);
				for (const [index, active] of Object.entries(
					item.state.nodeVisibility ?? {},
				)) {
					const node = item.asset.nodes.get(Number(index));
					if (node) this.write(this.visibleBinding(node), active);
				}
			}
			const pending = items.flatMap((item) =>
				[...item.actions]
					.sort((a, b) => a.action.sourceOrder - b.action.sourceOrder)
					.filter((a) => a.action.type === "node.active")
					.map((compiled) => ({ item, compiled })),
			);
			const done = new Set<Compiled>();
			const execute = (entry: (typeof pending)[number]) => {
				if (done.has(entry.compiled)) return;
				for (const dependency of pending)
					if (
						dependency.compiled.writes.some((key) =>
							entry.compiled.conditionReads.includes(key),
						)
					)
						execute(dependency);
				done.add(entry.compiled);
				if (entry.item.state.visible !== false && entry.compiled.condition())
					entry.compiled.execute();
			};
			pending.forEach(execute);
			// Reparented meshes still obey their original logical ancestor chain.
			for (const item of items)
				for (const mesh of item.asset.meshes)
					if (!this.logicalActive(item, mesh, item.asset))
						this.write(this.visibleBinding(mesh), false);
			// Apply material changes before rendering.
			for (const type of ["material.swap"])
				for (const item of items)
					for (const compiled of [...item.actions].sort(
						(a, b) => a.action.sourceOrder - b.action.sourceOrder,
					))
						if (
							compiled.action.type === type &&
							item.state.visible !== false &&
							compiled.condition()
						)
							compiled.execute();
		}
		if (phase !== "visibility") {
			const key = (r: { mesh: Mesh; index: number }) =>
				`${r.mesh.uuid}/${r.index}`;
			const registered = items.flatMap((item) =>
				item.actions.flatMap((a) => a.deletions ?? []),
			);
			const thresholds = new Map<string, number>();
			for (const r of registered)
				thresholds.set(
					key(r),
					Math.min(thresholds.get(key(r)) ?? Infinity, r.threshold),
				);
			const active = new Map<string, DeleteTarget>();
			for (const item of items) {
				if (item.state.visible === false) continue;
				for (const compiled of [...item.actions].sort(
					(a, b) => a.action.sourceOrder - b.action.sourceOrder,
				)) {
					if (!compiled.condition()) continue;
					if (compiled.action.type === "morph.override") {
						compiled.execute();
						for (const r of compiled.morphTargets ?? []) active.delete(key(r));
					} else if (compiled.action.type === "geometry.delete") {
						for (const r of compiled.deletions ?? [])
							active.set(key(r), { ...r, threshold: thresholds.get(key(r))! });
					}
				}
			}
			this.deletion.apply([...active.values()], registered);
			for (const item of items)
				for (const compiled of item.actions) {
					if (!compiled.deletions || !compiled.diagnostic) continue;
					const stats = compiled.deletions.map((r) => r.diagnostic);
					compiled.diagnostic.deletion = {
						active: stats.some((s) => s.active),
						selectedVertices: stats.reduce((n, s) => n + s.selectedVertices, 0),
						removedTriangles: stats.reduce((n, s) => n + s.removedTriangles, 0),
						fallback:
							stats
								.map((s) => s.fallback)
								.filter(Boolean)
								.join("; ") || undefined,
					};
				}
			for (const type of ["morph.sync"])
				for (const item of items) {
					if (item.state.visible === false) continue;
					for (const compiled of [...item.actions].sort(
						(a, b) => a.action.sourceOrder - b.action.sourceOrder,
					))
						if (compiled.action.type === type && compiled.condition())
							compiled.execute();
				}
		}
	}
}
