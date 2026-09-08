import { expect, it, vi } from "vitest";
import {
	AnimationClip,
	BoxGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	NumberKeyframeTrack,
} from "three";
import type { VRM } from "@pixiv/three-vrm";
import {
	AvatarAsset,
	AvatarCompositionSession,
	type ManifestInput,
} from "../src/index.js";

function fixture(manifest?: ManifestInput, events: string[] = []) {
	const root = new Group();
	const geometry = new BoxGeometry();
	geometry.morphAttributes.position = [geometry.attributes.position.clone()];
	geometry.morphAttributes.position[0].name = "Fit";
	const mesh = new Mesh(geometry, new MeshBasicMaterial());
	mesh.name = "Body";
	root.add(mesh);
	const vrm = {
		scene: root,
		humanoid: { resetNormalizedPose: vi.fn() },
		update: vi.fn(() => {
			events.push("base");
			mesh.morphTargetInfluences![0] = 0;
		}),
		expressionManager: {
			update: () => {
				events.push("attachment expression");
				mesh.morphTargetInfluences![0] = 0;
			},
		},
		nodeConstraintManager: {
			update: () => events.push("attachment constraints"),
		},
	} as unknown as VRM;
	return { root, mesh, vrm, asset: new AvatarAsset(root, { manifest, vrm }) };
}
it("preserves explicit mesh edits across VRM expressions and defers to active composition writers", () => {
	const base = fixture();
	const attachment = fixture({
		specVersion: "0.1",
		assetKind: "attachment",
		components: [
			{
				id: "fit",
				type: "shapeChanger",
				sourceNode: 0,
				shapes: [
					{
						target: {
							asset: "base",
							meshKeywords: ["Body"],
							blendshapeKeywords: ["Fit"],
						},
						changeType: "set",
						value: 0.8,
					},
				],
			},
		],
	});
	const session = new AvatarCompositionSession({ base: base.asset });
	expect(session.setMorph(base.mesh, 0, 0.3)).toBe(true);
	session.update(1 / 60);
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.3);
	session.attach(attachment.asset, { id: "coat" });
	expect(session.isMorphControlled(base.mesh, 0)).toBe(true);
	expect(session.setMorph(base.mesh, 0, 0.1)).toBe(false);
	session.update(1 / 60);
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.8);
	session.setMorph(attachment.mesh, 0, 0.2, { deferEvaluation: true });
	// Editing another mesh must not briefly unwind the active base override.
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.8);
	session.setItemState("coat", { visible: false });
	expect(session.isMorphControlled(base.mesh, 0)).toBe(false);
	session.update(1 / 60);
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.3);
	session.detach("coat");
	expect(() => session.setMorph(attachment.mesh, 0, 0.5)).toThrow("not owned");
	session.dispose();
});
it("rewrites an explicit morph only when a VRM update changed its weight", () => {
	const base = fixture();
	const session = new AvatarCompositionSession({ base: base.asset });
	session.setMorph(base.mesh, 0, 0.3);
	const writes: number[] = [];
	base.mesh.morphTargetInfluences = new Proxy(
		base.mesh.morphTargetInfluences!,
		{
			set(target, property, value: number) {
				if (property === "0") writes.push(value);
				return Reflect.set(target, property, value);
			},
		},
	);
	vi.mocked(base.vrm.update).mockImplementation(() => undefined);
	session.update(1 / 60);
	expect(writes).toEqual([]);
	vi.mocked(base.vrm.update).mockImplementation(() => {
		base.mesh.morphTargetInfluences![0] = 0;
	});
	session.update(1 / 60);
	expect(writes).toEqual([0, 0.3]);
	session.dispose();
});
it("locks attachment weights driven by base synchronization", () => {
	const base = fixture();
	const attachment = fixture({
		specVersion: "0.1",
		assetKind: "attachment",
		components: [
			{
				id: "sync",
				type: "blendshapeSync",
				sourceNode: 0,
				bindings: [
					{
						driver: { asset: "base", blendshapeKeywords: ["Fit"] },
						driven: { asset: "self", node: 1, morphIndex: 0 },
					},
				],
			},
		],
	});
	const session = new AvatarCompositionSession({ base: base.asset });
	session.attach(attachment.asset, { id: "hair" });
	expect(session.isMorphControlled(attachment.mesh, 0)).toBe(true);
	expect(session.setMorph(attachment.mesh, 0, 0.6)).toBe(false);
	session.setMorph(base.mesh, 0, 0.4, { deferEvaluation: true });
	expect(base.mesh.morphTargetInfluences![0]).toBe(0.4);
	expect(attachment.mesh.morphTargetInfluences![0]).toBe(0);
	session.update(0.016);
	expect(attachment.mesh.morphTargetInfluences![0]).toBe(0.4);
	session.dispose();
});
it("owns one base animation mixer, restores time, pauses playback, and advances attachments after the base", () => {
	const events: string[] = [];
	const base = fixture(undefined, events),
		attachment = fixture(undefined, events);
	const session = new AvatarCompositionSession({ base: base.asset });
	session.attach(attachment.asset, { id: "coat" });
	const clip = new AnimationClip("Move", 2, [
		new NumberKeyframeTrack(".position[x]", [0, 2], [0, 2]),
	]);
	session.setAnimation(clip, 0.5);
	expect(base.root.position.x).toBeCloseTo(0.5);
	session.update(0.25);
	expect(session.animationTime).toBeCloseTo(0.75);
	expect(events).toEqual([
		"base",
		"attachment expression",
		"attachment constraints",
	]);
	expect(attachment.vrm.update).not.toHaveBeenCalled();
	session.update(0.25, true);
	expect(session.animationTime).toBeCloseTo(0.75);
	session.setAnimation(null);
	expect(session.animationTime).toBe(0);
	expect(base.root.position.x).toBe(0);
	expect(() => session.setAnimation(clip, NaN)).toThrow();
	expect(() => session.update(-1)).toThrow();
	session.dispose();
	session.dispose();
	expect(() => session.update(0)).toThrow();
});
