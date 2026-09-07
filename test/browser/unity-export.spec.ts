import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseManifest } from "../../src/index.js";

// Private/generated fixtures remain outside Git. Point CI at outputs from the Unity Editor tests.
const directory = resolve(
	process.env.MOCHIYA_UNITY_FIXTURES ?? "test/unity-project/MochiyaTests",
);
const files = [
	"viewer-avatar.vrm",
	"viewer-outfit.vrm",
	"viewer-outfit.glb",
	"grouped-shapes.vrm",
];
const contracts = [
	...files,
	"ma-sync.glb",
	"merge-BaseToMerge.glb",
	"merge-BidirectionalExact.glb",
	"merge-NotLocked.glb",
];
test("Unity component exports validate, load, compose and detach", async ({
	page,
}) => {
	test.skip(
		!contracts.every((name) => existsSync(resolve(directory, name))),
		"Run the companion Unity Editor export tests or set MOCHIYA_UNITY_FIXTURES.",
	);
	for (const name of contracts) {
		const bytes = readFileSync(resolve(directory, name));
		const json = JSON.parse(
			bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
		);
		const manifest = parseManifest(json.extensions.MOCHIYA_avatar_composition);
		for (const c of manifest.components)
			expect(json.nodes[c.sourceNode]).toBeTruthy();
		expect(json.extensions.MOCHIYA_avatar_composition.actions).toBeUndefined();
		expect(manifest.rig).not.toHaveProperty("jointMappings");
	}
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Load avatar", exact: true }).first(),
	).toBeEnabled();
	await page
		.getByLabel("Base avatar file", { exact: true })
		.setInputFiles(resolve(directory, files[0]));
	await expect(
		page.getByRole("button", { name: "viewer-avatar.vrm Current base" }),
	).toBeVisible();
	const weights = () =>
		page.evaluate(() => {
			const state = Reflect.get(window, "mochiyaViewer").getSnapshot();
			return [
				state.base.asset.meshes[0].morphTargetInfluences[0],
				state.attachments[0]?.asset.meshes[0].morphTargetInfluences[0],
			];
		});
	for (const name of files.slice(1, 3)) {
		await page
			.getByLabel("Attachment file", { exact: true })
			.setInputFiles(resolve(directory, name));
		await expect.poll(weights).toEqual([0.4, 0.4]);
		const diagnostics = await page.evaluate(() => {
			const item = Reflect.get(window, "mochiyaViewer").getSnapshot()
				.attachments[0];
			return {
				matched: item.result.matchedBones,
				requested: item.result.requestedBones,
				warnings: item.result.warnings,
			};
		});
		expect(diagnostics.matched).toBeGreaterThan(10);
		expect(diagnostics.matched).toBe(diagnostics.requested);
		expect(diagnostics.warnings).toEqual([]);
		await page.getByRole("button", { name: `Remove ${name}` }).click();
		await expect.poll(async () => (await weights())[0]).toBe(0);
	}
	await page.evaluate(() => {
		Reflect.get(
			window,
			"mochiyaViewer",
		).getSnapshot().base.asset.meshes[0].morphTargetInfluences[0] = 0.25;
	});
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(resolve(directory, "grouped-shapes.vrm"));
	// The earlier Set in this component remains .65; Delete does not write a weight.
	await expect.poll(async () => (await weights())[0]).toBeCloseTo(0.65);
	await expect
		.poll(() =>
			page.evaluate(() =>
				Reflect.get(window, "mochiyaViewer")
					.getSnapshot()
					.attachments[0]?.result.warnings.map((w: { code: string }) => w.code),
			),
		)
		.not.toContain("SHAPE_DELETE_FALLBACK");
	const oracle = JSON.parse(
		readFileSync(resolve(directory, "grouped-shapes.json"), "utf8"),
	);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset
						.meshes[0].geometry.drawRange.count / 3,
			),
		)
		.toBe(oracle.remainingTriangles);
	await page
		.locator('[data-section="composition-extension"] > summary')
		.click();
	await page
		.locator('[data-section="composition-extension"] details')
		.filter({ has: page.locator("[data-deletion-result]") })
		.locator("summary")
		.first()
		.click();
	await expect(page.locator("[data-deletion-result]")).toContainText(
		"removed triangles",
	);
	await page.screenshot({ path: "test-results/deletion-inspector.png" });
	await page.locator("[data-deletion-result]").scrollIntoViewIfNeeded();
	await expect(page.locator("[data-deletion-result]")).toBeVisible();
	await page.screenshot({ path: "test-results/deletion-inspector-result.png" });
	await page.getByRole("button", { name: "Remove grouped-shapes.vrm" }).click();
	await expect.poll(async () => (await weights())[0]).toBe(0.25);
	for (const name of ["merge-BidirectionalExact.glb", "merge-NotLocked.glb"]) {
		await page
			.getByLabel("Attachment file", { exact: true })
			.setInputFiles(resolve(directory, name));
		await expect
			.poll(() =>
				page.evaluate(() =>
					Reflect.get(window, "mochiyaViewer")
						.getSnapshot()
						.attachments[0]?.result.warnings.map(
							(w: { code: string }) => w.code,
						),
				),
			)
			.toContain("UNSUPPORTED_LOCK_MODE");
		expect(
			await page.evaluate(
				() =>
					Reflect.get(window, "mochiyaViewer").getSnapshot().attachments[0]
						.result.matchedBones,
			),
		).toBeGreaterThan(10);
		await page.getByRole("button", { name: `Remove ${name}` }).click();
	}
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(resolve(directory, "ma-sync.glb"));
	await expect.poll(async () => (await weights())[1]).toBeCloseTo(0.15);
	await page.getByRole("button", { name: "Remove ma-sync.glb" }).click();
	expect(errors).toEqual([]);
});

test("VRMA moves a skinned avatar while its deletion geometry remains stable", async ({
	page,
}) => {
	const file = resolve(directory, "delete-False-True.vrm");
	test.skip(!existsSync(file), "Run the Unity export tests first.");
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Load avatar", exact: true }).first(),
	).toBeEnabled();
	await page
		.getByLabel("Base avatar file", { exact: true })
		.setInputFiles(file);
	await expect(
		page.getByRole("button", { name: "delete-False-True.vrm Current base" }),
	).toBeVisible();
	const before = await page.evaluate(() => {
		const base = Reflect.get(window, "mochiyaViewer").getSnapshot().base;
		return {
			geometry: base.asset.meshes[0].geometry.uuid,
			hipsY: base.asset.vrm.humanoid.getRawBoneNode("hips").position.y,
		};
	});
	// Minimal VRMA with a hips translation track, passed through the real file loader.
	const data = new Float32Array([0, 1, 2, 0, 1, 0, 0, 1.4, 0, 0, 1, 0]);
	const animation = {
		asset: { version: "2.0" },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ name: "Hips", translation: [0, 1, 0] }],
		extensionsUsed: ["VRMC_vrm_animation"],
		extensions: {
			VRMC_vrm_animation: {
				specVersion: "1.0",
				humanoid: { humanBones: { hips: { node: 0 } } },
			},
		},
		buffers: [
			{
				byteLength: data.byteLength,
				uri: `data:application/octet-stream;base64,${Buffer.from(data.buffer).toString("base64")}`,
			},
		],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: 12 },
			{ buffer: 0, byteOffset: 12, byteLength: 36 },
		],
		accessors: [
			{
				bufferView: 0,
				componentType: 5126,
				count: 3,
				type: "SCALAR",
				min: [0],
				max: [2],
			},
			{ bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
		],
		animations: [
			{
				samplers: [{ input: 0, output: 1, interpolation: "LINEAR" }],
				channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
			},
		],
	};
	await page.getByLabel("Animation file", { exact: true }).setInputFiles({
		name: "deletion-motion.vrma",
		mimeType: "application/octet-stream",
		buffer: Buffer.from(JSON.stringify(animation)),
	});
	await expect
		.poll(() =>
			page.evaluate(
				() => Reflect.get(window, "mochiyaViewer").getSnapshot().animation,
			),
		)
		.toBe("deletion-motion.vrma");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mochiyaViewer")
						.getSnapshot()
						.base.asset.vrm.humanoid.getRawBoneNode("hips").position.y,
			),
		)
		.not.toBe(before.hipsY);
	const after = await page.evaluate(() => {
		const mesh = Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset
			.meshes[0];
		return {
			geometry: mesh.geometry.uuid,
			triangles: mesh.geometry.drawRange.count / 3,
		};
	});
	expect(after.geometry).toBe(before.geometry);
	expect(after.triangles).toBe(
		JSON.parse(
			readFileSync(resolve(directory, "delete-False-True.json"), "utf8"),
		).remainingTriangles,
	);
	expect(errors).toEqual([]);
});

test("Unity Delete agrees with MA on dense/sparse, frozen/unfrozen VRM and GLB exports", async ({
	page,
}) => {
	const names = [
		"delete-False-False",
		"delete-False-True",
		"delete-True-False",
		"delete-True-True",
	];
	test.skip(
		!names.every((name) => existsSync(resolve(directory, name + ".json"))),
		"Run the Unity export tests first.",
	);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Load avatar", exact: true }).first(),
	).toBeEnabled();
	for (const name of names) {
		const oracle = JSON.parse(
			readFileSync(resolve(directory, name + ".json"), "utf8"),
		);
		for (const extension of ["vrm", "glb"]) {
			const file = resolve(directory, `${name}.${extension}`),
				bytes = readFileSync(file);
			const json = JSON.parse(
				bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
			);
			const manifest = parseManifest(
				json.extensions.MOCHIYA_avatar_composition,
			);
			const component = manifest.components[0];
			expect(component.type).toBe("shapeChanger");
			if (component.type === "shapeChanger")
				expect(component.threshold).toBeCloseTo(oracle.threshold, 7);
			if (extension === "vrm" && name.endsWith("-True"))
				expect(json.accessors.some((a: { sparse?: unknown }) => a.sparse)).toBe(
					true,
				);
			await page
				.getByLabel("Base avatar file", { exact: true })
				.setInputFiles(file);
			await expect(
				page.getByRole("button", { name: `${name}.${extension} Current base` }),
			).toBeVisible();
			await expect
				.poll(() =>
					page.evaluate(
						() =>
							Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset
								.meshes[0].geometry.drawRange.count / 3,
					),
				)
				.toBe(oracle.remainingTriangles);
			const stats = await page.evaluate(() => {
				const base = Reflect.get(window, "mochiyaViewer").getSnapshot().base;
				return {
					deletion: base.resolved[0].deletion,
					weight: base.asset.meshes[0].morphTargetInfluences[0],
					warnings: base.warnings,
				};
			});
			expect(stats.deletion.removedTriangles).toBe(
				oracle.originalTriangles - oracle.remainingTriangles,
			);
			expect(stats.deletion.fallback).toBeUndefined();
			expect(stats.weight).toBe(0);
		}
	}
	expect(errors).toEqual([]);
});
