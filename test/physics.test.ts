import { expect, it } from "vitest";
import { Bone, Group, Object3D } from "three";
import type { VRM } from "@pixiv/three-vrm";
import { AvatarAsset, AvatarCompositionSession } from "../src/index.js";

it("applies collider links before physics and restores them on hide/detach", () => {
	const baseRoot = new Group(),
		jointBone = new Bone();
	jointBone.name = "Hair";
	baseRoot.add(jointBone);
	const original: unknown[] = [],
		joint = { bone: jointBone, colliderGroups: original };
	const base = new AvatarAsset(baseRoot, {
		vrm: {
			springBoneManager: { joints: new Set([joint]), colliders: [] },
		} as unknown as VRM,
	});
	const attachmentRoot = new Group(),
		collider = new Object3D();
	attachmentRoot.add(collider);
	const attachment = new AvatarAsset(attachmentRoot, {
		nodes: new Map([[0, collider]]),
		vrm: {
			springBoneManager: {
				colliders: [collider],
				joints: new Set(),
				deleteJoint() {},
				addJoint() {},
				setInitState() {},
				reset() {},
			},
		} as unknown as VRM,
		manifest: {
			specVersion: "0.1",
			assetKind: "attachment",
			actions: [
				{
					id: "physics",
					type: "collider.link",
					target: { asset: "base", boneKeywords: ["Hair"] },
					collider: { asset: "self", node: 0 },
				},
			],
		},
	});
	const session = new AvatarCompositionSession({ base });
	session.attach(attachment, { id: "hat" });
	session.beforeVrmUpdate();
	expect(joint.colliderGroups).toHaveLength(1);
	session.beforeVrmUpdate();
	expect(joint.colliderGroups).toHaveLength(1);
	session.setItemState("hat", { visible: false });
	expect(joint.colliderGroups).toBe(original);
	session.setItemState("hat", { visible: true });
	expect(joint.colliderGroups).toHaveLength(1);
	session.detach("hat");
	expect(joint.colliderGroups).toBe(original);
	session.dispose();
});
