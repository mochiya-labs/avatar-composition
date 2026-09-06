import {
	Matrix4,
	Mesh,
	Object3D,
	SkinnedMesh,
	type Material,
	type Bone,
} from "three";
import type {
	GLTF,
	GLTFParser,
	GLTFLoaderPlugin,
} from "three/addons/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import {
	EXTENSION_NAME,
	parseManifest,
	type AvatarAssetManifest,
	type ManifestInput,
} from "./schema.js";

export class MochiyaAvatarAssetLoaderPlugin implements GLTFLoaderPlugin {
	readonly name = EXTENSION_NAME;
	constructor(readonly parser: GLTFParser) {}
	async afterRoot(gltf: GLTF): Promise<void> {
		const value = this.parser.json.extensions?.[EXTENSION_NAME];
		// Parsing only. No attachment, materials or hierarchy mutation during loader hooks.
		if (value) gltf.userData.mochiyaAvatarAsset = parseManifest(value);
	}
}

export class AvatarAsset {
	readonly meshes: Mesh[] = [];
	readonly bones: Bone[] = [];
	readonly names = new Map<Object3D, string[]>();
	readonly nodes = new Map<number, Object3D>();
	readonly indices = new Map<Object3D, number>();
	readonly primitiveSlots = new Map<Mesh, number>();
	readonly materials: Material[];
	readonly restWorld = new Map<Object3D, Matrix4>();
	readonly authoredActive = new Map<Object3D, boolean>();
	readonly authoredParents = new Map<Object3D, Object3D | null>();
	readonly rootRestWorld: Matrix4;
	readonly manifest?: AvatarAssetManifest;
	readonly vrm?: VRM;
	constructor(
		readonly scene: Object3D,
		options: {
			manifest?: ManifestInput;
			vrm?: VRM;
			nodes?: Map<number, Object3D>;
			materials?: Material[];
			aliases?: Map<Object3D, string[]>;
		} = {},
	) {
		this.manifest = options.manifest
			? parseManifest(options.manifest)
			: undefined;
		this.vrm = options.vrm;
		this.materials = options.materials ?? [];
		scene.updateWorldMatrix(true, true);
		this.rootRestWorld = scene.matrixWorld.clone();
		let next = 0;
		scene.traverse((node) => {
			if (node.userData.mochiyaGenerated) return;
			this.restWorld.set(node, node.matrixWorld.clone());
			this.names.set(node, [
				...new Set(
					[node.name, ...(options.aliases?.get(node) ?? [])].filter(Boolean),
				),
			]);
			this.authoredActive.set(node, node.visible);
			this.authoredParents.set(node, node.parent);
			if ((node as Bone).isBone) this.bones.push(node as Bone);
			if ((node as Mesh).isMesh) {
				const mesh = node as Mesh;
				this.meshes.push(mesh);
				if (!options.materials)
					for (const m of Array.isArray(mesh.material)
						? mesh.material
						: [mesh.material])
						if (!this.materials.includes(m)) this.materials.push(m);
			}
			if (!options.nodes) this.nodes.set(next++, node);
		});
		if (options.nodes)
			for (const [index, node] of options.nodes) this.nodes.set(index, node);
		for (const [index, node] of this.nodes) this.indices.set(node, index);
		for (const entry of this.manifest?.nodes ?? []) {
			const node = this.nodes.get(entry.node);
			if (!node) throw new Error(`Invalid local node ${entry.node}`);
			this.names.set(node, [
				...new Set([...(this.names.get(node) ?? []), ...entry.aliases]),
			]);
			this.authoredActive.set(node, entry.active);
			node.visible = entry.active;
		}
	}
	nodeMeshes(node: Object3D): Mesh[] {
		if ((node as Mesh).isMesh) return [node as Mesh];
		// Only primitives of this glTF node, not meshes under different authored nodes.
		return this.meshes.filter((mesh) => {
			for (let p: Object3D | null = mesh.parent; p; p = p.parent) {
				if (p === node) return true;
				if (this.indices.has(p)) return false;
			}
			return false;
		});
	}
	restAtCurrentRoot(node: Object3D): Matrix4 {
		this.scene.updateWorldMatrix(true, false);
		return this.scene.matrixWorld
			.clone()
			.multiply(this.rootRestWorld.clone().invert())
			.multiply(this.restWorld.get(node) ?? node.matrixWorld);
	}
}

/** Call after GLTFLoader.loadAsync/parseAsync resolves, with that loader's parser. */
export async function prepareAvatarAsset(gltf: GLTF): Promise<AvatarAsset> {
	const parser = gltf.parser;
	const nodes = new Map<number, Object3D>();
	const aliases = new Map<Object3D, string[]>();
	const loaded = (await parser.getDependencies("node")) as Object3D[];
	loaded.forEach((node, index) => {
		nodes.set(index, node);
		aliases.set(node, [parser.json.nodes?.[index]?.name ?? ""]);
	});
	const materials = (await parser.getDependencies("material")) as Material[];
	const manifest =
		gltf.userData.mochiyaAvatarAsset ??
		parser.json.extensions?.[EXTENSION_NAME];
	const asset = new AvatarAsset(gltf.scene, {
		vrm: gltf.userData.vrm as VRM | undefined,
		manifest,
		nodes,
		aliases,
		materials,
	});
	for (const mesh of asset.meshes) {
		// Three.js records primitive indices here; @types/three currently omits this field.
		const association = parser.associations.get(mesh) as
			{ primitives?: number } | undefined;
		if (association?.primitives !== undefined)
			asset.primitiveSlots.set(mesh, association.primitives);
	}
	return asset;
}

/** Dispose only after detaching this asset from a composition session. */
export function disposeAvatarAsset(asset: AvatarAsset): void {
	const geometries = new Set(asset.meshes.map((mesh) => mesh.geometry));
	const skeletons = new Set(
		asset.meshes
			.filter((m): m is SkinnedMesh => (m as SkinnedMesh).isSkinnedMesh)
			.map((m) => m.skeleton),
	);
	const materials = new Set<Material>(asset.materials);
	for (const mesh of asset.meshes)
		for (const m of Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material])
			materials.add(m);
	const textures = new Set<{ dispose(): void }>();
	for (const m of materials) {
		for (const v of Object.values(m))
			if (
				v &&
				typeof v === "object" &&
				(v as { isTexture?: boolean }).isTexture
			)
				textures.add(v as { dispose(): void });
		for (const v of Object.values(
			(m as Material & { lilToonTextures?: Record<string, unknown> })
				.lilToonTextures ?? {},
		))
			if (
				v &&
				typeof v === "object" &&
				(v as { isTexture?: boolean }).isTexture
			)
				textures.add(v as { dispose(): void });
	}
	asset.scene.removeFromParent();
	asset.vrm?.springBoneManager?.reset();
	geometries.forEach((g) => g.dispose());
	skeletons.forEach((s) => s.dispose());
	materials.forEach((m) => m.dispose());
	textures.forEach((t) => t.dispose());
}
