import { expect, it, vi } from "vitest";
import { Bone, Group, Object3D, Vector3 } from "three";
import type { VRM } from "@pixiv/three-vrm";
import {
	AvatarAsset,
	AvatarCompositionSession,
	parseManifest,
} from "../src/index.js";

it("keeps VRM collider ownership and updates attachment springs after the base pose", () => {
	const baseRoot = new Group(),
		baseBone = new Bone(),
		sourceRoot = new Group(),
		sourceBone = new Bone();
	baseBone.name = sourceBone.name = "Hair";
	baseRoot.add(baseBone);
	sourceRoot.add(sourceBone);
	const baseGroups = [{ colliders: [new Object3D()] }],
		sourceGroups = [{ colliders: [new Object3D()] }];
	const joint = { bone: sourceBone, colliderGroups: sourceGroups };
	const order: string[] = [];
	const manager = {
		joints: new Set([joint]),
		colliders: sourceGroups[0].colliders,
		deleteJoint: vi.fn(),
		addJoint: vi.fn(),
		setInitState: vi.fn(),
		reset: vi.fn(),
		update: vi.fn(() => {
			order.push("springs");
			expect(sourceBone.getWorldPosition(new Vector3()).y).toBe(2);
		}),
	};
	const humanoidUpdate = vi.fn();
	const base = new AvatarAsset(baseRoot, {
		vrm: {
			springBoneManager: {
				joints: new Set([{ bone: baseBone, colliderGroups: baseGroups }]),
			},
		} as unknown as VRM,
	});
	const attachment = new AvatarAsset(sourceRoot, {
		vrm: {
			springBoneManager: manager,
			humanoid: { update: humanoidUpdate },
			expressionManager: { update: () => order.push("expressions") },
			nodeConstraintManager: { update: () => order.push("constraints") },
		} as unknown as VRM,
		manifest: {
			specVersion: "0.1",
			assetKind: "attachment",
			components: [
				{
					id: "rig",
					type: "mergeArmature",
					sourceNode: 1,
					target: { asset: "base", boneKeywords: ["Hair"] },
				},
			],
		},
	});
	const session = new AvatarCompositionSession({ base });
	session.attach(attachment, { id: "hair" });
	expect(manager.setInitState).toHaveBeenCalledOnce();
	session.beforeVrmUpdate();
	baseBone.position.y = 2;
	order.push("base pose");
	baseRoot.updateMatrixWorld(true);
	session.afterVrmUpdate(1 / 60);
	expect(order).toEqual(["base pose", "expressions", "constraints", "springs"]);
	expect(humanoidUpdate).not.toHaveBeenCalled();
	expect(joint.colliderGroups).toBe(sourceGroups);
	expect(
		base.vrm!.springBoneManager!.joints.values().next().value!.colliderGroups,
	).toBe(baseGroups);
	session.setItemState("hair", { visible: false });
	session.afterVrmUpdate(1 / 60);
	expect(manager.update).toHaveBeenCalledOnce();
	session.detach("hair");
	expect(sourceBone.parent).toBe(sourceRoot);
	expect(joint.colliderGroups).toBe(sourceGroups);
	expect(manager.setInitState).toHaveBeenCalledTimes(2);
	session.dispose();
});

it("rejects removed collider-link and precomputed rig records", () => {
	const header = { specVersion: "0.1", assetKind: "attachment" };
	expect(() =>
		parseManifest({ ...header, actions: [{ type: "collider.link" }] }),
	).toThrow();
	expect(() =>
		parseManifest({
			...header,
			rig: { role: "attachmentReference", jointMappings: [] },
		}),
	).toThrow();
});
