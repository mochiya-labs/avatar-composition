import { describe, expect, it, vi } from "vitest";
import {
	BoxGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	MeshPhysicalMaterial,
	ShaderMaterial,
	Texture,
	type Material,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import {
	AvatarAsset,
	AvatarCompositionSession,
	disposeAvatarAsset,
	prepareAvatarAsset,
} from "../src/index.js";

function attachment(material: Material, slot = 0) {
	return new AvatarAsset(new Group(), {
		materials: [material],
		manifest: {
			specVersion: "0.1",
			assetKind: "attachment",
			actions: [
				{
					id: "swap",
					type: "material.swap",
					target: { asset: "base", meshKeywords: ["Body"] },
					slot,
					material: 0,
				},
			],
		},
	});
}
function base(material: Material | Material[]) {
	const root = new Group(),
		mesh = new Mesh(new BoxGeometry(), material);
	mesh.name = "Body";
	root.add(mesh);
	return { mesh, asset: new AvatarAsset(root) };
}

describe("material-independent overlays", () => {
	it.each([
		MeshBasicMaterial,
		MeshStandardMaterial,
		MeshPhysicalMaterial,
		ShaderMaterial,
	])("swaps and restores %s without a bridge", (MaterialType) => {
		const original = new MaterialType(),
			replacement = new MaterialType(),
			{ asset, mesh } = base(original);
		const session = new AvatarCompositionSession({ base: asset });
		const item = attachment(replacement);
		for (let i = 0; i < 2; i++) {
			session.attach(item, { id: "item" });
			expect(mesh.material).toBe(replacement);
			session.setItemState("item", { visible: false });
			expect(mesh.material).toBe(original);
			session.setItemState("item", { visible: true });
			expect(mesh.material).toBe(replacement);
			session.detach("item");
			expect(mesh.material).toBe(original);
		}
		session.dispose();
	});
	it("replaces a whole loader-expanded primitive and restores the exact array and groups", () => {
		const materials = [new MeshStandardMaterial(), new ShaderMaterial()],
			{ asset, mesh } = base(materials);
		mesh.geometry.clearGroups();
		mesh.geometry.addGroup(0, 36, 0);
		mesh.geometry.addGroup(0, 36, 1);
		const groups = mesh.geometry.groups;
		asset.primitiveSlots.set(mesh, 0);
		const replacement = new MeshBasicMaterial(),
			session = new AvatarCompositionSession({ base: asset });
		session.attach(attachment(replacement), { id: "item" });
		expect(mesh.material).toBe(replacement);
		session.detach("item");
		expect(mesh.material).toBe(materials);
		expect(mesh.geometry.groups).toBe(groups);
		session.dispose();
	});
	it("retains other procedural slots and external edits on undo", () => {
		const a = new MeshBasicMaterial(),
			b = new MeshStandardMaterial(),
			replacement = new ShaderMaterial(),
			external = new MeshPhysicalMaterial();
		const { asset, mesh } = base([a, b]),
			session = new AvatarCompositionSession({ base: asset });
		session.attach(attachment(replacement, 1), { id: "item" });
		expect(mesh.material).toEqual([a, replacement]);
		(mesh.material as Material[])[1] = external;
		session.detach("item");
		expect(mesh.material).toEqual([a, external]);
		session.dispose();
	});
	it("never advances material animations as part of composition", () => {
		const update = vi.fn(),
			vrm = { materials: [{ update }] } as unknown as VRM;
		const asset = new AvatarAsset(new Group(), { vrm });
		const session = new AvatarCompositionSession({
			base: new AvatarAsset(new Group()),
		});
		session.attach(asset, { id: "item" });
		session.beforeVrmUpdate();
		session.afterVrmUpdate(0.1);
		expect(update).not.toHaveBeenCalled();
		session.dispose();
	});
});

describe("authored data and resource ownership", () => {
	it("captures parser materials/textures including action-only indices and excludes generated meshes", async () => {
		const original = new MeshBasicMaterial(),
			hiddenMaterial = new ShaderMaterial(),
			helperMaterial = new ShaderMaterial();
		const { mesh } = base(original),
			root = new Group(),
			helper = new Mesh(new BoxGeometry(), helperMaterial);
		root.add(mesh);
		mesh.add(helper);
		const texture = new Texture();
		const gltf = {
			scene: root,
			userData: {},
			parser: {
				json: { nodes: [{ name: "Body" }] },
				associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
				getDependencies: vi.fn(
					async (kind: string) =>
						({
							node: [mesh],
							material: [original, hiddenMaterial],
							texture: [texture],
						})[kind],
				),
			},
		} as unknown as GLTF;
		const asset = await prepareAvatarAsset(gltf);
		expect(asset.meshes).toEqual([mesh]);
		expect(asset.materials[1]).toBe(hiddenMaterial);
		expect(asset.names.has(helper)).toBe(false);
		const textureDispose = vi.spyOn(texture, "dispose"),
			materialDispose = vi.spyOn(hiddenMaterial, "dispose"),
			helperDispose = vi.spyOn(helperMaterial, "dispose");
		disposeAvatarAsset(asset);
		disposeAvatarAsset(asset);
		expect(textureDispose).toHaveBeenCalledOnce();
		expect(materialDispose).toHaveBeenCalledOnce();
		expect(helperDispose).not.toHaveBeenCalled();
	});
	it("disposes the owned snapshot, not borrowed overlay materials or their textures", () => {
		const owned = new MeshBasicMaterial(),
			borrowed = new ShaderMaterial(),
			texture = new Texture();
		borrowed.uniforms.texture = { value: texture };
		const { mesh, asset } = base(owned);
		const ownedDispose = vi.spyOn(owned, "dispose"),
			borrowedDispose = vi.spyOn(borrowed, "dispose"),
			textureDispose = vi.spyOn(texture, "dispose");
		mesh.material = borrowed;
		disposeAvatarAsset(asset);
		expect(ownedDispose).toHaveBeenCalledOnce();
		expect(borrowedDispose).not.toHaveBeenCalled();
		expect(textureDispose).not.toHaveBeenCalled();
	});
	it("allows a procedural host to keep shared resources and declare custom owned textures", () => {
		const material = new ShaderMaterial(),
			texture = new Texture(),
			mesh = new Mesh(new BoxGeometry(), material);
		const asset = new AvatarAsset(mesh, {
			resources: { textures: [texture] },
			authoredObjects: new Set([mesh]),
		});
		const materialDispose = vi.spyOn(material, "dispose"),
			geometryDispose = vi.spyOn(mesh.geometry, "dispose"),
			textureDispose = vi.spyOn(texture, "dispose");
		disposeAvatarAsset(asset);
		expect(textureDispose).toHaveBeenCalledOnce();
		expect(materialDispose).not.toHaveBeenCalled();
		expect(geometryDispose).not.toHaveBeenCalled();
	});
});
