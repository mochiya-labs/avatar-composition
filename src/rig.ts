import { Bone, Matrix4, Quaternion, Vector3, type Object3D } from "three";
import { AvatarAsset } from "./asset.js";
import { NameResolver, keywordScore } from "./matching.js";
import {
	CompositionError,
	type CompositionWarning,
	type Selector,
} from "./schema.js";

export interface ResolvedOperation {
	componentId: string;
	operation: string;
	sourceNode?: number;
	target?: string;
	status: "resolved" | "skipped";
	query?: Selector;
}
export function bindArmatures(
	base: AvatarAsset,
	asset: AvatarAsset,
	warnings: CompositionWarning[],
	results: ResolvedOperation[],
	undo: (() => void)[],
) {
	const resolver = new NameResolver(base, asset);
	const components =
		asset.manifest?.components.filter(
			(c) => c.type === "mergeArmature" || c.type === "boneProxy",
		) ?? [];
	const roots = new Set(components.map((c) => c.sourceNode));
	const planned = new Map<
		Object3D,
		{ target: Object3D; snap: boolean; id: string }
	>();
	let requested = 0;
	function record(
		source: Object3D,
		target: Object3D | undefined,
		id: string,
		query: Selector,
		snap = false,
	) {
		requested++;
		results.push({
			componentId: id,
			operation: "bone",
			sourceNode: asset.indices.get(source),
			target: target?.name,
			status: target ? "resolved" : "skipped",
			query,
		});
		if (target) {
			if (planned.has(source))
				warnings.push({
					code: "OVERLAPPING_RIG",
					operation: id,
					message: `Multiple instructions address ${source.name}; the later instruction wins.`,
				});
			planned.set(source, { target, snap, id });
		}
	}
	for (const component of components) {
		const source = asset.nodes.get(component.sourceNode);
		if (!source)
			throw new CompositionError(
				"INVALID_RIG_REFERENCE",
				`Missing component root ${component.sourceNode}`,
			);
		if (
			component.type === "mergeArmature" &&
			component.lockMode !== "unidirectional"
		)
			warnings.push({
				code: "UNSUPPORTED_LOCK_MODE",
				operation: component.id,
				message: `MA position lock '${component.lockMode}' is not supported; using unidirectional base-to-attachment following.`,
			});
		if (
			component.type === "boneProxy" &&
			(component.matchScale ||
				component.attachmentMode === "keepPosition" ||
				component.attachmentMode === "keepRotation")
		)
			warnings.push({
				code: "BONE_PROXY_FALLBACK",
				operation: component.id,
				message:
					"Partial-pose/scale matching is unsupported; using Keep World Pose.",
			});
		if (component.target.asset !== "base") {
			warnings.push({
				code: "LOCAL_RIG_UNMERGED",
				operation: component.id,
				message:
					"Local armatures remain separate. Only base-to-attachment following is supported.",
			});
			results.push({
				componentId: component.id,
				operation: "bone",
				sourceNode: component.sourceNode,
				status: "skipped",
				query: component.target,
			});
			continue;
		}
		const rootMatch = resolver.node(component.target, "bone");
		if (rootMatch.warning)
			warnings.push({ ...rootMatch.warning, operation: component.id });
		record(
			source,
			rootMatch.value,
			component.id,
			component.target,
			component.type === "boneProxy" &&
				component.attachmentMode === "atRoot" &&
				!component.matchScale,
		);
		if (component.type !== "mergeArmature") continue;
		const { prefix, suffix } = component;
		const targetRoot = rootMatch.value;
		const pool = [...base.nodes.values()].filter(
			(n) =>
				!base.nodeMeshes(n).length &&
				(!targetRoot || isDescendant(n, targetRoot)),
		);
		function walk(parent: Object3D, matchedParent?: Object3D) {
			for (const child of parent.children) {
				const index = asset.indices.get(child);
				if (index !== undefined && roots.has(index)) continue;
				if (asset.nodeMeshes(child).length) continue;
				const names = (asset.names.get(child) ?? [child.name]).map((name) =>
					name.startsWith(prefix) &&
					name.endsWith(suffix) &&
					name.length > prefix.length + suffix.length
						? name.slice(prefix.length, suffix ? -suffix.length : undefined)
						: name,
				);
				const query: Selector = { asset: "base", boneKeywords: names };
				const rank = (nodes: Object3D[]) =>
					nodes
						.map((node) => ({
							node,
							score: Math.max(
								0,
								...names.flatMap((q) =>
									(base.names.get(node) ?? [node.name]).map((n) =>
										keywordScore(n, q),
									),
								),
							),
						}))
						.filter((x) => x.score > 0)
						.sort((a, b) => b.score - a.score);
				let ranked = rank(
					pool.filter((n) => base.authoredParents.get(n) === matchedParent),
				);
				if (!ranked.length) ranked = rank(pool);
				const target =
					ranked.length &&
					(ranked.length === 1 || ranked[0].score > ranked[1].score)
						? ranked[0].node
						: undefined;
				if (!target)
					warnings.push({
						...resolver.warning(
							query,
							ranked.map((x) => x.node.name),
						),
						operation: component.id,
					});
				if (index !== undefined) record(child, target, component.id, query);
				walk(child, target);
			}
		}
		walk(source, targetRoot);
	}
	// Host-assigned assets without an extension retain the documented name fallback.
	if (!asset.manifest)
		for (const source of asset.bones) {
			const query: Selector = {
				asset: "base",
				boneKeywords: asset.names.get(source) ?? [source.name],
			};
			const match = resolver.node(query, "bone");
			if (match.warning)
				warnings.push({ ...match.warning, operation: "nameFallback" });
			record(source, match.value, "nameFallback", query);
		}
	// Resolve every pair before changing any hierarchy or reference transform.
	const entries = [...planned].map(([source, plan]) => ({
		source,
		...plan,
		rest: base.restAtCurrentRoot(plan.target),
		sourceRest: asset.restAtCurrentRoot(source),
	}));
	let matched = 0;
	for (const { source, target, snap, id, rest, sourceRest } of entries) {
		if (source === asset.scene || Math.abs(rest.determinant()) < 1e-12) {
			warnings.push({
				code: "INVALID_BIND_TRANSFORM",
				operation: id,
				message: `Cannot reparent ${source.name}; its original rig is retained.`,
			});
			const result = [...results]
				.reverse()
				.find(
					(r) =>
						r.componentId === id && r.sourceNode === asset.indices.get(source),
				);
			if (result) result.status = "skipped";
			continue;
		}
		const helper = new Bone();
		helper.name = `${source.name}:mochiya-offset`;
		helper.userData.mochiyaGenerated = true;
		helper.matrixAutoUpdate = false;
		if (snap) {
			const position = new Vector3(),
				rotation = new Quaternion(),
				scale = new Vector3();
			sourceRest.decompose(new Vector3(), new Quaternion(), scale);
			rest.decompose(position, rotation, new Vector3());
			helper.matrix.copy(
				rest
					.invert()
					.multiply(new Matrix4().compose(position, rotation, scale)),
			);
		} else helper.matrix.copy(rest.invert().multiply(sourceRest));
		const parent = source.parent,
			matrix = source.matrix.clone(),
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
		undo.push(() => {
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
		matched++;
	}
	base.scene.updateWorldMatrix(true, true);
	asset.scene.updateWorldMatrix(true, true);
	return { matched, requested };
}
function isDescendant(node: Object3D, root: Object3D) {
	for (let p = node.parent; p; p = p.parent) if (p === root) return true;
	return false;
}
