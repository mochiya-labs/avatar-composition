import { BoxGeometry, Matrix4, Vector3 } from "three";
import {
	parseManifest,
	type AvatarCompositionManifest,
} from "../../src/schema";

// Browser-test inputs only: no model files are read, written or bundled with the viewer.
const bones: [string, number, [number, number, number]][] = [
	["hips", -1, [0, 1, 0]],
	["spine", 0, [0, 0.2, 0]],
	["head", 1, [0, 0.4, 0]],
	["leftUpperArm", 1, [0.2, 0.2, 0]],
	["leftLowerArm", 3, [0.3, 0, 0]],
	["leftHand", 4, [0.2, 0, 0]],
	["rightUpperArm", 1, [-0.2, 0.2, 0]],
	["rightLowerArm", 6, [-0.3, 0, 0]],
	["rightHand", 7, [-0.2, 0, 0]],
	["leftUpperLeg", 0, [0.1, -0.1, 0]],
	["leftLowerLeg", 9, [0, -0.4, 0]],
	["leftFoot", 10, [0, -0.4, 0.1]],
	["rightUpperLeg", 0, [-0.1, -0.1, 0]],
	["rightLowerLeg", 12, [0, -0.4, 0]],
	["rightFoot", 13, [0, -0.4, 0.1]],
];

export function assetFixture(
	name: string,
	kind: "avatar" | "attachment",
	edit?: (manifest: AvatarCompositionManifest) => void,
	options: {
		lilToonExpressions?: boolean;
		lilToonSpecVersion?: string;
		springBones?: boolean;
	} = {},
) {
	const meshName = kind === "avatar" ? "Body" : "Attachment";
	const manifest = parseManifest({
		specVersion: "0.1",
		assetKind: kind,
		requiredCapabilities:
			kind === "avatar" ? [] : ["rig.bind", "morph.override", "morph.sync"],
		rig: {
			role: kind === "avatar" ? "avatar" : "attachmentReference",
			jointMappings:
				kind === "avatar"
					? []
					: bones.map(([bone], sourceNode) => ({
							sourceNode,
							target: { asset: "base", boneKeywords: [bone] },
						})),
		},
		actions:
			kind === "avatar"
				? []
				: [
						{
							id: "fit",
							type: "morph.override",
							target: {
								asset: "base",
								meshKeywords: ["Body"],
								blendshapeKeywords: ["Body_Slim"],
							},
							value: 0.4,
						},
						{
							id: "sync",
							type: "morph.sync",
							driver: {
								asset: "base",
								meshKeywords: ["Body"],
								blendshapeKeywords: ["Body_Slim"],
							},
							driven: { asset: "self", node: bones.length, morphIndex: 0 },
							curve: {
								interpolation: "linear",
								points: [
									[0, 0],
									[1, 1],
								],
							},
						},
					],
	});
	edit?.(manifest);

	const parts: Buffer[] = [];
	const bufferViews: {
		buffer: number;
		byteOffset: number;
		byteLength: number;
	}[] = [];
	const accessors: {
		bufferView: number;
		componentType: number;
		count: number;
		type: string;
		min?: number[];
		max?: number[];
	}[] = [];
	let byteLength = 0;
	function accessor(
		data: Float32Array | Uint16Array,
		size: number,
		type: string,
		bounds = false,
	) {
		const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
		const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
		bytes.copy(padded);
		bufferViews.push({
			buffer: 0,
			byteOffset: byteLength,
			byteLength: bytes.length,
		});
		parts.push(padded);
		byteLength += padded.length;
		const range = bounds
			? {
					min: Array.from({ length: size }, (_, axis) =>
						Math.min(...data.filter((_, i) => i % size === axis)),
					),
					max: Array.from({ length: size }, (_, axis) =>
						Math.max(...data.filter((_, i) => i % size === axis)),
					),
				}
			: {};
		return (
			accessors.push({
				bufferView: bufferViews.length - 1,
				componentType: data instanceof Float32Array ? 5126 : 5123,
				count: data.length / size,
				type,
				...range,
			}) - 1
		);
	}

	const geometry = new BoxGeometry(0.5, 1.6, 0.3).translate(0, 0.8, 0);
	const positions = new Float32Array(geometry.attributes.position.array);
	const normals = new Float32Array(geometry.attributes.normal.array);
	const count = positions.length / 3;
	const weights = new Float32Array(count * 4);
	for (let vertex = 0; vertex < count; vertex++) weights[vertex * 4] = 1;
	const world: Vector3[] = [];
	const inverseBinds = bones.flatMap(([, parent, translation]) => {
		const position = new Vector3(...translation);
		if (parent >= 0) position.add(world[parent]);
		world.push(position);
		return new Matrix4().makeTranslation(position).invert().toArray();
	});
	const primitive = {
		attributes: {
			POSITION: accessor(positions, 3, "VEC3", true),
			NORMAL: accessor(normals, 3, "VEC3"),
			TEXCOORD_0: accessor(
				new Float32Array(geometry.attributes.uv.array),
				2,
				"VEC2",
			),
			JOINTS_0: accessor(new Uint16Array(count * 4), 4, "VEC4"),
			WEIGHTS_0: accessor(weights, 4, "VEC4"),
		},
		indices: accessor(new Uint16Array(geometry.index!.array), 1, "SCALAR"),
		material: 0,
		targets: [
			{
				POSITION: accessor(
					positions.map((value, i) => (i % 3 === 0 ? value * -0.1 : 0)),
					3,
					"VEC3",
					true,
				),
			},
		],
	};
	const skin = {
		joints: bones.map((_, i) => i),
		skeleton: 0,
		inverseBindMatrices: accessor(new Float32Array(inverseBinds), 16, "MAT4"),
	};
	geometry.dispose();

	const extensions: Record<string, unknown> = {
		MOCHIYA_avatar_composition: manifest,
	};
	if (name.endsWith(".vrm"))
		extensions.VRMC_vrm = {
			specVersion: "1.0",
			meta: {
				name: "Browser test",
				authors: ["Mochiya"],
				licenseUrl: "https://vrm.dev/licenses/1.0/",
			},
			humanoid: {
				humanBones: Object.fromEntries(
					bones.map(([bone], node) => [bone, { node }]),
				),
			},
			expressions: {
				preset: options.lilToonExpressions
					? {
							happy: {
								materialColorBinds: [
									{
										material: 0,
										type: "color",
										targetValue: [0.8, 0.2, 0.4, 0.5],
									},
									{
										material: 0,
										type: "outlineColor",
										targetValue: [0.2, 0.8, 0.4, 1],
									},
								],
								textureTransformBinds: [
									{ material: 0, scale: [2, 3], offset: [0.2, 0.4] },
								],
							},
						}
					: {},
			},
		};
	if (name.endsWith(".vrm") && options.springBones)
		extensions.VRMC_springBone = {
			specVersion: "1.0",
			colliders: [
				{
					node: 0,
					shape: { sphere: { offset: [0, 0.1, 0], radius: 0.08 } },
				},
			],
			colliderGroups: [{ name: "Body", colliders: [0] }],
			springs: [
				{
					name: "Spine",
					joints: [
						{
							node: 1,
							hitRadius: 0.02,
							stiffness: 1,
							gravityPower: 0,
							gravityDir: [0, -1, 0],
							dragForce: 0.4,
						},
						{ node: 2 },
					],
					colliderGroups: [0],
				},
			],
		};
	const gltf = {
		asset: { version: "2.0", generator: "Mochiya browser tests" },
		scene: 0,
		scenes: [{ nodes: [0, bones.length] }],
		nodes: [
			...bones.map(([bone, , translation], i) => ({
				name: bone,
				translation,
				children: bones.flatMap(([, parent], child) =>
					parent === i ? [child] : [],
				),
			})),
			{ name: meshName, mesh: 0, skin: 0 },
		],
		meshes: [
			{
				name: meshName,
				primitives: [primitive],
				weights: [0],
				extras: { targetNames: ["Body_Slim"] },
			},
		],
		skins: [skin],
		materials: [
			{
				extensions:
					options.lilToonExpressions || options.lilToonSpecVersion
						? {
								MOCHIYA_materials_liltoon: {
									specVersion: options.lilToonSpecVersion ?? "1.0",
									renderMode: "opaque",
									properties: {
										_Color: [0.4, 0.5, 0.6, 1],
										_OutlineColor: [0, 0, 0, 1],
										_MainTex_ST: [1, 1, 0, 0],
										_OutlineWidth: 0.03,
										_UseOutline: 1,
									},
								},
							}
						: undefined,
				pbrMetallicRoughness: {
					baseColorFactor: [0.4, 0.5, 0.6, 1],
					metallicFactor: 0,
					roughnessFactor: 1,
				},
			},
		],
		extensionsUsed: [
			...Object.keys(extensions),
			...(options.lilToonExpressions || options.lilToonSpecVersion
				? ["MOCHIYA_materials_liltoon"]
				: []),
		],
		extensions,
		buffers: [{ byteLength }],
		bufferViews,
		accessors,
	};
	const json = Buffer.from(JSON.stringify(gltf));
	const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
	json.copy(paddedJson);
	const header = Buffer.alloc(20);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(28 + paddedJson.length + byteLength, 8);
	header.writeUInt32LE(paddedJson.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	const binaryHeader = Buffer.alloc(8);
	binaryHeader.writeUInt32LE(byteLength, 0);
	binaryHeader.writeUInt32LE(0x004e4942, 4);
	return {
		name,
		mimeType: "application/octet-stream",
		buffer: Buffer.concat([header, paddedJson, binaryHeader, ...parts]),
	};
}
