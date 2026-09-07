import { expect, it } from "vitest";
import { Bone, Group, Vector3 } from "three";
import {
	AvatarAsset,
	AvatarCompositionSession,
	type ManifestInput,
} from "../src/index.js";

function bone(name: string, parent: Group | Bone) {
	const b = new Bone();
	b.name = name;
	parent.add(b);
	return b;
}
function setup(
	lockMode: "unidirectional" | "bidirectional" | "notLocked" = "unidirectional",
) {
	const baseRoot = new Group(),
		root = new Group();
	const hips = bone("Hips", baseRoot),
		spine = bone("Spine", hips),
		head = bone("Head", spine);
	const source = bone("Coat_Hips_end", root),
		extra = bone("Coat_Extra_end", source),
		sourceSpine = bone("Coat_Spine_end", extra),
		sourceHead = bone("Coat_Head_end", sourceSpine);
	source.position.x = 0.2;
	const manifest: ManifestInput = {
		specVersion: "0.1",
		assetKind: "attachment",
		components: [
			{
				id: "coat",
				type: "mergeArmature",
				sourceNode: 1,
				target: { asset: "base", path: ["Hips"] },
				prefix: "Coat_",
				suffix: "_end",
				lockMode,
			},
		],
	};
	return {
		base: new AvatarAsset(baseRoot),
		asset: new AvatarAsset(root, { manifest }),
		root,
		hips,
		spine,
		head,
		source,
		extra,
		sourceSpine,
		sourceHead,
	};
}
it.each(["unidirectional", "bidirectional", "notLocked"] as const)(
	"procedurally follows names with %s mode, preserves offsets, and restores hierarchy",
	(mode) => {
		const f = setup(mode),
			session = new AvatarCompositionSession({ base: f.base });
		const manifest = JSON.stringify(f.asset.manifest);
		const result = session.attach(f.asset, { id: "coat" });
		expect(result.matchedBones).toBe(3);
		expect(result.requestedBones).toBe(4);
		expect(
			result.warnings.some((w) => w.code === "UNSUPPORTED_LOCK_MODE"),
		).toBe(mode !== "unidirectional");
		expect(result.warnings.some((w) => w.code === "MISSING_MATCH")).toBe(true);
		expect(f.sourceSpine.parent!.parent).toBe(f.spine);
		f.head.position.y = 1;
		f.base.scene.updateMatrixWorld(true);
		expect(f.sourceHead.getWorldPosition(new Vector3()).toArray()).toEqual([
			0.2, 1, 0,
		]);
		f.sourceHead.position.z = 2;
		expect(f.head.position.z).toBe(0);
		expect(result.resolved.filter((r) => r.status === "skipped")).toHaveLength(
			1,
		);
		expect(JSON.stringify(f.asset.manifest)).toBe(manifest);
		session.detach("coat");
		expect(f.source.parent).toBe(f.root);
		expect(f.sourceSpine.parent).toBe(f.extra);
		expect(f.sourceHead.parent).toBe(f.sourceSpine);
		expect(f.source.position.x).toBe(0.2);
		expect(f.sourceHead.position.z).toBe(0);
		session.dispose();
	},
);
it("resolves nested component roots independently and skips tied names", () => {
	const f = setup();
	bone("Head", f.spine);
	const manifest: ManifestInput = {
		...f.asset.manifest!,
		components: [
			...f.asset.manifest!.components,
			{
				id: "nested",
				type: "boneProxy",
				sourceNode: 4,
				target: { asset: "base", boneKeywords: ["Head"] },
			},
		],
	};
	const session = new AvatarCompositionSession({
		base: new AvatarAsset(f.base.scene),
	});
	const result = session.attach(new AvatarAsset(f.root, { manifest }), {
		id: "coat",
	});
	expect(result.resolved.filter((r) => r.sourceNode === 4)).toHaveLength(1);
	expect(result.warnings.some((w) => w.code === "AMBIGUOUS_MATCH")).toBe(true);
	expect(f.sourceHead.parent).toBe(f.sourceSpine);
	session.dispose();
});
