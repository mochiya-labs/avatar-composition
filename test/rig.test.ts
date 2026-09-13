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
		sourceSpine = bone("Coat_Spine_end", source),
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
		expect(f.sourceSpine.parent).toBe(f.source);
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

it.each(["L", "R"])(
	"keeps outfit Ribbon Root %s on its leg instead of matching a hand ribbon",
	(side) => {
		const baseRoot = new Group(),
			sourceRoot = new Group();
		const baseArmature = bone("Armature", baseRoot),
			sourceArmature = bone("Armature", sourceRoot);
		const baseLeg = bone(`UpperLeg_${side}`, baseArmature),
			sourceLeg = bone(`Coat_UpperLeg_${side}`, sourceArmature);
		baseLeg.position.y = sourceLeg.position.y = 0.65;
		const hand = bone(`Ribbon_hand_${side}_root`, baseArmature);
		hand.position.set(0.4, 1, 0);
		const ribbon = bone(`Coat_Ribbon Root ${side}`, sourceLeg),
			tip = bone(`Coat_Ribbon ${side}1`, ribbon);
		ribbon.position.set(0.08, -0.09, 0.03);
		tip.position.y = -0.04;
		const manifest: ManifestInput = {
			specVersion: "0.1",
			assetKind: "attachment",
			components: [
				{
					id: "rig",
					type: "mergeArmature",
					sourceNode: 1,
					target: { asset: "base", path: ["Armature"] },
					prefix: "Coat_",
				},
			],
		};
		const asset = new AvatarAsset(sourceRoot, { manifest }),
			base = new AvatarAsset(baseRoot);
		const rest = ribbon.getWorldPosition(new Vector3());
		const local = ribbon.position.clone();
		const session = new AvatarCompositionSession({ base });
		const result = session.attach(asset, { id: "coat" });
		expect(
			result.resolved.find((r) => r.sourceNode === asset.indices.get(ribbon))
				?.status,
		).toBe("skipped");
		expect(ribbon.parent).toBe(sourceLeg);
		hand.position.y -= 0.5;
		base.scene.updateMatrixWorld(true);
		expect(
			ribbon.getWorldPosition(new Vector3()).distanceTo(rest),
		).toBeLessThan(1e-8);
		baseLeg.position.y += 0.2;
		base.scene.updateMatrixWorld(true);
		expect(ribbon.getWorldPosition(new Vector3()).y).toBeCloseTo(rest.y + 0.2);
		expect(ribbon.position.toArray()).toEqual(local.toArray());
		expect(tip.parent).toBe(ribbon);
		session.detach("coat");
		expect(
			ribbon.getWorldPosition(new Vector3()).distanceTo(rest),
		).toBeLessThan(1e-8);
	},
);

it.each([
	["Coat_Head_end", "Head", true],
	["Coat_head_end", "Head", false],
	["coat_Head_end", "Head", false],
	["Coat_Head_End", "Head", false],
	["Head", "Head", false],
	["Coat_Head_end", "head", false],
	["Coat_Left Hand_end", "Left_Hand", false],
] as const)(
	"matches %s to %s only with exact case and affixes",
	(sourceName, targetName, expected) => {
		const f = setup();
		f.sourceSpine.name = sourceName;
		f.spine.name = targetName;
		// Rebuild the name snapshots after changing the fixture.
		const session = new AvatarCompositionSession({
			base: new AvatarAsset(f.base.scene),
		});
		const asset = new AvatarAsset(f.root, { manifest: f.asset.manifest });
		const result = session.attach(asset, { id: "coat" });
		expect(
			result.resolved.find(
				(r) => r.sourceNode === asset.indices.get(f.sourceSpine),
			)?.status,
		).toBe(expected ? "resolved" : "skipped");
		session.dispose();
	},
);
it("does not search deeper, across branches, or past an unmatched parent", () => {
	const f = setup();
	// Source Spine is below an unmatched Extra, while base Spine is elsewhere.
	f.extra.add(f.sourceSpine);
	const session = new AvatarCompositionSession({ base: f.base });
	const asset = new AvatarAsset(f.root, { manifest: f.asset.manifest });
	const result = session.attach(asset, { id: "coat" });
	expect(result.matchedBones).toBe(1);
	expect(f.sourceSpine.parent).toBe(f.extra);
	expect(f.sourceHead.parent).toBe(f.sourceSpine);
	session.dispose();
});
it("does not find a same-name grandchild of the target parent", () => {
	const f = setup();
	const intermediate = bone("Other", f.hips);
	intermediate.add(f.spine);
	const session = new AvatarCompositionSession({
		base: new AvatarAsset(f.base.scene),
	});
	const result = session.attach(f.asset, { id: "coat" });
	expect(result.matchedBones).toBe(1);
	expect(f.sourceSpine.parent).toBe(f.source);
	session.dispose();
});

it("does not let loader-sanitized names override original exact names", () => {
	const f = setup();
	f.asset.names.set(f.sourceSpine, ["Coat_Spine_end", "Coat_Spine end_end"]);
	f.base.names.set(f.spine, ["Spine", "Spine_end"]);
	const session = new AvatarCompositionSession({ base: f.base });
	const result = session.attach(f.asset, { id: "coat" });
	expect(result.matchedBones).toBe(1);
	session.dispose();
});
it("uses exact exported aliases when loaders rename both sides", () => {
	const f = setup();
	f.asset.names.set(f.sourceSpine, ["Coat_Spine_end", "Coat_Spine Name_end"]);
	f.base.names.set(f.spine, ["Spine", "Spine Name"]);
	const session = new AvatarCompositionSession({ base: f.base });
	const result = session.attach(f.asset, { id: "coat" });
	expect(result.matchedBones).toBe(3);
	session.dispose();
});
