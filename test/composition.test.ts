import { describe, expect, it } from "vitest";
import {
	Bone,
	BoxGeometry,
	Float32BufferAttribute,
	Group,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	Skeleton,
	SkinnedMesh,
	Uint16BufferAttribute,
	Vector3,
} from "three";
import {
	AvatarAsset,
	AvatarCompositionSession,
	CompositionError,
	NameResolver,
	evaluateCurve,
	keywordScore,
	parseManifest,
	type ManifestInput,
} from "../src/index.js";
function fixture(name = "Hips", manifest?: ManifestInput) {
	const root = new Group();
	root.name = "Avatar";
	const bone = new Bone();
	bone.name = name;
	bone.position.y = 1;
	root.add(bone);
	const geometry = new BoxGeometry(0.5, 0.5, 0.5);
	const count = geometry.attributes.position.count;
	geometry.setAttribute(
		"skinIndex",
		new Uint16BufferAttribute(Array(count).fill([0, 0, 0, 0]).flat(), 4),
	);
	geometry.setAttribute(
		"skinWeight",
		new Float32BufferAttribute(Array(count).fill([1, 0, 0, 0]).flat(), 4),
	);
	geometry.morphAttributes.position = [geometry.attributes.position.clone()];
	geometry.morphAttributes.position[0].name = "Body_Slim";
	const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
	mesh.name = "Body";
	root.add(mesh);
	root.updateMatrixWorld(true);
	mesh.bind(new Skeleton([bone]));
	const asset = new AvatarAsset(root, { manifest });
	return { root, bone, mesh, asset };
}
const header = { specVersion: "0.1", assetKind: "attachment" } as const;
const baseMorph = {
	asset: "base",
	meshKeywords: ["Body"],
	blendshapeKeywords: ["Body_Slim"],
} as const;
function override(value: number, id = "fit") {
	return {
		id,
		sourceNode: 0,
		type: "shapeChanger" as const,
		shapes: [
			{
				target: {
					asset: "base" as const,
					meshKeywords: ["Body"],
					blendshapeKeywords: ["Body_Slim"],
				},
				value,
				changeType: "set" as const,
			},
		],
	};
}
it("keeps grouped Shape Changer entries and reversibly falls back from Delete to zero", () => {
	const base = fixture();
	base.mesh.morphTargetInfluences![0] = 0.7;
	const attachment = fixture("Hips", {
		...header,
		components: [
			{
				...override(0.2),
				shapes: [
					{
						target: { asset: "base", blendshapeKeywords: ["Absent"] },
						changeType: "set",
						value: 1,
					},
					{
						target: {
							...baseMorph,
							meshKeywords: [...baseMorph.meshKeywords],
							blendshapeKeywords: [...baseMorph.blendshapeKeywords],
						},
						changeType: "delete",
						value: 0.9,
					},
				],
			},
		],
	});
	const session = new AvatarCompositionSession({ base: base.asset });
	const result = session.attach(attachment.asset, { id: "coat" });
	expect(result.warnings.map((w) => w.code)).toEqual(
		expect.arrayContaining(["SHAPE_DELETE_FALLBACK", "MISSING_MATCH"]),
	);
	expect(result.resolved.map((r) => r.status)).toEqual(["skipped", "resolved"]);
	expect(result.resolved[1].target).toBe("Body:Body_Slim");
	expect(base.mesh.morphTargetInfluences![0]).toBe(0);
	session.setItemState("coat", { visible: false });
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.7);
	session.setItemState("coat", { visible: true });
	expect(base.mesh.morphTargetInfluences![0]).toBe(0);
	session.detach("coat");
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.7);
	session.dispose();
});
it("uses an automatic button as a momentary object condition", () => {
	const base = fixture(),
		attachment = fixture("Hips", {
			...header,
			components: [
				{
					id: "button",
					type: "menuItem",
					sourceNode: 1,
					label: "Fit",
					controlType: "button",
				},
				{ ...override(0.6), condition: { type: "nodeActive", node: 1 } },
			],
		});
	const session = new AvatarCompositionSession({ base: base.asset });
	session.attach(attachment.asset, { id: "coat" });
	expect(base.mesh.morphTargetInfluences![0]).toBe(0);
	session.setItemState("coat", { controls: { button: 1 } });
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.6);
	session.setItemState("coat", { controls: { button: 0 } });
	expect(base.mesh.morphTargetInfluences![0]).toBe(0);
	session.dispose();
});
it("uses an authored hierarchy path to disambiguate meshes with the same blendshape", () => {
	const base = fixture(),
		other = fixture();
	const branch = new Group();
	branch.name = "Extra";
	base.root.add(branch);
	branch.add(other.mesh);
	const asset = new AvatarAsset(base.root),
		resolver = new NameResolver(asset, asset);
	expect(
		resolver.morph({
			asset: "base",
			path: ["Extra", "Body"],
			blendshapeKeywords: ["Body_Slim"],
		}).value?.[0].mesh,
	).toBe(other.mesh);
});
it("derives named menu selection for reactive descendants and applies inversion to the combined condition", () => {
	const base = fixture(),
		attachment = fixture("Hips", {
			...header,
			components: [
				{
					id: "named",
					type: "menuItem",
					sourceNode: 0,
					label: "Named",
					controlType: "toggle",
					parameter: "Choice",
					value: 2,
					defaultValue: 0,
					automatic: false,
				},
				{
					...override(0.6),
					condition: { type: "nodeActive", node: 1, inverse: true },
				},
			],
		});
	const session = new AvatarCompositionSession({ base: base.asset });
	session.attach(attachment.asset, { id: "coat" });
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.6);
	expect(attachment.root.visible).toBe(true);
	session.setItemState("coat", { controls: { Choice: 2 } });
	expect(base.mesh.morphTargetInfluences![0]).toBe(0);
	expect(attachment.root.visible).toBe(true);
	session.setItemState("coat", { nodeVisibility: { 1: false } });
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.6);
	session.dispose();
	expect(base.mesh.morphTargetInfluences![0]).toBe(0);
});
describe("attachment terminology", () => {
	it.each(["attachment"] as const)(
		"loads %s records and restores their effects on removal",
		(assetKind) => {
			const base = fixture();
			const manifest = {
				...header,
				assetKind,
				rig: { role: "attachmentReference" },
				components: [
					{
						id: "rig",
						type: "mergeArmature",
						sourceNode: 1,
						target: { asset: "base", boneKeywords: ["Hips"] },
					},
					override(0.4),
				],
			};
			const before = JSON.stringify(manifest);
			const attachment = fixture("Hips", parseManifest(manifest));
			expect(attachment.asset.manifest?.assetKind).toBe("attachment");
			expect(attachment.asset.manifest?.rig?.role).toBe("attachmentReference");
			expect(JSON.stringify(manifest)).toBe(before);
			const session = new AvatarCompositionSession({ base: base.asset });
			const result = session.attach(attachment.asset, { id: "hat" });
			expect(result.matchedBones).toBe(1);
			expect(base.mesh.morphTargetInfluences![0]).toBe(0.4);
			session.detach("hat");
			expect(base.mesh.morphTargetInfluences![0]).toBe(0);
			session.dispose();
		},
	);
	it("preserves avatar kinds and rejects unknown categories", () => {
		expect(
			parseManifest({
				specVersion: "0.1",
				assetKind: "avatar",
				rig: { role: "avatar" },
			}).rig?.role,
		).toBe("avatar");
		expect(() => parseManifest({ ...header, assetKind: "unknown" })).toThrow(
			CompositionError,
		);
		expect(() =>
			parseManifest({ ...header, rig: { role: "unknown" } }),
		).toThrow(CompositionError);
	});
});
describe("keyword matching", () => {
	it("normalizes separators and case without mixing left and right", () => {
		expect(keywordScore("Left_Upper_Arm", "leftUpperArm")).toBeGreaterThan(0);
		expect(keywordScore("Right_Upper_Arm", "LeftUpperArm")).toBe(0);
		expect(keywordScore("attachment.Hips.001", "hips")).toBeGreaterThan(0);
	});
	it("accepts a renamed mesh when the morph name is unique", () => {
		const a = fixture();
		a.mesh.name = "Renamed";
		const resolver = new NameResolver(a.asset, a.asset);
		expect(
			resolver.morph({
				asset: "base",
				meshKeywords: ["MissingMesh"],
				blendshapeKeywords: ["slim"],
			}).value?.[0].mesh,
		).toBe(a.mesh);
		expect(
			resolver.morph({
				asset: "base",
				meshKeywords: ["MissingMesh"],
				blendshapeKeywords: ["slim"],
			}).warning?.code,
		).toBe("MESH_HINT_FALLBACK");
	});
	it("warns and skips an ambiguous bone", () => {
		const a = fixture();
		const extra = new Bone();
		extra.name = "Hips";
		a.root.add(extra);
		const asset = new AvatarAsset(a.root);
		expect(
			new NameResolver(asset, asset).node(
				{ asset: "base", boneKeywords: ["Hips"] },
				"bone",
			).warning?.code,
		).toBe("AMBIGUOUS_MATCH");
		const indexed = new AvatarAsset(a.root, { nodes: new Map([[0, a.bone]]) });
		expect(
			new NameResolver(indexed, indexed).node(
				{ asset: "base", boneKeywords: ["Hips"] },
				"bone",
			).value,
		).toBe(a.bone);
	});
});
describe("attachment lifecycle", () => {
	it("rejects an attachment as the base without executing actions or claiming ownership", () => {
		const attachment = fixture("Hips", {
			...header,
			components: [override(0.4)],
		});
		expect(
			() => new AvatarCompositionSession({ base: attachment.asset }),
		).toThrowError(expect.objectContaining({ code: "INVALID_ASSET_KIND" }));
		expect(attachment.mesh.morphTargetInfluences![0]).toBe(0);
		expect(attachment.bone.parent).toBe(attachment.root);
		const base = fixture("Hips", { ...header, assetKind: "avatar" });
		const session = new AvatarCompositionSession({ base: base.asset });
		expect(session.attach(attachment.asset, { id: "coat" }).status).toBe(
			"attached",
		);
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.4);
		session.dispose();
	});
	it("rejects an avatar as an attachment while preserving the active overlay and incoming asset", () => {
		const base = fixture(),
			coat = fixture("Hips", { ...header, components: [override(0.6)] });
		const candidate = fixture("Hips", { ...header, assetKind: "avatar" });
		const session = new AvatarCompositionSession({ base: base.asset });
		session.attach(coat.asset, { id: "coat" });
		const parent = coat.bone.parent;
		expect(() =>
			session.attach(candidate.asset, { id: "avatar" }),
		).toThrowError(expect.objectContaining({ code: "INVALID_ASSET_KIND" }));
		expect(session.attachments.map((item) => item.id)).toEqual(["coat"]);
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.6);
		expect(coat.bone.parent).toBe(parent);
		expect(candidate.bone.parent).toBe(candidate.root);
		const independent = new AvatarCompositionSession({ base: candidate.asset });
		independent.dispose();
		session.dispose();
	});
	it("preserves skin rest position, follows a posed base and restores the original hierarchy", () => {
		const base = fixture(),
			attachment = fixture();
		attachment.root.position.set(0.1, 0, 0);
		attachment.root.updateMatrixWorld(true);
		const asset = new AvatarAsset(attachment.root);
		const oldParent = attachment.bone.parent;
		const before = attachment.bone.getWorldPosition(new Vector3());
		const session = new AvatarCompositionSession({ base: base.asset });
		session.attach(asset, { id: "coat" });
		expect(
			attachment.bone.getWorldPosition(new Vector3()).distanceTo(before),
		).toBeLessThan(1e-7);
		base.bone.position.y += 0.5;
		base.root.updateMatrixWorld(true);
		expect(attachment.bone.getWorldPosition(new Vector3()).y).toBeCloseTo(
			before.y + 0.5,
		);
		session.detach("coat");
		expect(attachment.bone.parent).toBe(oldParent);
		expect(attachment.bone.position.y).toBe(1);
		session.dispose();
	});
	it("continues valid actions with missing names and an entirely unbound rig", () => {
		const base = fixture(),
			attachment = fixture("Unknown", {
				...header,
				components: [
					{
						id: "rig",
						type: "mergeArmature",
						sourceNode: 1,
						target: { asset: "base", boneKeywords: ["Unknown"] },
					},
					override(0.8),
					{
						...override(0.2, "missing"),
						shapes: [
							{
								target: { asset: "base", blendshapeKeywords: ["NoSuchShape"] },
								changeType: "set",
								value: 0.2,
							},
						],
					},
				],
			});
		const session = new AvatarCompositionSession({ base: base.asset });
		const result = session.attach(attachment.asset, { id: "coat" });
		expect(result.status).toBe("unbound");
		expect(result.warnings).toHaveLength(2);
		expect(attachment.root.visible).toBe(true);
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.8);
		session.detach("coat");
		expect(base.mesh.morphTargetInfluences![0]).toBe(0);
		session.dispose();
	});
	it("restores current user and animation values, with deterministic attachment precedence", () => {
		const base = fixture(),
			coat = fixture("Hips", { ...header, components: [override(0.6)] }),
			dress = fixture("Hips", { ...header, components: [override(0.9)] });
		const session = new AvatarCompositionSession({ base: base.asset });
		session.attach(coat.asset, { id: "coat", layerOrder: 0 });
		session.attach(dress.asset, { id: "dress", layerOrder: 1 });
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.9);
		session.setBaseMorph({ blendshapeKeywords: ["slim"] }, 0.3);
		session.detach("dress");
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.6);
		session.beforeVrmUpdate();
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.3);
		base.mesh.morphTargetInfluences![0] = 0.4;
		session.afterVrmUpdate(1 / 60);
		session.detach("coat");
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.4);
		session.dispose();
	});
	it("rejects shared live instances and rolls back malformed local references", () => {
		const base = fixture(),
			attachment = fixture("Hips", {
				...header,
				components: [
					{
						id: "bad",
						sourceNode: 0,
						type: "objectToggle" as const,
						objects: [
							{
								target: { asset: "self", node: 999 },
								value: false,
							},
						],
					},
				],
			});
		const session = new AvatarCompositionSession({ base: base.asset });
		expect(() => new AvatarCompositionSession({ base: base.asset })).toThrow(
			CompositionError,
		);
		expect(() =>
			session.attach(attachment.asset, { id: "attachment" }),
		).toThrow(CompositionError);
		expect(attachment.bone.parent).toBe(attachment.root);
		expect(session.attachments).toHaveLength(0);
		session.dispose();
	});
	it("executes a base manifest and leaves the host responsible for its VRM update", () => {
		const base = fixture("Hips", {
			...header,
			assetKind: "avatar",
			components: [override(0.4)],
		});
		const session = new AvatarCompositionSession({ base: base.asset });
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.4);
		session.dispose();
		expect(base.mesh.morphTargetInfluences![0]).toBe(0);
	});
});
describe("portable actions", () => {
	it("warns about overlapping attachments and preserves the host's base visibility", () => {
		const base = fixture();
		base.root.visible = false;
		const first = fixture("Hips", { ...header, components: [override(0.2)] });
		const second = fixture("Hips", { ...header, components: [override(0.8)] });
		const session = new AvatarCompositionSession({ base: base.asset });
		session.attach(first.asset, { id: "first", layerOrder: 0 });
		const result = session.attach(second.asset, {
			id: "second",
			layerOrder: 1,
		});
		expect(result.warnings.some((w) => w.code === "OVERLAPPING_WRITERS")).toBe(
			true,
		);
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.8);
		expect(base.root.visible).toBe(false);
		session.detach("second");
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.2);
		session.dispose();
	});
	it("runs visibility controls before a dependent fit action", () => {
		const base = fixture();
		const attachment = fixture("Hips", {
			...header,
			components: [
				{
					id: "show",
					type: "menuItem",
					sourceNode: 0,
					label: "Show",
					controlType: "toggle",
					automatic: false,
					defaultValue: 0,
				},
				{
					...override(0.7),
					condition: { type: "nodeActive", node: 2 },
				},
				{
					id: "show-node",
					condition: { type: "control", control: "show", value: 1 },
					sourceNode: 0,
					type: "objectToggle" as const,
					objects: [
						{
							target: { asset: "self", node: 2 },
							value: true,
						},
					],
				},
				{
					id: "hide",
					condition: { type: "control", control: "show", value: 0 },
					sourceNode: 0,
					type: "objectToggle" as const,
					objects: [
						{
							target: { asset: "self", node: 2 },
							value: false,
						},
					],
				},
			],
		});
		const session = new AvatarCompositionSession({ base: base.asset });
		session.attach(attachment.asset, { id: "coat" });
		expect(base.mesh.morphTargetInfluences![0]).toBe(0);
		session.setItemState("coat", { controls: { show: 1 } });
		expect(base.mesh.morphTargetInfluences![0]).toBe(0.7);
		session.setItemState("coat", { visible: false });
		expect(base.mesh.morphTargetInfluences![0]).toBe(0);
		session.dispose();
	});
	it("synchronizes after fit overrides and extrapolates a linear MA curve", () => {
		const base = fixture();
		const attachment = fixture("Hips", {
			...header,
			components: [
				override(0.8),
				{
					id: "sync",
					sourceNode: 0,
					type: "blendshapeSync" as const,
					bindings: [
						{
							driver: { asset: "base", blendshapeKeywords: ["slim"] },
							driven: { asset: "self", node: 2, morphIndex: 0 },
							curve: {
								interpolation: "linear",
								points: [
									[0, 0],
									[1, 0.5],
								],
							},
						},
					],
				},
			],
		});
		const session = new AvatarCompositionSession({ base: base.asset });
		session.attach(attachment.asset, { id: "coat" });
		expect(attachment.mesh.morphTargetInfluences![0]).toBe(0.4);
		expect(
			evaluateCurve(
				{
					interpolation: "linear",
					points: [
						[0, 0],
						[1, 0.5],
					],
				},
				2,
			),
		).toBe(1);
		session.dispose();
	});
	it("rejects reactive cycles before attaching bones", () => {
		const base = fixture();
		const attachment = fixture("Hips", {
			...header,
			components: [
				{
					id: "cycle",
					condition: { type: "nodeActive", node: 2 },
					sourceNode: 0,
					type: "objectToggle" as const,
					objects: [
						{
							target: { asset: "self", node: 2 },
							value: false,
						},
					],
				},
			],
		});
		const session = new AvatarCompositionSession({ base: base.asset });
		expect(() => session.attach(attachment.asset, { id: "coat" })).toThrow(
			/Cyclic/,
		);
		expect(attachment.bone.parent).toBe(attachment.root);
		session.dispose();
	});
	it("swaps an alternate material and restores it on hiding and removal", () => {
		const base = fixture();
		const attachment = fixture("Hips", {
			...header,
			components: [
				{
					id: "material",
					sourceNode: 0,
					type: "materialSetter" as const,
					objects: [
						{
							target: { asset: "base", meshKeywords: ["Body"] },
							slot: 0,
							material: 0,
						},
					],
				},
			],
		});
		const original = base.mesh.material;
		const session = new AvatarCompositionSession({ base: base.asset });
		session.attach(attachment.asset, { id: "coat" });
		expect(base.mesh.material).toBe(attachment.mesh.material);
		session.beforeVrmUpdate();
		session.afterVrmUpdate(0);
		expect(base.mesh.material).toBe(attachment.mesh.material);
		session.setItemState("coat", { visible: false });
		expect(base.mesh.material).toBe(original);
		session.dispose();
	});
	it("rejects required capabilities and external indices, independently of name matching", () => {
		expect(() =>
			parseManifest({ ...header, requiredCapabilities: ["execute.animator"] }),
		).toThrow(/Unsupported/);
		expect(() =>
			parseManifest({
				...header,
				components: [
					{
						...override(0.1),
						shapes: [
							{
								target: { asset: "base", node: 1 },
								changeType: "set",
								value: 0.1,
							},
						],
					},
				],
			}),
		).toThrow(/External/);
	});
	it("addresses a material slot on the matching glTF primitive", () => {
		const root = new Group(),
			node = new Group();
		node.name = "Body";
		root.add(node);
		const first = new Mesh(new BoxGeometry(), new MeshBasicMaterial()),
			second = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
		node.add(first, second);
		const base = new AvatarAsset(root, { nodes: new Map([[0, node]]) });
		base.primitiveSlots.set(first, 0);
		base.primitiveSlots.set(second, 1);
		const original = second.material,
			untouched = first.material;
		const attachment = fixture("Unknown", {
			...header,
			components: [
				{
					id: "swap",
					sourceNode: 0,
					type: "materialSetter" as const,
					objects: [
						{
							target: { asset: "base", meshKeywords: ["Body"] },
							slot: 1,
							material: 0,
						},
					],
				},
			],
		});
		const session = new AvatarCompositionSession({ base });
		session.attach(attachment.asset, { id: "coat" });
		expect(first.material).toBe(untouched);
		expect(second.material).toBe(attachment.mesh.material);
		session.detach("coat");
		expect(second.material).toBe(original);
		session.dispose();
	});
	it("can reuse an attachment against another named base after detaching", () => {
		const a = fixture(),
			b = fixture(),
			attachment = fixture();
		const first = new AvatarCompositionSession({ base: a.asset });
		first.attach(attachment.asset, { id: "coat" });
		first.detach("coat");
		first.dispose();
		const next = new AvatarCompositionSession({ base: b.asset });
		expect(next.attach(attachment.asset, { id: "coat" }).matchedBones).toBe(1);
		next.dispose();
	});
});
