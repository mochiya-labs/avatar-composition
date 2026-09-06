import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import publishedSchema from "../schema/MOCHIYA_avatar_composition.schema.json";
import { EXTENSION_NAME, manifestSchema, parseManifest } from "../src/index.js";

describe("extension authoring contract", () => {
	it("publishes the same schema used for current authoring", () => {
		expect(publishedSchema).toEqual(
			zodToJsonSchema(manifestSchema, {
				name: EXTENSION_NAME,
				target: "jsonSchema7",
			}),
		);
		const properties =
			publishedSchema.definitions.MOCHIYA_avatar_composition.properties;
		expect(properties.assetKind.enum).toEqual(["avatar", "attachment"]);
		expect(properties.rig.properties.role.enum).toEqual([
			"avatar",
			"attachmentReference",
		]);
	});
	it.each(["avatar", "attachment"])(
		"accepts current %s authoring data",
		(assetKind) => {
			expect(
				manifestSchema.safeParse({ specVersion: "0.1", assetKind }).success,
			).toBe(true);
		},
	);
	it.each(["outfit", "accessory"])(
		"reads legacy %s without allowing it in new manifests",
		(assetKind) => {
			const legacy = Object.freeze({
				specVersion: "0.1",
				assetKind,
				rig: Object.freeze({ role: "outfitReference" }),
			});
			expect(manifestSchema.safeParse(legacy).success).toBe(false);
			const canonical = parseManifest(legacy);
			expect(canonical.assetKind).toBe("attachment");
			expect(canonical.rig?.role).toBe("attachmentReference");
			expect(manifestSchema.safeParse(canonical).success).toBe(true);
			expect(legacy.assetKind).toBe(assetKind);
			expect(legacy.rig.role).toBe("outfitReference");
		},
	);
	it("requires the current rig vocabulary even for a current attachment kind", () => {
		expect(
			manifestSchema.safeParse({
				specVersion: "0.1",
				assetKind: "attachment",
				rig: { role: "outfitReference" },
			}).success,
		).toBe(false);
	});
});
