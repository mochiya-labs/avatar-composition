import { z } from "zod";

export const EXTENSION_NAME = "MOCHIYA_avatar_composition";
export const SPEC_VERSION = "0.1";
export const ASSET_KINDS = ["avatar", "attachment"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const CAPABILITIES = [
	"mergeArmature",
	"boneProxy",
	"shapeChanger",
	"blendshapeSync",
	"objectToggle",
	"materialSetter",
	"menuItem",
] as const;
const index = z.number().int().nonnegative();
const number = z.number().finite();
const keywords = z.array(z.string().min(1).max(256)).max(32);
export const selectorSchema = z
	.object({
		asset: z.enum(["self", "base"]),
		node: index.optional(),
		path: z.array(z.string().min(1).max(256)).max(128).optional(),
		boneKeywords: keywords.optional(),
		meshKeywords: keywords.optional(),
		nodeKeywords: keywords.optional(),
		blendshapeKeywords: keywords.optional(),
		morphIndex: index.optional(),
		humanBone: z.string().max(64).optional(),
		humanBonePath: z.array(z.string().min(1).max(256)).max(128).optional(),
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
					"External selectors use paths/keywords, never another file's indices",
			});
	});
export type Selector = z.infer<typeof selectorSchema>;
export const conditionSchema = z
	.object({
		type: z.enum(["nodeActive", "control"]),
		asset: z.enum(["self", "base"]).optional(),
		node: index.optional(),
		nodeKeywords: keywords.optional(),
		path: z.array(z.string()).max(128).optional(),
		control: z.string().max(128).optional(),
		value: z.union([number, z.boolean()]).optional(),
		inverse: z.boolean().optional(),
	})
	.strict()
	.superRefine((c, ctx) => {
		if (c.type === "control" && !c.control)
			ctx.addIssue({
				code: "custom",
				message: "Control condition requires an ID",
			});
		if (
			c.type === "nodeActive" &&
			c.node === undefined &&
			!c.nodeKeywords?.length &&
			c.path === undefined
		)
			ctx.addIssue({
				code: "custom",
				message: "Node condition requires a target",
			});
		if (c.type === "nodeActive" && c.asset === "base" && c.node !== undefined)
			ctx.addIssue({
				code: "custom",
				message: "External conditions cannot use local indices",
			});
	});
export type Condition = z.infer<typeof conditionSchema>;
export const curveSchema = z
	.object({
		interpolation: z.enum(["linear", "step"]),
		points: z
			.array(z.tuple([number, number]))
			.min(2)
			.max(4096),
	})
	.strict()
	.superRefine((c, ctx) => {
		if (!c.points.every((p, i) => i === 0 || p[0] > c.points[i - 1][0]))
			ctx.addIssue({ code: "custom", message: "Curve inputs must increase" });
	});
export type RemapCurve = z.infer<typeof curveSchema>;
const common = {
	id: z.string().min(1).max(128),
	sourceNode: index,
	origin: z
		.enum(["modularAvatar", "referenceRig", "colliderAnchor", "authored"])
		.default("authored"),
};
export const componentSchema = z.discriminatedUnion("type", [
	z
		.object({
			...common,
			type: z.literal("mergeArmature"),
			target: selectorSchema,
			prefix: z.string().max(256).default(""),
			suffix: z.string().max(256).default(""),
			lockMode: z
				.enum(["unidirectional", "bidirectional", "notLocked"])
				.default("unidirectional"),
			mangleNames: z.boolean().default(true),
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("boneProxy"),
			target: selectorSchema,
			attachmentMode: z
				.enum(["keepWorldPose", "atRoot", "keepPosition", "keepRotation"])
				.default("keepWorldPose"),
			matchScale: z.boolean().default(false),
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("shapeChanger"),
			threshold: number.nonnegative().default(0.01),
			condition: conditionSchema.optional(),
			shapes: z
				.array(
					z
						.object({
							target: selectorSchema,
							changeType: z.enum(["set", "delete"]),
							value: number.default(0),
						})
						.strict(),
				)
				.max(10000),
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("blendshapeSync"),
			condition: conditionSchema.optional(),
			bindings: z
				.array(
					z
						.object({
							driver: selectorSchema,
							driven: selectorSchema,
							curve: curveSchema.optional(),
						})
						.strict(),
				)
				.max(10000),
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("objectToggle"),
			condition: conditionSchema.optional(),
			objects: z
				.array(
					z.object({ target: selectorSchema, value: z.boolean() }).strict(),
				)
				.max(10000),
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("materialSetter"),
			condition: conditionSchema.optional(),
			objects: z
				.array(
					z
						.object({ target: selectorSchema, slot: index, material: index })
						.strict(),
				)
				.max(10000),
		})
		.strict(),
	z
		.object({
			...common,
			type: z.literal("menuItem"),
			label: z.string().max(256),
			controlType: z.enum(["toggle", "button"]),
			parameter: z.string().min(1).max(128).optional(),
			value: number.default(1),
			defaultValue: z.union([number, z.boolean()]).default(0),
			automatic: z.boolean().default(true),
		})
		.strict(),
]);
export type CompositionComponent = z.infer<typeof componentSchema>;
export type MergeArmature = Extract<
	CompositionComponent,
	{ type: "mergeArmature" }
>;
export type MenuItem = Extract<CompositionComponent, { type: "menuItem" }>;
export const manifestSchema = z
	.object({
		specVersion: z.literal(SPEC_VERSION),
		assetKind: z.enum(ASSET_KINDS),
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
			.object({ role: z.enum(["avatar", "attachmentReference"]) })
			.strict()
			.optional(),
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
		components: z.array(componentSchema).max(10000).default([]),
	})
	.strict();
export type AvatarCompositionManifest = z.infer<typeof manifestSchema>;
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
export function parseManifest(input: unknown): AvatarCompositionManifest {
	const result = manifestSchema.safeParse(input);
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
				`Unsupported required component: ${capability}`,
			);
	const ids = new Set<string>();
	for (const component of manifest.components) {
		if (ids.has(component.id))
			throw new CompositionError(
				"DUPLICATE_ID",
				`Duplicate ID: ${component.id}`,
			);
		ids.add(component.id);
	}
	return manifest;
}
export function menuItems(manifest?: AvatarCompositionManifest): MenuItem[] {
	return (
		manifest?.components.filter((c): c is MenuItem => c.type === "menuItem") ??
		[]
	);
}
export interface CompositionWarning {
	code: string;
	message: string;
	operation?: string;
	query?: Selector;
	candidates?: string[];
}
