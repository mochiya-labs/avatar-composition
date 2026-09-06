import { type Bone, type Mesh, type Object3D } from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { AvatarAsset } from "./asset.js";
import {
	CompositionError,
	type CompositionWarning,
	type Selector,
} from "./schema.js";

export function tokens(value: string): string[] {
	return value
		.normalize("NFKC")
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}
function anatomicalSide(value: string): string | undefined {
	const t = tokens(value);
	return t.some((x) => x === "left" || x === "l")
		? "left"
		: t.some((x) => x === "right" || x === "r")
			? "right"
			: undefined;
}
export function keywordScore(name: string, query: string): number {
	if (name === query) return 100;
	const a = tokens(name),
		b = tokens(query),
		na = a.join(""),
		nb = b.join("");
	if (!nb) return 0;
	const left = anatomicalSide(name),
		right = anatomicalSide(query);
	if (left && right && left !== right) return 0;
	if (na === nb) return 90;
	if (b.every((t) => a.includes(t))) return 70;
	return nb.length >= 3 && na.includes(nb) ? 50 : 0;
}
export interface Match<T> {
	value?: T;
	warning?: CompositionWarning;
}
export class NameResolver {
	constructor(
		readonly base: AvatarAsset,
		readonly self: AvatarAsset,
	) {}
	asset(selector: Selector): AvatarAsset {
		return selector.asset === "base" ? this.base : this.self;
	}
	node(
		selector: Selector,
		kind: "bone" | "mesh" | "node" = "node",
	): Match<Object3D> {
		const asset = this.asset(selector);
		if (selector.asset === "self") {
			const node = asset.nodes.get(selector.node!);
			if (!node)
				throw new CompositionError(
					"INVALID_LOCAL_REFERENCE",
					`Local node ${selector.node} does not exist`,
				);
			return { value: node };
		}
		const words =
			selector.boneKeywords ??
			selector.meshKeywords ??
			selector.nodeKeywords ??
			[];
		// Unweighted attachment anchors and collider nodes may be Object3D rather than Three.Bone.
		// Only authored nodes are searchable; three-vrm's normalized animation bones have no file association.
		const candidates =
			kind === "bone"
				? [...asset.nodes.values()].filter((n) => !asset.nodeMeshes(n).length)
				: kind === "mesh"
					? [...asset.nodes.values()].filter((n) => asset.nodeMeshes(n).length)
					: [...asset.nodes.values()];
		const ranked = candidates
			.map((node) => ({ node, score: this.score(node, words, selector) }))
			.filter((x) => x.score > 0)
			.sort((a, b) => b.score - a.score);
		if (
			ranked.length &&
			(ranked.length === 1 || ranked[0].score > ranked[1].score)
		)
			return { value: ranked[0].node };
		if (kind === "bone" && selector.humanBone && asset.vrm) {
			const bone = asset.vrm.humanoid.getRawBoneNode(
				selector.humanBone as VRMHumanBoneName,
			);
			if (bone) return { value: bone };
		}
		return {
			warning: this.warning(
				selector,
				ranked.map((x) => x.node.name),
			),
		};
	}
	private score(node: Object3D, words: string[], selector: Selector): number {
		const names = this.asset(selector).names.get(node) ?? [node.name];
		const score = Math.max(
			0,
			...words.flatMap((w) => names.map((n) => keywordScore(n, w))),
		);
		if (!score) return 0;
		const parentHint =
			selector.parentKeywords ??
			this.self.manifest?.matching?.armatureKeywords ??
			[];
		let bonus = 0;
		for (let p = node.parent; p && p !== this.base.scene.parent; p = p.parent)
			if (parentHint.some((w) => keywordScore(p!.name, w) > 0)) {
				bonus = 1;
				break;
			}
		return score + bonus;
	}
	morph(selector: Selector): Match<{ mesh: Mesh; index: number }[]> {
		const asset = this.asset(selector);
		if (selector.asset === "self") {
			const node = this.node(selector).value!;
			const results = asset.nodeMeshes(node).flatMap((mesh) => {
				const index = selector.morphIndex;
				if (
					index !== undefined &&
					mesh.morphTargetInfluences &&
					index < mesh.morphTargetInfluences.length
				)
					return [{ mesh, index }];
				return [];
			});
			if (!results.length)
				throw new CompositionError(
					"INVALID_LOCAL_MORPH",
					`Local morph ${selector.node}:${selector.morphIndex} does not exist`,
				);
			return { value: results };
		}
		const matches: {
			mesh: Mesh;
			index: number;
			score: number;
			group: Object3D;
		}[] = [];
		for (const mesh of asset.meshes) {
			let group: Object3D = mesh;
			while (
				!asset.indices.has(group) &&
				group.parent &&
				group.parent !== asset.scene
			)
				group = group.parent;
			const meshScore = this.score(
				group,
				selector.meshKeywords ?? [],
				selector,
			);
			for (const [name, index] of Object.entries(
				mesh.morphTargetDictionary ?? {},
			)) {
				const morphScore = Math.max(
					0,
					...(selector.blendshapeKeywords ?? []).map((q) =>
						keywordScore(name, q),
					),
				);
				if (morphScore)
					matches.push({
						mesh,
						index,
						score: morphScore * 1000 + meshScore,
						group,
					});
			}
		}
		matches.sort((a, b) => b.score - a.score);
		if (matches.length) {
			const best = matches.filter((x) => x.score === matches[0].score);
			if (
				new Set(best.map((x) => x.group)).size === 1 &&
				new Set(best.map((x) => x.mesh)).size === best.length
			)
				return {
					value: best.map(({ mesh, index }) => ({ mesh, index })),
					warning:
						selector.meshKeywords?.length &&
						!this.score(best[0].group, selector.meshKeywords, selector)
							? {
									code: "MESH_HINT_FALLBACK",
									message: `Mesh hint was not found; the unique morph on ${best[0].mesh.name} was used.`,
									query: selector,
								}
							: undefined,
				};
		}
		return {
			warning: this.warning(
				selector,
				matches.map((x) => `${x.mesh.name}:${x.index}`),
			),
		};
	}
	warning(query: Selector, candidates: string[] = []): CompositionWarning {
		return {
			code: candidates.length ? "AMBIGUOUS_MATCH" : "MISSING_MATCH",
			message: candidates.length
				? "Several targets match; this operation was skipped."
				: "No named target found; other operations continue.",
			query,
			candidates,
		};
	}
}
