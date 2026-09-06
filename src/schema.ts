import { z } from "zod";

export const EXTENSION_NAME = "MOCHIYA_avatar_asset";
export const SPEC_VERSION = "0.1";
export const ASSET_KINDS = ["avatar", "attachment"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const CAPABILITIES = [
	"rig.bind",
	"rig.attach",
	"morph.sync",
	"morph.override",
	"node.active",
	"material.swap",
	"control",
	"collider.link",
] as const;
const index = z.number().int().nonnegative();
const number = z.number().finite();
const keywords = z.array(z.string().min(1).max(256)).max(32);
export const selectorSchema = z
	.object({
		asset: z.enum(["self", "base"]),
		node: index.optional(),
		boneKeywords: keywords.optional(),
		meshKeywords: keywords.optional(),
		nodeKeywords: keywords.optional(),
		blendshapeKeywords: keywords.optional(),
		morphIndex: index.optional(),
		humanBone: z.string().max(64).optional(),
		parentKeywords: keywords.optional(),
	})
	.strict()
	.superRefine((s, ctx) => {
		if (s.asset === "self" && s.node === undefined)
			ctx.addIssue({
				code: "custom",
				message: "Local selectors require a node index",
			});
		if (
			s.asset === "base" &&
			(s.node !== undefined || s.morphIndex !== undefined)
		)
			ctx.addIssue({
				code: "custom",
				message:
					"External selectors use keywords, never another file's indices",
			});
	});
export type Selector = z.infer<typeof selectorSchema>;
const conditionSchema = z
	.object({
		type: z.enum(["nodeActive", "control"]),
		asset: z.enum(["self", "base"]).optional(),
		node: index.optional(),
		nodeKeywords: keywords.optional(),
		control: z.string().max(128).optional(),
		value: z.union([number, z.boolean()]).optional(),
		inverse: z.boolean().optional(),
	})
	.strict()
	.superRefine((c, ctx) => {
		if (c.type === "control" && !c.control)
			ctx.addIssue({
				code: "custom",
				message: "Control condition requires a control ID",
			});
		if (
			c.type === "nodeActive" &&
			c.node === undefined &&
			!c.nodeKeywords?.length
		)
			ctx.addIssue({
				code: "custom",
				message: "Node condition requires a target",
			});
		if (c.type === "nodeActive" && c.asset === "base" && c.node !== undefined)
			ctx.addIssue({
				code: "custom",
				message: "External conditions use keywords, never node indices",
			});
	});
const common = {
	id: z.string().min(1).max(128),
	condition: conditionSchema.optional(),
	sourceOrder: number.default(0),
};
const curveSchema = z
	.object({
		interpolation: z.enum(["linear", "step"]),
		points: z
			.array(z.tuple([number, number]))
			.min(2)
			.max(4096),
	})
	.strict()
	.refine(
		(c) => c.points.every((p, i) => i === 0 || p[0] > c.points[i - 1][0]),
		"Curve inputs must be strictly increasing",
	);
export const actionSchema = z.discriminatedUnion("type", [
	z
		.object({
			...common,
			type: z.literal("morph.sync"),
			driver: selectorSchema,
			driven: selectorSchema,
			curve: curveSchema.optional(),
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("morph.override"),
			target: selectorSchema,
			value: number,
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("node.active"),
			target: selectorSchema,
			value: z.boolean(),
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("material.swap"),
			target: selectorSchema,
			slot: index,
			material: index,
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("collider.link"),
			target: selectorSchema,
			collider: selectorSchema,
		})
		.strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export const manifestSchema = z
	.object({
		specVersion: z.literal(SPEC_VERSION),
		assetKind: z
			.enum(ASSET_KINDS)
			.describe(
				"An independent avatar or an attachment that depends on a base avatar.",
			),
		requiredCapabilities: z.array(z.string().max(64)).max(32).default([]),
		matching: z
			.object({
				mode: z.literal("keywordBestEffort"),
				armatureKeywords: keywords.default([]),
				onUnresolved: z.literal("warnAndContinue"),
			})
			.strict()
			.optional(),
		rig: z
			.object({
				role: z
					.enum(["avatar", "attachmentReference"])
					.describe(
						"Avatar rig or attachment reference rig; a reference humanoid does not make an attachment a base avatar.",
					),
				jointMappings: z
					.array(
						z.object({ sourceNode: index, target: selectorSchema }).strict(),
					)
					.max(4096)
					.default([]),
				attachmentRoots: z
					.array(
						z
							.object({
								sourceNode: index,
								target: selectorSchema,
								mode: z
									.enum(["preserveWorld", "snap"])
									.default("preserveWorld"),
							})
							.strict(),
					)
					.max(4096)
					.default([]),
			})
			.strict()
			.optional(),
		controls: z
			.array(
				z
					.object({
						id: z.string().min(1).max(128),
						label: z.string().max(256),
						defaultValue: z.union([number, z.boolean()]),
						min: number.optional(),
						max: number.optional(),
					})
					.strict(),
			)
			.max(1024)
			.default([]),
		nodes: z
			.array(
				z
					.object({
						node: index,
						aliases: keywords.default([]),
						active: z.boolean().default(true),
					})
					.strict(),
			)
			.max(100000)
			.default([]),
		actions: z.array(actionSchema).max(10000).default([]),
	})
	.strict();
export type AvatarAssetManifest = z.infer<typeof manifestSchema>;
export type ManifestInput = z.input<typeof manifestSchema>;
export class CompositionError extends Error {
	constructor(
		public readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "CompositionError";
	}
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Compatibility is a reader concern; the authoring schema exposes only current values. */
function normalizeLegacyManifest(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const normalized = { ...input };
	if (normalized.assetKind === "outfit" || normalized.assetKind === "accessory")
		normalized.assetKind = "attachment";
	if (isRecord(normalized.rig) && normalized.rig.role === "outfitReference") {
		normalized.rig = { ...normalized.rig, role: "attachmentReference" };
	}
	return normalized;
}
/** Parse current or legacy file data without modifying the supplied record. */
export function parseManifest(input: unknown): AvatarAssetManifest {
	const result = manifestSchema.safeParse(normalizeLegacyManifest(input));
	if (!result.success)
		throw new CompositionError(
			"INVALID_MANIFEST",
			result.error.issues
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join("; "),
		);
	const manifest = result.data;
	for (const capability of manifest.requiredCapabilities)
		if (!(CAPABILITIES as readonly string[]).includes(capability))
			throw new CompositionError(
				"UNSUPPORTED_CAPABILITY",
				`Unsupported required operation: ${capability}`,
			);
	for (const entries of [manifest.actions, manifest.controls]) {
		const ids = new Set<string>();
		for (const entry of entries) {
			if (ids.has(entry.id))
				throw new CompositionError("DUPLICATE_ID", `Duplicate ID: ${entry.id}`);
			ids.add(entry.id);
		}
	}
	return manifest;
}

export interface CompositionWarning {
	code: string;
	message: string;
	operation?: string;
	query?: Selector;
	candidates?: string[];
}
