import { test, expect, type Page } from "@playwright/test";
import { assetFixture } from "./asset-fixture";
const baseFile = assetFixture("avatar.vrm", "avatar");
const attachmentFile = assetFixture("attachment.vrm", "attachment");
function controlledAttachment() {
	return assetFixture("controlled.vrm", "attachment", (manifest) => {
		manifest.requiredCapabilities.push("menuItem");
		manifest.components.push({
			type: "menuItem",
			sourceNode: 0,
			controlType: "toggle",
			automatic: false,
			value: 1,
			origin: "authored",
			id: "fit-enabled",
			label: "Fit body",
			defaultValue: true,
		});
		const fit = manifest.components.find(
			(action) => action.type === "shapeChanger" && action.id === "fit",
		)!;
		if (fit.type !== "shapeChanger") throw new Error("Missing fit instruction");
		fit.condition = {
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
test("momentary menu buttons release on keyboard, pointer and window cancellation", async ({
	page,
}) => {
	const file = assetFixture("button.vrm", "attachment", (manifest) => {
		manifest.components.push({
			id: "press",
			type: "menuItem",
			sourceNode: 0,
			origin: "authored",
			label: "Hold fit",
			controlType: "button",
			automatic: false,
			value: 1,
			defaultValue: 0,
		});
		for (const c of manifest.components)
			if (c.type === "shapeChanger")
				c.condition = { type: "control", control: "press", value: 1 };
	});
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto("/");
	await loadBase(page);
	await page.getByLabel("Attachment file", { exact: true }).setInputFiles(file);
	const button = page.getByRole("button", { name: "Hold fit", exact: true });
	await expect(button).toBeVisible();
	await expect.poll(() => weight(page)).toBe(0);
	await button.focus();
	await page.keyboard.down("Space");
	await expect.poll(() => weight(page)).toBe(0.4);
	await page.keyboard.up("Space");
	await expect.poll(() => weight(page)).toBe(0);
	await button.hover();
	await page.mouse.down();
	await expect.poll(() => weight(page)).toBe(0.4);
	await page.mouse.up();
	await expect.poll(() => weight(page)).toBe(0);
	await button.focus();
	await page.keyboard.down("Enter");
	await expect.poll(() => weight(page)).toBe(0.4);
	await page.evaluate(() => window.dispatchEvent(new Event("blur")));
	await expect.poll(() => weight(page)).toBe(0);
	await page.keyboard.up("Enter");
	await page.getByRole("button", { name: "Remove button.vrm" }).click();
	expect(errors).toEqual([]);
});
function weight(page: Page) {
	return page.evaluate(
		() =>
			Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset.meshes[0]
				.morphTargetInfluences[0],
	);
}
test("the enhanced VRM loader renders lilToon GLB with tangents and no VRM runtime", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Load avatar", exact: true }).first(),
	).toBeEnabled();
	await page.getByLabel("Base avatar file", { exact: true }).setInputFiles(
		assetFixture("liltoon.glb", "avatar", undefined, {
			lilToonExpressions: true,
		}),
	);
	await expect(
		page.getByRole("button", { name: "liltoon.glb Current base" }),
	).toBeVisible();
	await page.evaluate(() => {
		const mesh = Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset
			.meshes[0];
		mesh.onAfterRender = () => {
			mesh.userData.drewOutline = mesh.children.some(
				(child: {
					material?: {
						pass?: string;
					};
				}) => child.material?.pass === "outline",
			);
		};
	});
	await expect
		.poll(() =>
			page.evaluate(() => {
				const asset = Reflect.get(window, "mochiyaViewer").getSnapshot().base
					.asset;
				const mesh = asset.meshes[0];
				return {
					vrm: Boolean(asset.vrm),
					lilToon: mesh.material.isLilToonMaterial,
					tangents: mesh.geometry.getAttribute("tangent")?.count > 0,
					outline: mesh.userData.drewOutline,
				};
			}),
		)
		.toEqual({ vrm: false, lilToon: true, tangents: true, outline: true });
	expect(errors).toEqual([]);
});
test("lilToon material expressions load automatically on avatars and attachments", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Load avatar", exact: true }).first(),
	).toBeEnabled();
	await page.getByLabel("Base avatar file", { exact: true }).setInputFiles(
		assetFixture("liltoon.vrm", "avatar", undefined, {
			lilToonExpressions: true,
		}),
	);
	await expect(
		page.getByRole("button", { name: "liltoon.vrm Current base" }),
	).toBeVisible();
	await page.getByLabel("Attachment file", { exact: true }).setInputFiles(
		assetFixture("liltoon-attachment.vrm", "attachment", undefined, {
			lilToonExpressions: true,
		}),
	);
	await expect(
		page.getByRole("button", { name: "liltoon-attachment.vrm Attached" }),
	).toBeVisible();
	for (const value of [1, 0]) {
		await page.evaluate((value) => {
			const state = Reflect.get(window, "mochiyaViewer").getSnapshot();
			for (const item of [state.base, ...state.attachments]) {
				item.asset.vrm.expressionManager.setValue("happy", value);
				const mesh = item.asset.meshes[0];
				mesh.onAfterRender = () => {
					const outline = mesh.children.find(
						(child: {
							material?: {
								pass?: string;
							};
						}) => child.material?.pass === "outline",
					);
					mesh.userData.observedOutline =
						outline?.material.lilToonProperties._OutlineColor;
				};
			}
		}, value);
		await expect
			.poll(() =>
				page.evaluate(() => {
					const state = Reflect.get(window, "mochiyaViewer").getSnapshot();
					return [state.base, ...state.attachments].map((item) => {
						const mesh = item.asset.meshes[0];
						const material = mesh.material;
						const rounded = (array: number[]) =>
							array.map((v) => Number(v.toFixed(5)));
						return {
							color: rounded(material.lilToonProperties._Color),
							uv: rounded(material.lilToonProperties._MainTex_ST),
							outline: rounded(mesh.userData.observedOutline ?? []),
						};
					});
				}),
			)
			.toEqual(
				[0, 1].map(() => ({
					color: value ? [0.8, 0.2, 0.4, 0.5] : [0.4, 0.5, 0.6, 1],
					uv: value ? [2, 3, 0.2, 0.4] : [1, 1, 0, 0],
					outline: value ? [0.2, 0.8, 0.4, 1] : [0, 0, 0, 1],
				})),
			);
	}
	await page
		.getByRole("button", { name: "Remove liltoon-attachment.vrm" })
		.click();
	await loadBase(page);
	expect(errors).toEqual([]);
});
test("material swaps and undo update lilToon rendering without a composition bridge", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Load avatar", exact: true }).first(),
	).toBeEnabled();
	await page.getByLabel("Base avatar file", { exact: true }).setInputFiles(
		assetFixture("toon.vrm", "avatar", undefined, {
			lilToonExpressions: true,
		}),
	);
	await expect(
		page.getByRole("button", { name: "toon.vrm Current base" }),
	).toBeVisible();
	await page.evaluate(() => {
		const mesh = Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset
			.meshes[0];
		mesh.onAfterRender = () => {
			mesh.userData.outlineDraw = mesh.children.some(
				(n: {
					material?: {
						pass?: string;
					};
				}) => n.material?.pass === "outline",
			);
		};
	});
	const outlined = () =>
		page.evaluate(
			() =>
				Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset.meshes[0]
					.userData.outlineDraw,
		);
	await expect.poll(outlined).toBe(true);
	const replacement = assetFixture("material.glb", "attachment", (manifest) => {
		manifest.requiredCapabilities.push("materialSetter");
		manifest.components.push({
			id: "replace",
			sourceNode: 0,
			type: "materialSetter" as const,
			origin: "authored",
			objects: [
				{
					target: { asset: "base", meshKeywords: ["Body"] },
					slot: 0,
					material: 0,
				},
			],
		});
	});
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(replacement);
	await expect(
		page.getByRole("button", { name: "material.glb Attached" }),
	).toBeVisible();
	await expect.poll(outlined).toBe(false);
	await page.getByRole("button", { name: "Remove material.glb" }).click();
	await expect.poll(outlined).toBe(true);
	expect(
		await page.evaluate(
			() =>
				Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset.meshes[0]
					.children.length,
		),
	).toBe(0);
	expect(errors).toEqual([]);
});
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
test("inspector controls meshes, blendshapes, and the collapsed bone tree", async ({
	page,
}) => {
	await page.goto("/");
	await loadBase(page);
	const meshVisibility = page.getByRole("switch", {
		name: "Mesh visibility: Body",
	});
	const meshes = page.locator('details[data-section="meshes"]');
	await expect(meshes).not.toHaveAttribute("open", "");
	await expect(meshVisibility).not.toBeVisible();
	await meshes.locator(":scope > summary").click();
	await expect(meshVisibility).toBeChecked();
	await meshVisibility.click();
	await expect(meshVisibility).not.toBeChecked();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mochiyaViewer").getSnapshot().base.asset
						.meshes[0].visible,
			),
		)
		.toBe(false);
	await meshVisibility.click();
	await expect(meshVisibility).toBeChecked();
	const blendshapes = page.getByLabel("Body blendshapes");
	await expect(
		page.getByRole("slider", { name: "Body_Slim" }),
	).not.toBeVisible();
	await blendshapes.click();
	await expect(page.getByRole("slider", { name: "Body_Slim" })).toBeVisible();
	await meshes.locator(":scope > summary").click();
	await expect(meshVisibility).not.toBeVisible();
	await expect(
		page.getByRole("slider", { name: "Body_Slim" }),
	).not.toBeVisible();
	const boneTree = page.locator('details[data-section="bones"]');
	await expect(boneTree).not.toHaveAttribute("open", "");
	await expect(page.getByText("hips", { exact: true })).not.toBeVisible();
	await boneTree.locator(":scope > summary").click();
	await expect(page.getByText("hips", { exact: true })).toBeVisible();
	await expect(page.getByText("spine", { exact: true })).not.toBeVisible();
	await page.getByText("hips", { exact: true }).click();
	await expect(page.getByText("spine", { exact: true })).toBeVisible();
});
test("inspector exposes every Avatar Composition base relationship", async ({
	page,
}) => {
	await page.goto("/");
	await loadBase(page);
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(attachmentFile);
	await expect(
		page.getByRole("button", { name: "attachment.vrm Attached" }),
	).toBeVisible();
	const extension = page.locator(
		'details[data-section="composition-extension"]',
	);
	await expect(extension).not.toHaveAttribute("open", "");
	await extension.locator(":scope > summary").click();
	await expect(
		extension.getByText("attachment", { exact: true }),
	).toBeVisible();
	await expect(
		extension.getByText("attachmentReference", { exact: true }),
	).toBeVisible();
	await extension.locator('[data-component-id="rig"] > summary').click();
	await extension.locator('[data-component-id="fit"] > summary').click();
	await extension.locator('[data-component-id="sync"] > summary').click();
	await expect(extension.locator("[data-rig-link]")).toHaveCount(15);
	await expect(extension.locator("[data-component-id]")).toHaveCount(3);
	await expect(extension.locator('[data-component-id="fit"]')).toContainText(
		"Body_Slim",
	);
	await expect(extension.locator('[data-component-id="sync"]')).toContainText(
		"This asset",
	);
	await expect(
		extension.getByText("hips (#0)", { exact: true }).first(),
	).toBeVisible();
	await expect(extension.getByText("Raw extension manifest")).toBeVisible();
});
test("VRM debug visualizers are off by default and toggle per asset", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await loadBase(page);
	await page.getByLabel("Attachment file", { exact: true }).setInputFiles(
		assetFixture("debug-attachment.vrm", "attachment", undefined, {
			springBones: true,
		}),
	);
	const attachmentToggle = page.getByRole("switch", {
		name: "Show debug visualizers debug-attachment.vrm",
	});
	await expect(attachmentToggle).not.toBeChecked();
	expect(
		await page.evaluate(() => {
			const state = Reflect.get(window, "mochiyaViewer").getSnapshot();
			const base = state.base;
			const attachment = state.attachments[0];
			return {
				baseVisible: base.debugVisualizers.root.visible,
				attachmentVisible: attachment.debugVisualizers.root.visible,
				helperTypes: attachment.debugVisualizers.root.children.map(
					(child: {
						constructor: {
							name: string;
						};
					}) => child.constructor.name,
				),
			};
		}),
	).toEqual({
		baseVisible: false,
		attachmentVisible: false,
		helperTypes: expect.arrayContaining([
			"VRMHumanoidHelper",
			"VRMSpringBoneJointHelper",
			"VRMSpringBoneColliderHelper",
		]),
	});
	await attachmentToggle.click();
	await expect(attachmentToggle).toBeChecked();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mochiyaViewer").getSnapshot().attachments[0]
						.debugVisualizers.root.visible,
			),
		)
		.toBe(true);
	await page.getByRole("button", { name: "Hide debug-attachment.vrm" }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mochiyaViewer").getSnapshot().attachments[0]
						.debugVisualizers.root.visible,
			),
		)
		.toBe(false);
	await page.getByRole("button", { name: "Show debug-attachment.vrm" }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mochiyaViewer").getSnapshot().attachments[0]
						.debugVisualizers.root.visible,
			),
		)
		.toBe(true);
	await page.getByRole("button", { name: "avatar.vrm Current base" }).click();
	const baseToggle = page.getByRole("switch", {
		name: "Show debug visualizers avatar.vrm",
	});
	await expect(baseToggle).not.toBeChecked();
	await page.evaluate(() => {
		Reflect.set(
			window,
			"removedDebugRoot",
			Reflect.get(window, "mochiyaViewer").getSnapshot().attachments[0]
				.debugVisualizers.root,
		);
	});
	await page
		.getByRole("button", { name: "Remove debug-attachment.vrm" })
		.click();
	expect(
		await page.evaluate(() => {
			const root = Reflect.get(window, "removedDebugRoot");
			Reflect.deleteProperty(window, "removedDebugRoot");
			return { parent: root.parent, children: root.children.length };
		}),
	).toEqual({ parent: null, children: 0 });
	expect(errors).toEqual([]);
});
test("unmatched names warn while matched actions still run", async ({
	page,
}) => {
	await page.goto("/");
	await loadBase(page);
	const partial = assetFixture(
		"partial.vrm",
		"attachment",
		(manifest) => {
			const rig = manifest.components.find((c) => c.type === "mergeArmature")!;
			if (rig.type !== "mergeArmature") throw new Error("missing rig");
			rig.target = {
				asset: "base",
				boneKeywords: ["MissingTestBone"],
			};
		},
		{ lilToonSpecVersion: "9.0" },
	);
	await page
		.getByLabel("Attachment file", { exact: true })
		.setInputFiles(partial);
	await expect(
		page.getByRole("button", { name: "partial.vrm Partial" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Warnings (2)" }),
	).toBeVisible();
	const warningReview = page.getByRole("region", { name: "Warnings" });
	await expect(
		warningReview.getByText("MissingTestBone", { exact: true }),
	).not.toBeVisible();
	await expect(page.getByText(/spec 9\.0/)).not.toBeVisible();
	await page.getByLabel("Composition warnings (1)").click();
	await expect(
		warningReview.getByText("MissingTestBone", { exact: true }),
	).toBeVisible();
	await page.getByLabel("lilToon warnings (1)").click();
	await expect(page.getByText(/spec 9\.0/)).toBeVisible();
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
