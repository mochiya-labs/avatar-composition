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
	await expect.poll(async () => (await weights())[0]).toBe(0);
	await expect
		.poll(() =>
			page.evaluate(() =>
				Reflect.get(window, "mochiyaViewer")
					.getSnapshot()
					.attachments[0]?.result.warnings.map((w: { code: string }) => w.code),
			),
		)
		.toContain("SHAPE_DELETE_FALLBACK");
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
