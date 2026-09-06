import { Bone, Matrix4, Mesh, Object3D, type Material } from "three";
import { AvatarAsset } from "./asset.js";
import { NameResolver, type Match } from "./matching.js";
import {
	CompositionError,
	type Action,
	type Condition,
	type CompositionWarning,
	type Selector,
} from "./schema.js";

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
}
type Binding = { key: string; get(): unknown; set(value: unknown): void };
type Compiled = {
	action: Action;
	condition: () => boolean;
	execute: () => void;
	reads: string[];
	writes: string[];
	conditionReads: string[];
};
type Item = Attachment & {
	state: ItemState;
	resolver: NameResolver;
	actions: Compiled[];
	undo: (() => void)[];
};
const owners = new WeakMap<AvatarAsset, AvatarCompositionSession>();

export function evaluateCurve(
	curve: Extract<Action, { type: "morph.sync" }>["curve"],
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
		};
		this.baseItem.actions = (this.base.manifest?.actions ?? []).flatMap(
			(action) => this.compile(this.baseItem, action) ?? [],
		);
		this.checkGraph([this.baseItem]);
		owners.set(this.base, this);
		try {
			this.evaluate();
		} catch (error) {
			this.restoreLayers();
			owners.delete(this.base);
			throw error;
		}
	}
	get warnings(): readonly CompositionWarning[] {
		return this.baseItem.warnings;
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
		};
		try {
			for (const action of asset.manifest?.actions ?? []) {
				const compiled = this.compile(item, action);
				if (compiled) item.actions.push(compiled);
			}
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
		const asset = item.asset;
		const explicit = asset.manifest?.rig?.jointMappings ?? [];
		const roots = asset.manifest?.rig?.attachmentRoots ?? [];
		const mappings = explicit.length
			? explicit
			: asset.bones
					.map((bone) => ({
						sourceNode: asset.indices.get(bone)!,
						target: {
							asset: "base" as const,
							boneKeywords: asset.names.get(bone) ?? [bone.name],
						},
					}))
					.filter(
						(x) =>
							x.sourceNode !== undefined &&
							!roots.some((root) => root.sourceNode === x.sourceNode),
					);
		const used = new Set<Object3D>();
		for (const entry of [
			...mappings.map((m) => ({ ...m, mode: "preserveWorld" as const })),
			...roots,
		]) {
			item.requestedBones++;
			const source = asset.nodes.get(entry.sourceNode);
			if (!source || used.has(source))
				throw new CompositionError(
					"INVALID_RIG_REFERENCE",
					`Missing or repeated rig source ${entry.sourceNode}`,
				);
			used.add(source);
			const target = this.take(
				item,
				item.resolver.node(entry.target, "bone"),
				`bone:${entry.sourceNode}`,
			);
			if (!target) continue;
			if (entry.target.asset !== "base")
				throw new CompositionError(
					"INVALID_RIG_TARGET",
					"Attachment targets must address the base",
				);
			const rest = this.base.restAtCurrentRoot(target);
			if (Math.abs(rest.determinant()) < 1e-12) {
				item.warnings.push({
					code: "SINGULAR_BIND",
					message: `Cannot bind ${source.name}; its reference bone is retained.`,
				});
				continue;
			}
			const helper = new Bone();
			helper.name = `${source.name}:mochiya-offset`;
			helper.userData.mochiyaGenerated = true;
			helper.matrixAutoUpdate = false;
			helper.matrix.copy(
				entry.mode === "snap"
					? new Matrix4()
					: rest.invert().multiply(asset.restAtCurrentRoot(source)),
			);
			const parent = source.parent;
			const matrix = source.matrix.clone(),
				position = source.position.clone(),
				quaternion = source.quaternion.clone(),
				scale = source.scale.clone(),
				automatic = source.matrixAutoUpdate;
			const sibling = parent?.children.indexOf(source) ?? -1;
			target.add(helper);
			helper.add(source);
			source.position.set(0, 0, 0);
			source.quaternion.identity();
			source.scale.set(1, 1, 1);
			source.matrix.identity();
			source.matrixAutoUpdate = true;
			item.undo.push(() => {
				source.removeFromParent();
				if (parent) {
					parent.add(source);
					if (sibling >= 0) {
						parent.children.splice(parent.children.indexOf(source), 1);
						parent.children.splice(sibling, 0, source);
					}
				}
				source.position.copy(position);
				source.quaternion.copy(quaternion);
				source.scale.copy(scale);
				source.matrix.copy(matrix);
				source.matrixAutoUpdate = automatic;
				helper.removeFromParent();
			});
			item.matchedBones++;
		}
		this.base.scene.updateWorldMatrix(true, true);
		asset.scene.updateWorldMatrix(true, true);
		this.refreshSprings(asset);
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
			const control = item.asset.manifest?.controls.find(
				(c) => c.id === condition.control,
			);
			if (!control)
				throw new CompositionError(
					"INVALID_CONTROL",
					`Unknown control ${condition.control}`,
				);
			return () => {
				const value = item.state.controls?.[control.id] ?? control.defaultValue;
				const result =
					condition.value === undefined
						? Boolean(value)
						: value === condition.value;
				return condition.inverse ? !result : result;
			};
		}
		const selector: Selector = {
			asset: condition.asset ?? "self",
			node: condition.node,
			nodeKeywords: condition.nodeKeywords,
		};
		const node = this.take(item, item.resolver.node(selector), "condition");
		if (!node) return undefined;
		return () =>
			condition.inverse
				? !this.logicalActive(item, node, item.resolver.asset(selector))
				: this.logicalActive(item, node, item.resolver.asset(selector));
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
		};
		if (action.condition?.type === "nodeActive") {
			const selector: Selector = {
				asset: action.condition.asset ?? "self",
				node: action.condition.node,
				nodeKeywords: action.condition.nodeKeywords,
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
		if (action.type === "morph.sync" || action.type === "morph.override") {
			const targets = this.take(
				item,
				item.resolver.morph(
					action.type === "morph.sync" ? action.driven : action.target,
				),
				action.id,
			);
			if (!targets) return;
			const bindings = targets.map((t) => this.morphBinding(t.mesh, t.index));
			result.writes = bindings.map((b) => b.key);
			if (action.type === "morph.override")
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
		} else if (action.type === "collider.link") {
			const target = this.take(
				item,
				item.resolver.node(action.target, "bone"),
				action.id,
			);
			const colliderNode = this.take(
				item,
				item.resolver.node(action.collider),
				action.id,
			);
			if (!target || !colliderNode) return;
			const manager = item.resolver.asset(action.target).vrm?.springBoneManager;
			const colliders =
				item.resolver
					.asset(action.collider)
					.vrm?.springBoneManager?.colliders.filter(
						(c) => c === colliderNode || c.parent === colliderNode,
					) ?? [];
			const joints = [...(manager?.joints ?? [])].filter(
				(j) => j.bone === target,
			);
			if (!colliders.length || !joints.length) {
				item.warnings.push({
					code: "MISSING_PHYSICS_TARGET",
					operation: action.id,
					message: "No collider or spring joint found; this link was skipped.",
				});
				return;
			}
			const group = { colliders };
			result.execute = () =>
				joints.forEach((j) =>
					this.write(
						{
							key: `${j.bone.uuid}:colliders`,
							get: () => j.colliderGroups,
							set: (value) => {
								j.colliderGroups = value as typeof j.colliderGroups;
							},
						},
						[...j.colliderGroups, group],
					),
				);
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
			// Collider links must exist before either physics manager runs. Material changes are batched before rendering.
			for (const type of ["material.swap", "collider.link"])
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
			for (const type of ["morph.override", "morph.sync"])
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
