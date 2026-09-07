import { expect, it, vi } from "vitest";
import {
	Bone,
	BufferGeometry,
	Float32BufferAttribute,
	Int16BufferAttribute,
	Group,
	Mesh,
	MeshBasicMaterial,
	Raycaster,
	Skeleton,
	SkinnedMesh,
	Uint16BufferAttribute,
	Vector3,
} from "three";
import {
	AvatarAsset,
	AvatarCompositionSession,
	parseManifest,
	type ManifestInput,
} from "../src/index.js";

function fixture(indexed = true, relative = true) {
	const geometry = new BufferGeometry();
	geometry.setAttribute(
		"position",
		new Float32BufferAttribute(
			[-2, 0, 0, -1, 0, 0, -1, 1, 0, 1, 0, 0, 2, 0, 0, 2, 1, 0],
			3,
		),
	);
	if (indexed) geometry.setIndex([0, 1, 2, 3, 4, 5]);
	geometry.addGroup(0, 3, 0);
	geometry.addGroup(3, 3, 1);
	geometry.morphTargetsRelative = relative;
	geometry.morphAttributes.position = [0, 3].map((vertex, i) => {
		const a = relative
			? new Float32BufferAttribute(new Float32Array(18), 3)
			: geometry.attributes.position.clone();
		a.setZ(vertex, 0.125);
		a.name = i === 0 ? "A" : "B";
		return a;
	});
	geometry.setAttribute(
		"skinIndex",
		new Uint16BufferAttribute(new Uint16Array(24), 4),
	);
	geometry.setAttribute(
		"skinWeight",
		new Float32BufferAttribute(
			Array.from({ length: 6 }, () => [1, 0, 0, 0]).flat(),
			4,
		),
	);
	const mesh = new SkinnedMesh(geometry, [
		new MeshBasicMaterial(),
		new MeshBasicMaterial(),
	]);
	mesh.name = "Body";
	const root = new Group(),
		bone = new Bone();
	root.add(bone, mesh);
	root.updateMatrixWorld(true);
	mesh.bind(new Skeleton([bone]));
	const asset = new AvatarAsset(root),
		session = new AvatarCompositionSession({ base: asset });
	return { geometry, mesh, root, bone, asset, session };
}
function shape(
	name = "A",
	changeType: "delete" | "set" = "delete",
	threshold = 0.01,
) {
	return {
		id: name,
		type: "shapeChanger" as const,
		sourceNode: 0,
		threshold,
		shapes: [
			{
				target: {
					asset: "base" as const,
					meshKeywords: ["Body"],
					blendshapeKeywords: [name],
				},
				changeType,
				value: 0.6,
			},
		],
	};
}
function attachment(components: NonNullable<ManifestInput["components"]>) {
	return new AvatarAsset(new Group(), {
		manifest: { specVersion: "0.1", assetKind: "attachment", components },
	});
}
function indices(mesh: Mesh) {
	const { start, count } = mesh.geometry.drawRange;
	return Array.from(mesh.geometry.index!.array).slice(start, start + count);
}

it.each([
	[true, true],
	[false, true],
	[true, false],
	[false, false],
])(
	"deletes triangles on indexed=%s relative=%s meshes and restores originals",
	(indexed, relative) => {
		const f = fixture(indexed, relative),
			{ mesh, session, geometry } = f;
		mesh.morphTargetInfluences![0] = 0.4;
		const result = session.attach(attachment([shape()]), { id: "coat" });
		expect(mesh.geometry).not.toBe(geometry);
		expect(indices(mesh)).toEqual([3, 4, 5]);
		expect(mesh.geometry.groups).toEqual([
			{ start: 0, count: 0, materialIndex: 0 },
			{ start: 0, count: 3, materialIndex: 1 },
		]);
		expect(mesh.morphTargetInfluences![0]).toBe(0.4);
		expect(mesh.geometry.attributes.skinWeight.array).toEqual(
			geometry.attributes.skinWeight.array,
		);
		expect(mesh.geometry.morphAttributes.position![0].array).toEqual(
			geometry.morphAttributes.position![0].array,
		);
		expect(result.resolved[0].deletion).toEqual({
			active: true,
			selectedVertices: 1,
			removedTriangles: 1,
			fallback: undefined,
		});
		const copy = mesh.geometry,
			dispose = vi.fn();
		copy.addEventListener("dispose", dispose);
		session.setItemState("coat", { visible: false });
		expect(mesh.geometry).toBe(geometry);
		session.setItemState("coat", { visible: true });
		expect(mesh.geometry).toBe(copy);
		session.detach("coat");
		expect(mesh.geometry).toBe(geometry);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(geometry.index?.array).toEqual(
			indexed ? new Uint16Array([0, 1, 2, 3, 4, 5]) : undefined,
		);
		session.dispose();
	},
);
it("uses strict distance thresholds independent of the current blendshape weight", () => {
	const { mesh, geometry, session } = fixture();
	mesh.morphTargetInfluences![0] = 1;
	session.attach(attachment([shape("A", "delete", 0.125)]), { id: "equal" });
	expect(mesh.geometry).toBe(geometry);
	session.attach(attachment([shape("B", "delete", 0.124)]), { id: "under" });
	expect(indices(mesh)).toEqual([0, 1, 2]);
	session.dispose();
});
it("unions different shapes and lets a later Set cancel Delete on the same shape", () => {
	const { mesh, session, geometry } = fixture();
	session.attach(attachment([shape()]), { id: "a" });
	session.attach(attachment([shape("B")]), { id: "b" });
	expect(indices(mesh)).toEqual([]);
	session.attach(attachment([shape("A", "set")]), { id: "c" });
	expect(indices(mesh)).toEqual([0, 1, 2]);
	expect(mesh.morphTargetInfluences![0]).toBe(0.6);
	session.setItemState("c", { visible: false });
	expect(indices(mesh)).toEqual([]);
	session.detach("b");
	expect(indices(mesh)).toEqual([3, 4, 5]);
	session.detach("a");
	expect(mesh.geometry).toBe(geometry);
	session.dispose();
});
it("aggregates the minimum threshold even from inactive registered Delete records", () => {
	const { mesh, session, geometry } = fixture();
	session.attach(attachment([shape("A", "delete", 0.2)]), { id: "a" });
	expect(mesh.geometry).toBe(geometry);
	session.attach(attachment([shape("A", "delete", 0.01)]), {
		id: "b",
		visible: false,
	});
	expect(indices(mesh)).toEqual([3, 4, 5]);
	session.detach("b");
	expect(mesh.geometry).toBe(geometry);
	session.dispose();
});
it("preserves component entry order and does not propagate deletion through Blendshape Sync", () => {
	const { mesh, session } = fixture();
	mesh.morphTargetInfluences![0] = 0.3;
	const driven = new Mesh(mesh.geometry, new MeshBasicMaterial()),
		root = new Group();
	root.add(driven);
	const manifest: ManifestInput = {
		specVersion: "0.1",
		assetKind: "attachment",
		components: [
			shape(),
			{
				id: "sync",
				type: "blendshapeSync",
				sourceNode: 0,
				bindings: [
					{
						driver: shape().shapes[0].target,
						driven: {
							asset: "self",
							node: 1,
							morphIndex: 0,
							blendshapeKeywords: ["A"],
						},
					},
				],
			},
		],
	};
	session.attach(new AvatarAsset(root, { manifest }), { id: "coat" });
	expect(driven.morphTargetInfluences![0]).toBe(0.3);
	expect(driven.geometry).not.toBe(mesh.geometry);
	session.detach("coat");
	const grouped = shape();
	grouped.shapes.push(shape("A", "set").shapes[0]);
	session.attach(attachment([grouped]), { id: "group" });
	expect(mesh.geometry.drawRange.count).toBe(Infinity);
	expect(mesh.morphTargetInfluences![0]).toBe(0.6);
	session.dispose();
});
it("retains skinning, morph animation, shared source geometry and raycasting", () => {
	const { mesh, bone, geometry, session, root } = fixture();
	const other = new Mesh(geometry, new MeshBasicMaterial());
	session.attach(attachment([shape()]), { id: "coat" });
	expect(other.geometry).toBe(geometry);
	bone.position.y = 2;
	root.updateMatrixWorld(true);
	mesh.skeleton.update();
	mesh.morphTargetInfluences![1] = 0.5;
	expect(mesh.getVertexPosition(3, new Vector3()).toArray()).toEqual([
		1, 2, 0.0625,
	]);
	const hit = (x: number) =>
		new Raycaster(
			new Vector3(x, 2.2, 2),
			new Vector3(0, 0, -1),
		).intersectObject(mesh).length;
	expect(hit(-1.2)).toBe(0);
	expect(hit(1.8)).toBeGreaterThan(0);
	session.dispose();
	expect(hit(-1.2)).toBeGreaterThan(0);
});
it("preserves restricted draw ranges while filtering material groups", () => {
	const { mesh, geometry, session } = fixture();
	geometry.setDrawRange(3, 3);
	session.attach(attachment([shape()]), { id: "coat" });
	expect(indices(mesh)).toEqual([3, 4, 5]);
	expect(mesh.geometry.drawRange).toEqual({ start: 0, count: 3 });
	session.dispose();
	expect(geometry.drawRange).toEqual({ start: 3, count: 3 });
});
it("caches geometry between frames and invalidates it when source buffers change", () => {
	const { mesh, geometry, session } = fixture();
	session.attach(attachment([shape()]), { id: "coat" });
	const copy = mesh.geometry,
		version = copy.index!.version,
		dispose = vi.fn();
	copy.addEventListener("dispose", dispose);
	for (let i = 0; i < 4; i++) {
		session.beforeVrmUpdate();
		session.afterVrmUpdate(1 / 60);
	}
	expect(mesh.geometry).toBe(copy);
	expect(copy.index!.version).toBe(version);
	geometry.morphAttributes.position![0].setZ(0, 0);
	geometry.morphAttributes.position![0].needsUpdate = true;
	session.beforeVrmUpdate();
	session.afterVrmUpdate(1 / 60);
	expect(mesh.geometry).toBe(geometry);
	expect(dispose).toHaveBeenCalledOnce();
	session.dispose();
});
it("warns once and falls back to zero for unsupported data, without blocking other shapes", () => {
	const { mesh, geometry, session } = fixture();
	mesh.morphTargetInfluences![0] = 0.7;
	geometry.morphAttributes.position![0] = new Float32BufferAttribute([], 3);
	const result = session.attach(attachment([shape(), shape("B")]), {
		id: "coat",
	});
	expect(result.status).toBe("partial");
	expect(indices(mesh)).toEqual([0, 1, 2]);
	expect(mesh.morphTargetInfluences![0]).toBe(0);
	expect(result.resolved[0].deletion?.fallback).toContain("position deltas");
	for (let i = 0; i < 3; i++) {
		session.beforeVrmUpdate();
		session.afterVrmUpdate(1 / 60);
	}
	expect(
		result.warnings.filter((w) => w.code === "SHAPE_DELETE_FALLBACK"),
	).toHaveLength(1);
	session.dispose();
	expect(mesh.morphTargetInfluences![0]).toBe(0.7);
	expect(mesh.geometry).toBe(geometry);
});
it("never overwrites a host geometry replacement when detaching", () => {
	const { mesh, geometry, session } = fixture();
	const result = session.attach(attachment([shape()]), { id: "coat" });
	const replacement = geometry.clone();
	mesh.geometry = replacement;
	session.beforeVrmUpdate();
	session.afterVrmUpdate(1 / 60);
	expect(result.resolved[0].deletion?.fallback).toContain("host replaced");
	session.dispose();
	expect(mesh.geometry).toBe(replacement);
});
it("defaults missing thresholds and rejects invalid thresholds", () => {
	const parse = (threshold?: number) =>
		parseManifest({
			specVersion: "0.1",
			assetKind: "attachment",
			components: [{ ...shape(), threshold }],
		});
	expect(parse().components[0]).toHaveProperty("threshold", 0.01);
	for (const threshold of [-1, Infinity, NaN])
		expect(() => parse(threshold)).toThrow();
});

it("decodes normalized deltas and supports 32-bit triangle indices", () => {
	const { mesh, geometry, session } = fixture();
	const count = 65538;
	geometry.setAttribute(
		"position",
		new Float32BufferAttribute(new Float32Array(count * 3), 3),
	);
	const delta = new Int16BufferAttribute(new Int16Array(count * 3), 3, true);
	delta.setZ(0, 0.2);
	geometry.morphAttributes.position = [delta];
	geometry.setIndex([0, 1, 2, 65535, 65536, 65537]);
	session.attach(attachment([shape()]), { id: "coat" });
	expect(mesh.geometry.index!.array).toBeInstanceOf(Uint32Array);
	expect(indices(mesh)).toEqual([65535, 65536, 65537]);
	session.dispose();
});
it("applies and restores deletion through a base menu condition", () => {
	const f = fixture();
	f.session.dispose();
	const component = {
		...shape(),
		shapes: [
			{
				changeType: "delete" as const,
				target: { asset: "self" as const, node: 2, morphIndex: 0 },
			},
		],
	};
	const base = new AvatarAsset(f.root, {
		manifest: {
			specVersion: "0.1",
			assetKind: "avatar",
			components: [
				{
					id: "menu",
					type: "menuItem",
					sourceNode: 0,
					label: "Delete",
					controlType: "toggle",
					automatic: false,
					defaultValue: 0,
				},
				{ ...component, condition: { type: "control", control: "menu" } },
			],
		},
	});
	const session = new AvatarCompositionSession({ base });
	expect(f.mesh.geometry).toBe(f.geometry);
	session.setBaseControl("menu", 1);
	expect(indices(f.mesh)).toEqual([3, 4, 5]);
	session.setBaseControl("menu", 0);
	expect(f.mesh.geometry).toBe(f.geometry);
	session.setBaseControl("menu", 1);
	session.dispose();
	expect(f.mesh.geometry).toBe(f.geometry);
});
