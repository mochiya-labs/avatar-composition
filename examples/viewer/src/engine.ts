import {
	AnimationMixer,
	BufferGeometry,
	Group,
	Material,
	type Object3D,
	type Scene,
	type WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
	VRMAnimationLoaderPlugin,
	createVRMAnimationClip,
	type VRMAnimation,
} from "@pixiv/three-vrm-animation";
import { enableLilToon } from "@mochiya/three-liltoon";
import {
	AvatarAsset,
	AvatarCompositionSession,
	MochiyaAvatarCompositionLoaderPlugin,
	disposeAvatarAsset,
	prepareAvatarAsset,
	type Attachment,
	type CompositionWarning,
} from "@mochiya/avatar-composition";
import {
	enableLilToonVRM,
	uninstallLilToonExpressionBindings,
} from "@mochiya/three-liltoon/vrm";

export interface ViewerItem {
	id: string;
	label: string;
	asset: AvatarAsset;
	visible: boolean;
	debugVisualizers: ViewerDebugVisualizers;
	debugVisualizersVisible: boolean;
	controls: Record<string, number | boolean>;
	result?: Attachment;
}
export interface ViewerDebugVisualizers {
	root: Group;
	count: number;
}

interface LoadedViewerAsset {
	asset: AvatarAsset;
	debugVisualizers: ViewerDebugVisualizers;
}

function disposeDebugVisualizers(debug: ViewerDebugVisualizers) {
	debug.root.removeFromParent();
	const geometries = new Set<BufferGeometry>();
	const materials = new Set<Material>();
	debug.root.traverse((object) => {
		const renderable = object as Object3D & {
			geometry?: BufferGeometry;
			material?: Material | Material[];
		};
		if (renderable.geometry) geometries.add(renderable.geometry);
		const assigned = renderable.material;
		if (Array.isArray(assigned))
			assigned.forEach((material) => materials.add(material));
		else if (assigned) materials.add(assigned);
	});
	geometries.forEach((geometry) => geometry.dispose());
	materials.forEach((material) => material.dispose());
	debug.root.clear();
}
export interface ViewerSnapshot {
	base?: ViewerItem;
	attachments: ViewerItem[];
	selected?: string;
	busy: number;
	error?: string;
	warnings: CompositionWarning[];
	animation?: string;
	paused: boolean;
}
export class ViewerEngine {
	private readonly listeners = new Set<() => void>();
	private snapshot: ViewerSnapshot = {
		attachments: [],
		busy: 0,
		warnings: [],
		paused: false,
	};
	private session?: AvatarCompositionSession;
	private readonly releaseRendering: () => void;
	private mixer?: AnimationMixer;
	private vrma?: VRMAnimation;
	private generation = 0;
	private disposed = false;
	private request = 0;
	constructor(
		private readonly scene: Scene,
		renderer: WebGLRenderer,
	) {
		this.releaseRendering = enableLilToon(renderer);
	}
	subscribe = (fn: () => void) => {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	};
	getSnapshot = () => this.snapshot;
	private patch(patch: Partial<ViewerSnapshot>) {
		this.snapshot = { ...this.snapshot, ...patch };
		this.listeners.forEach((fn) => fn());
	}
	private async task(work: () => Promise<void>) {
		this.patch({ busy: this.snapshot.busy + 1, error: undefined });
		try {
			await work();
		} catch (error) {
			if (!this.disposed)
				this.patch({
					error: error instanceof Error ? error.message : String(error),
				});
		} finally {
			if (!this.disposed)
				this.patch({ busy: Math.max(0, this.snapshot.busy - 1) });
		}
	}
	private loader(warnings: CompositionWarning[], helperRoot: Group) {
		return new GLTFLoader()
			.register((parser) =>
				enableLilToonVRM(
					new VRMLoaderPlugin(parser, {
						autoUpdateHumanBones: true,
						helperRoot,
					}),
					{
						onWarning: (w) =>
							warnings.push({ code: "LILTOON", message: w.message }),
					},
				),
			)
			.register((parser) => new MochiyaAvatarCompositionLoaderPlugin(parser));
	}
	private async load(
		file: File,
		warnings: CompositionWarning[],
	): Promise<LoadedViewerAsset> {
		if (!/\.(vrm|glb)$/i.test(file.name))
			throw new Error("Choose a binary .vrm or .glb model.");
		const helperRoot = new Group();
		helperRoot.name = `VRM debug visualizers: ${file.name}`;
		helperRoot.renderOrder = 10_000;
		helperRoot.visible = false;
		let gltf;
		try {
			gltf = await this.loader(warnings, helperRoot).parseAsync(
				await file.arrayBuffer(),
				"",
			);
		} catch (error) {
			disposeDebugVisualizers({
				root: helperRoot,
				count: helperRoot.children.length,
			});
			throw error;
		}
		const vrm = gltf.userData.vrm;
		if (vrm) VRMUtils.rotateVRM0(vrm);
		let asset: AvatarAsset;
		try {
			asset = await prepareAvatarAsset(gltf);
		} catch (error) {
			disposeDebugVisualizers({
				root: helperRoot,
				count: helperRoot.children.length,
			});
			throw error;
		}
		return {
			asset,
			debugVisualizers: { root: helperRoot, count: helperRoot.children.length },
		};
	}
	private prepare(item: LoadedViewerAsset) {
		const { asset, debugVisualizers } = item;
		for (const mesh of asset.meshes) {
			mesh.castShadow = true;
			mesh.receiveShadow = true;
		}
		this.scene.add(asset.scene);
		this.scene.add(debugVisualizers.root);
	}
	private release(item: Pick<ViewerItem, "asset" | "debugVisualizers">) {
		const { asset, debugVisualizers } = item;
		disposeDebugVisualizers(debugVisualizers);
		if (asset.vrm) uninstallLilToonExpressionBindings(asset.vrm);
		disposeAvatarAsset(asset);
	}
	async loadBase(file: File) {
		const request = ++this.request;
		await this.task(async () => {
			const warnings: CompositionWarning[] = [];
			const loaded = await this.load(file, warnings);
			if (this.disposed || request !== this.request) {
				this.release(loaded);
				return;
			}
			this.replaceBase(loaded, file.name, warnings);
		});
	}
	async loadAttachment(file: File) {
		if (!this.snapshot.base) {
			this.patch({ error: "Load a base avatar first." });
			return;
		}
		const generation = this.generation;
		await this.task(async () => {
			const warnings: CompositionWarning[] = [];
			const loaded = await this.load(file, warnings);
			if (this.disposed || generation !== this.generation) {
				this.release(loaded);
				return;
			}
			this.add(loaded, file.name, warnings);
		});
	}
	private replaceBase(
		loaded: LoadedViewerAsset,
		label: string,
		warnings: CompositionWarning[],
	) {
		const { asset, debugVisualizers } = loaded;
		// Validate the incoming base before releasing the existing workspace.
		let nextSession: AvatarCompositionSession;
		try {
			nextSession = new AvatarCompositionSession({
				base: asset,
			});
		} catch (error) {
			this.release(loaded);
			throw error;
		}
		this.clear();
		++this.generation;
		this.prepare(loaded);
		this.session = nextSession;
		this.patch({
			base: {
				id: "base",
				label,
				asset,
				visible: true,
				debugVisualizers,
				debugVisualizersVisible: false,
				controls: {},
			},
			attachments: [],
			selected: "base",
			warnings: [...warnings, ...nextSession.warnings],
			error: undefined,
			animation: undefined,
		});
	}
	private add(
		loaded: LoadedViewerAsset,
		label: string,
		warnings: CompositionWarning[],
	) {
		const { asset, debugVisualizers } = loaded;
		const id = crypto.randomUUID();
		try {
			this.prepare(loaded);
			const result = this.session!.attach(asset, {
				id,
				layerOrder: this.snapshot.attachments.length,
			});
			this.patch({
				attachments: [
					...this.snapshot.attachments,
					{
						id,
						label,
						asset,
						visible: true,
						debugVisualizers,
						debugVisualizersVisible: false,
						controls: {},
						result,
					},
				],
				selected: id,
				warnings: [...this.snapshot.warnings, ...warnings],
				error: undefined,
			});
		} catch (error) {
			this.release(loaded);
			this.patch({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	select(id: string) {
		this.patch({ selected: id });
	}
	remove(id: string) {
		if (id === "base") {
			++this.request;
			this.clear();
			this.patch({
				base: undefined,
				attachments: [],
				selected: undefined,
				warnings: [],
				animation: undefined,
			});
			return;
		}
		const item = this.snapshot.attachments.find((x) => x.id === id);
		if (!item) return;
		this.session?.detach(id);
		this.release(item);
		this.patch({
			attachments: this.snapshot.attachments.filter((x) => x.id !== id),
			selected: "base",
		});
	}
	toggle(id: string) {
		const item = this.snapshot.attachments.find((x) => x.id === id);
		if (!item) return;
		const visible = !item.visible;
		this.session?.setItemState(id, { visible });
		item.debugVisualizers.root.visible =
			visible && item.debugVisualizersVisible;
		this.patch({
			attachments: this.snapshot.attachments.map((x) =>
				x.id === id ? { ...x, visible } : x,
			),
		});
	}
	setDebugVisualizers(id: string, visible: boolean) {
		const item =
			id === "base"
				? this.snapshot.base
				: this.snapshot.attachments.find((entry) => entry.id === id);
		if (!item?.asset.vrm) return;
		item.debugVisualizers.root.visible = item.visible && visible;
		if (id === "base")
			this.patch({ base: { ...item, debugVisualizersVisible: visible } });
		else
			this.patch({
				attachments: this.snapshot.attachments.map((entry) =>
					entry.id === id
						? { ...entry, debugVisualizersVisible: visible }
						: entry,
				),
			});
	}
	setControl(id: string, control: string, value: number | boolean) {
		if (id === "base") this.session?.setBaseControl(control, value);
		else this.session?.setItemState(id, { controls: { [control]: value } });
		if (id === "base" && this.snapshot.base)
			this.patch({
				base: {
					...this.snapshot.base,
					controls: { ...this.snapshot.base.controls, [control]: value },
				},
			});
		else
			this.patch({
				attachments: this.snapshot.attachments.map((x) =>
					x.id === id
						? { ...x, controls: { ...x.controls, [control]: value } }
						: x,
				),
			});
	}
	setMorph(mesh: string, name: string, value: number) {
		this.session?.setBaseMorph(
			{ meshKeywords: [mesh], blendshapeKeywords: [name] },
			value,
		);
	}
	setExpression(name: string, value: number) {
		this.snapshot.base?.asset.vrm?.expressionManager?.setValue(name, value);
	}
	async loadAnimation(file: File) {
		const base = this.snapshot.base;
		if (!base?.asset.vrm) {
			this.patch({ error: "A VRM base is required for VRMA animation." });
			return;
		}
		await this.task(async () => {
			const gltf = await new GLTFLoader()
				.register((parser) => new VRMAnimationLoaderPlugin(parser))
				.parseAsync(await file.arrayBuffer(), "");
			const animation = gltf.userData.vrmAnimations?.[0] as
				VRMAnimation | undefined;
			if (!animation) throw new Error("No VRM animation was found.");
			if (this.disposed || this.snapshot.base !== base) return;
			this.stopAnimation();
			this.vrma = animation;
			this.mixer = new AnimationMixer(base.asset.scene);
			this.mixer
				.clipAction(createVRMAnimationClip(animation, base.asset.vrm!))
				.play();
			this.patch({ animation: file.name, paused: false });
		});
	}
	pause() {
		this.patch({ paused: !this.snapshot.paused });
	}
	stopAnimation() {
		this.mixer?.stopAllAction();
		if (this.snapshot.base)
			this.mixer?.uncacheRoot(this.snapshot.base.asset.scene);
		this.mixer = undefined;
		this.vrma = undefined;
	}
	update(delta: number) {
		if (!this.session) return;
		const dt = this.snapshot.paused ? 0 : Math.min(delta, 0.05);
		this.session.beforeVrmUpdate();
		this.mixer?.update(dt);
		const base = this.snapshot.base!.asset;
		base.vrm?.update(dt);
		this.scene.updateMatrixWorld(true);
		this.session.afterVrmUpdate(dt);
		// Base materials are advanced by vrm.update. Attachment humanoids stay
		// inactive; their material animation belongs to this viewer.
		const updated = new Set(base.vrm?.materials ?? []);
		for (const item of this.snapshot.attachments) {
			if (!item.visible) continue;
			for (const material of item.asset.vrm?.materials ?? []) {
				if (updated.has(material)) continue;
				updated.add(material);
				(
					material as typeof material & { update?: (delta: number) => void }
				).update?.(dt);
			}
		}
	}
	private clear() {
		++this.generation;
		this.stopAnimation();
		this.session?.dispose();
		this.session = undefined;
		this.snapshot.attachments.forEach((item) => this.release(item));
		if (this.snapshot.base) this.release(this.snapshot.base);
	}
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		++this.request;
		this.clear();
		this.releaseRendering();
		this.listeners.clear();
	}
}
