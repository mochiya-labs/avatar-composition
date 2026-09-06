import { test, expect, type Page } from "@playwright/test";
import { assetFixture } from "./asset-fixture";

const baseFile = assetFixture("avatar.vrm", "avatar");
const attachmentFile = assetFixture("attachment.vrm", "attachment");

function controlledAttachment() {
	return assetFixture("controlled.vrm", "attachment", (manifest) => {
		manifest.requiredCapabilities.push("control");
		manifest.controls.push({
			id: "fit-enabled",
			label: "Fit body",
			defaultValue: true,
		});
		manifest.actions.find((action) => action.id === "fit")!.condition = {
			type: "control",
			control: "fit-enabled",
		};
	});
}

async function loadBase(page: Page) {
	await expect(
		page.getByRole("button", { name: "Load avatar", exact: true }).first(),
	).toBeEnabled();
	await page
		.getByLabel("Base avatar file", { exact: true })
		.setInputFiles(baseFile);
	await expect(
		page.getByRole("button", { name: "avatar.vrm Current base" }),
	).toBeVisible();
}

function weight(page: Page) {
	return page.evaluate(
		() =>
			Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset.meshes[0]
				.morphTargetInfluences[0],
	);
}

test("empty viewer has persistent panels and no demo or stage settings", async ({
	page,
}) => {
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Start with a base avatar" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Load avatar", exact: true }).first(),
	).toBeEnabled();
	await expect(
		page.getByRole("complementary", { name: "Assets", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("complementary", { name: "Inspector", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("main", { name: "Preview" })).toBeVisible();
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await expect(page.getByRole("tab")).toHaveCount(0);
	await expect(
		page.getByRole("button", {
			name: /demo|partial match|grid|toggle inspector|toggle assets/i,
		}),
	).toHaveCount(0);
	await expect(page.getByText(/^(Stage|Lighting|Bloom)$/)).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Add attachment", exact: true }),
	).toBeDisabled();
	expect(
		await page.evaluate(() => {
			const state = Reflect.get(window, "mochiyaViewer").getSnapshot();
			return {
				base: Boolean(state.base),
				attachments: state.attachments.length,
			};
		}),
	).toEqual({ base: false, attachments: 0 });
	await page.screenshot({ path: "test-results/viewer-empty.png" });
});

test("local attachment controls, hide, removal and base replacement", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await loadBase(page);
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(controlledAttachment());
	await expect(
		page.getByRole("button", { name: "controlled.vrm Attached" }),
	).toBeVisible();
	await expect.poll(() => weight(page)).toBe(0.4);
	const fit = page.getByRole("switch", { name: "Fit body" });
	await fit.click();
	await expect.poll(() => weight(page)).toBe(0);
	await fit.click();
	await expect.poll(() => weight(page)).toBe(0.4);
	await page.getByRole("button", { name: "Hide controlled.vrm" }).click();
	await expect.poll(() => weight(page)).toBe(0);
	await page.getByRole("button", { name: "Show controlled.vrm" }).click();
	await expect.poll(() => weight(page)).toBe(0.4);
	await page.screenshot({ path: "test-results/viewer-composition.png" });
	await page.getByRole("button", { name: "Remove controlled.vrm" }).click();
	await expect.poll(() => weight(page)).toBe(0);
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(controlledAttachment());
	await expect(
		page.getByRole("button", { name: "controlled.vrm Attached" }),
	).toBeVisible();
	await loadBase(page);
	await expect(
		page.getByRole("button", { name: "controlled.vrm Attached" }),
	).toHaveCount(0);
	await expect.poll(() => weight(page)).toBe(0);
	expect(errors).toEqual([]);
});

test("unmatched names warn while matched actions still run", async ({
	page,
}) => {
	await page.goto("/");
	await loadBase(page);
	const partial = assetFixture("partial.vrm", "attachment", (manifest) => {
		manifest.rig!.jointMappings[0].target = {
			asset: "base",
			boneKeywords: ["MissingTestBone"],
		};
	});
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(partial);
	await expect(
		page.getByRole("button", { name: "partial.vrm Partial" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Warnings (1)" }),
	).toBeVisible();
	await expect.poll(() => weight(page)).toBe(0.4);
	expect(
		await page.evaluate(
			() =>
				Reflect.get(window, "mochiyaViewer").getSnapshot().attachments[0].asset
					.scene.visible,
		),
	).toBe(true);
	await page.getByRole("button", { name: "Toggle theme" }).click();
	await expect(page.locator("html")).toHaveClass("dark");
	await page.screenshot({
		path: "test-results/viewer-partial-dark.png",
		animations: "disabled",
	});
});

test("VRM and GLB load, fit and detach through the actual loader chain", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await loadBase(page);
	for (const name of ["attachment.vrm", "attachment.glb"]) {
		await page
			.getByLabel("Attachment file", { exact: true })
			.setInputFiles(assetFixture(name, "attachment"));
		await expect(
			page.getByRole("button", { name: `${name} Attached` }),
		).toBeVisible();
		expect(
			await page.evaluate(() => {
				const state = Reflect.get(window, "mochiyaViewer").getSnapshot();
				const attachment = state.attachments[0].asset;
				return {
					role: attachment.manifest.rig.role,
					baseVrm: Boolean(state.base.asset.vrm),
					attachmentVrm: Boolean(attachment.vrm),
				};
			}),
		).toEqual({
			role: "attachmentReference",
			baseVrm: true,
			attachmentVrm: name.endsWith(".vrm"),
		});
		await expect
			.poll(() =>
				page.evaluate(() => {
					const state = Reflect.get(window, "mochiyaViewer").getSnapshot();
					return [
						state.base.asset.meshes[0].morphTargetInfluences[0],
						state.attachments[0].asset.meshes[0].morphTargetInfluences[0],
					];
				}),
			)
			.toEqual([0.4, 0.4]);
		await page.getByRole("button", { name: `Remove ${name}` }).click();
		await expect.poll(() => weight(page)).toBe(0);
	}
	expect(errors).toEqual([]);
});

test("wrong asset roles leave the current avatar and attachment overlay intact", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await loadBase(page);
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(attachmentFile);
	await expect(
		page.getByRole("button", { name: "attachment.vrm Attached" }),
	).toBeVisible();
	const current = () =>
		page.evaluate(() => {
			const state = Reflect.get(window, "mochiyaViewer").getSnapshot();
			return {
				base: state.base.asset.scene.uuid,
				attachment: state.attachments[0].asset.scene.uuid,
				count: state.attachments.length,
				fit: state.base.asset.meshes[0].morphTargetInfluences[0],
			};
		});
	const before = await current();
	// A reference humanoid does not override the attachment's declared role.
	await page
		.getByLabel("Base avatar file", { exact: true })
		.setInputFiles(attachmentFile);
	await expect(
		page.getByText("This file declares an attachment.", { exact: false }),
	).toBeVisible();
	expect(await current()).toEqual(before);
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(baseFile);
	await expect(
		page.getByText("This file declares an avatar.", { exact: false }),
	).toBeVisible();
	expect(await current()).toEqual(before);
	await page.getByRole("button", { name: "Remove attachment.vrm" }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mochiyaViewer").getSnapshot().attachments.length,
			),
		)
		.toBe(0);
	expect(errors).toEqual([]);
});

test("mobile panels and Japanese controls remain usable without toggles", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.getByRole("combobox", { name: "Language" }).click();
	await page.getByRole("option", { name: "日本語" }).click();
	await expect(
		page.getByRole("heading", { name: "ベースアバターから始めよう" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "アバターを開く", exact: true }).first(),
	).toBeEnabled();
	await page
		.getByLabel("Base avatar file", { exact: true })
		.setInputFiles(baseFile);
	await expect(
		page.getByRole("button", { name: "avatar.vrm 現在のベース" }),
	).toBeVisible();
	const assets = page.getByRole("complementary", {
		name: "アセット",
		exact: true,
	});
	await assets.scrollIntoViewIfNeeded();
	const chooser = page.waitForEvent("filechooser");
	await page
		.getByRole("button", { name: "アタッチメントを追加", exact: true })
		.click();
	await (await chooser).setFiles(controlledAttachment());
	await expect(
		page.getByRole("button", { name: "controlled.vrm 装着済み" }),
	).toBeVisible();
	const inspector = page.getByRole("complementary", {
		name: "インスペクター",
		exact: true,
	});
	await inspector.scrollIntoViewIfNeeded();
	await page.getByRole("switch", { name: "Fit body" }).click();
	await expect.poll(() => weight(page)).toBe(0);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.evaluate(() => window.scrollTo(0, 0));
	await expect(page.locator("canvas")).toBeInViewport();
	await page.screenshot({
		path: "test-results/viewer-mobile.png",
		fullPage: true,
	});
});
