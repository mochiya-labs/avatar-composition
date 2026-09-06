import {
	LilToonMaterial,
	OutlinePass,
	ShadowCasterPass,
	type LilToonRendererAdapter,
} from "three-liltoon";
import type { Material, Mesh } from "three";
import type { MaterialBridge } from "./session.js";
import {
	VRMExpressionMaterialColorBind,
	VRMExpressionTextureTransformBind,
	type VRM,
	type VRMExpressionBind,
} from "@pixiv/three-vrm";

/** Configure the lilToon loader with automatic outlines/shadow casters disabled. */
export class LilToonCompositionBridge implements MaterialBridge {
	private readonly outlines = new OutlinePass();
	private readonly shadows = new ShadowCasterPass();
	private readonly owned = new Map<
		Mesh,
		{ depth?: Material; distance?: Material; material: LilToonMaterial }
	>();
	constructor(readonly adapter: LilToonRendererAdapter) {}
	refresh(mesh: Mesh): void {
		const materials = Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material];
		if (
			materials.length === 1 &&
			this.owned.get(mesh)?.material === materials[0]
		)
			return;
		this.release(mesh);
		for (const material of materials)
			if (material instanceof LilToonMaterial)
				material.setRendererAdapter(this.adapter);
		// UniVRM exports primitives per material. A mixed multi-material mesh needs a per-group pass.
		if (materials.length !== 1 || !(materials[0] instanceof LilToonMaterial))
			return;
		const material = materials[0];
		this.owned.set(mesh, {
			depth: mesh.customDepthMaterial,
			distance: mesh.customDistanceMaterial,
			material,
		});
		if (
			Number(material.lilToonProperties._OutlineWidth ?? 0) > 0 &&
			Number(material.lilToonProperties._UseOutline ?? 1) !== 0
		) {
			const outline = this.outlines.attach(mesh, material);
			outline.userData.mochiyaGenerated = true;
			const before = outline.onBeforeRender;
			outline.onBeforeRender = (...args) => {
				before.apply(outline, args);
				const outlineMaterial = outline.material as LilToonMaterial;
				for (const property of [
					"_Color",
					"_OutlineColor",
					"_MainTex_ST",
					"_OutlineWidth",
				]) {
					const value = material.lilToonProperties[property];
					if (value !== undefined) outlineMaterial.setProperty(property, value);
				}
			};
		}
		this.shadows.configure(mesh, material);
	}
	release(mesh: Mesh): void {
		const old = this.owned.get(mesh);
		if (!old) return;
		this.outlines.detach(mesh);
		mesh.customDepthMaterial?.dispose();
		mesh.customDistanceMaterial?.dispose();
		mesh.customDepthMaterial = old.depth;
		mesh.customDistanceMaterial = old.distance;
		this.owned.delete(mesh);
	}
	dispose(): void {
		for (const mesh of [...this.owned.keys()]) this.release(mesh);
	}
}

/** Replace three-vrm's ordinary material binds with lilToon property binds after loading. Returns an undo function. */
export function installLilToonExpressionBindings(vrm: VRM): () => void {
	const restore: (() => void)[] = [];
	const colors: Record<string, string> = {
		color: "_Color",
		emissionColor: "_EmissionColor",
		shadeColor: "_ShadowColor",
		matcapColor: "_MatCapColor",
		rimColor: "_RimColor",
		outlineColor: "_OutlineColor",
	};
	for (const expression of vrm.expressionManager?.expressions ?? [])
		for (const bind of [...expression.binds]) {
			if (
				!(
					bind instanceof VRMExpressionMaterialColorBind ||
					bind instanceof VRMExpressionTextureTransformBind
				) ||
				!(bind.material instanceof LilToonMaterial)
			)
				continue;
			const material = bind.material;
			const property =
				bind instanceof VRMExpressionMaterialColorBind
					? colors[bind.type]
					: "_MainTex_ST";
			if (!property) continue;
			const value = material.lilToonProperties[property];
			const original = Array.isArray(value)
				? [...value]
				: property === "_MainTex_ST"
					? [1, 1, 0, 0]
					: [1, 1, 1, 1];
			const target =
				bind instanceof VRMExpressionMaterialColorBind
					? [
							bind.targetValue.r,
							bind.targetValue.g,
							bind.targetValue.b,
							bind.targetAlpha,
						]
					: [bind.scale.x, bind.scale.y, bind.offset.x, bind.offset.y];
			const replacement: VRMExpressionBind = {
				clearAppliedWeight: () => material.setProperty(property, [...original]),
				applyWeight: (weight) => {
					const current = material.lilToonProperties[property];
					const result = Array.isArray(current) ? [...current] : [...original];
					for (let i = 0; i < 4; i++)
						result[i] =
							(result[i] ?? original[i] ?? 0) +
							weight * (target[i] - (original[i] ?? 0));
					material.setProperty(property, result);
				},
			};
			expression.deleteBind(bind);
			expression.addBind(replacement);
			restore.push(() => {
				expression.deleteBind(replacement);
				expression.addBind(bind);
				replacement.clearAppliedWeight();
			});
		}
	return () =>
		restore
			.splice(0)
			.reverse()
			.forEach((undo) => undo());
}
