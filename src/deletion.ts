import { BufferAttribute, type BufferGeometry, type Mesh } from "three";
import type { ResolvedOperation } from "./rig.js";

export interface DeleteTarget {
	mesh: Mesh;
	index: number;
	threshold: number;
	diagnostic: NonNullable<ResolvedOperation["deletion"]>;
	fallback(reason: string): void;
}
type Mask = { vertices: number; triangles: Uint8Array; count: number };
type State = {
	source: BufferGeometry;
	copy?: BufferGeometry;
	stamp: unknown[];
	masks: Map<string, Mask | string>;
	selection: string;
};

/** Session-owned index overlays. Source buffers and mesh/skin identities stay intact. */
export class ShapeDeletion {
	private states = new Map<Mesh, State>();
	apply(requests: DeleteTarget[], registered: DeleteTarget[]) {
		const live = new Set(registered.map((r) => r.mesh));
		for (const [mesh, state] of this.states)
			if (!live.has(mesh)) {
				this.release(mesh, state);
				this.states.delete(mesh);
			}
		for (const r of registered)
			Object.assign(r.diagnostic, {
				active: false,
				selectedVertices: 0,
				removedTriangles: 0,
				fallback: undefined,
			});
		const groups = new Map<Mesh, DeleteTarget[]>();
		for (const request of requests) {
			const group = groups.get(request.mesh) ?? [];
			group.push(request);
			groups.set(request.mesh, group);
		}
		for (const [mesh, state] of this.states)
			if (!groups.has(mesh) && mesh.geometry === state.copy)
				mesh.geometry = state.source;
		for (const [mesh, group] of groups) {
			let state = this.states.get(mesh);
			if (!state) {
				state = {
					source: mesh.geometry,
					stamp: [],
					masks: new Map(),
					selection: "",
				};
				this.states.set(mesh, state);
			}
			try {
				if (mesh.geometry !== state.source && mesh.geometry !== state.copy)
					throw new Error(
						"The host replaced the mesh geometry; detach and reattach to use the replacement.",
					);
				const source = state.source;
				const stamp = geometryStamp(source);
				if (
					stamp.length !== state.stamp.length ||
					stamp.some((v, i) => v !== state!.stamp[i])
				) {
					this.release(mesh, state);
					state.stamp = stamp;
					state.masks.clear();
					state.selection = "";
				}
				validateGeometry(source);
				const masks: Mask[] = [];
				const keys: string[] = [];
				for (const r of group) {
					try {
						const key = `${r.index}/${r.threshold}`;
						let mask = state.masks.get(key);
						if (typeof mask === "string") throw new Error(mask);
						if (!mask) {
							try {
								mask = select(source, r.index, r.threshold);
							} catch (error) {
								state.masks.set(
									key,
									error instanceof Error ? error.message : String(error),
								);
								throw error;
							}
							state.masks.set(key, mask);
						}
						masks.push(mask);
						keys.push(key);
						Object.assign(r.diagnostic, {
							active: true,
							selectedVertices: mask.vertices,
							removedTriangles: mask.count,
						});
					} catch (error) {
						this.fallback(r, error);
					}
				}
				if (!masks.some((m) => m.count > 0)) {
					if (mesh.geometry === state.copy) mesh.geometry = source;
					continue;
				}
				const selection = [...new Set(keys)].sort().join(";");
				if (!state.copy) state.copy = source.clone();
				if (selection !== state.selection) {
					filterIndices(source, state.copy, masks);
					state.selection = selection;
				}
				mesh.geometry = state.copy;
			} catch (error) {
				if (mesh.geometry === state.copy) mesh.geometry = state.source;
				for (const r of group) this.fallback(r, error);
			}
		}
	}
	private fallback(request: DeleteTarget, error: unknown) {
		const reason = error instanceof Error ? error.message : String(error);
		Object.assign(request.diagnostic, { active: true, fallback: reason });
		request.fallback(reason);
	}
	private release(mesh: Mesh, state: State) {
		if (mesh.geometry === state.copy) mesh.geometry = state.source;
		state.copy?.dispose();
		state.copy = undefined;
	}
	dispose() {
		for (const [mesh, state] of this.states) this.release(mesh, state);
		this.states.clear();
	}
}

function geometryStamp(g: BufferGeometry): unknown[] {
	const attributes = [
		g.index,
		...Object.values(g.attributes),
		...Object.values(g.morphAttributes).flat(),
	];
	return [
		g.morphTargetsRelative,
		g.drawRange.start,
		g.drawRange.count,
		...g.groups.flatMap((r) => [r.start, r.count, r.materialIndex]),
		...attributes.flatMap((a) => {
			if (!a) return [a];
			return [
				a,
				a.array,
				a.count,
				a.itemSize,
				a.normalized,
				"data" in a ? a.data.version : a.version,
			];
		}),
	];
}
function validateGeometry(g: BufferGeometry) {
	const positions = g.getAttribute("position");
	if (!positions || positions.itemSize < 3)
		throw new Error("Position data is unavailable.");
	const count = g.index?.count ?? positions.count;
	if (count % 3 !== 0 || (g.index && g.index.itemSize !== 1))
		throw new Error("Geometry must contain triangle indices.");
	if (
		g.drawRange.start < 0 ||
		g.drawRange.start % 3 !== 0 ||
		g.drawRange.count < 0 ||
		(g.drawRange.count !== Infinity && g.drawRange.count % 3 !== 0)
	)
		throw new Error("The draw range does not follow triangle boundaries.");
	for (const group of g.groups)
		if (
			group.start < 0 ||
			group.start % 3 !== 0 ||
			group.count < 0 ||
			group.count % 3 !== 0 ||
			group.start + group.count > count
		)
			throw new Error("Material groups do not follow triangle boundaries.");
}
function select(g: BufferGeometry, index: number, threshold: number): Mask {
	const positions = g.getAttribute("position"),
		morph = g.morphAttributes.position?.[index];
	if (!morph || morph.itemSize < 3 || morph.count !== positions.count)
		throw new Error("The blendshape has no compatible position deltas.");
	const vertices = new Uint8Array(positions.count);
	let selected = 0;
	for (let v = 0; v < vertices.length; v++) {
		const x = morph.getX(v) - (g.morphTargetsRelative ? 0 : positions.getX(v));
		const y = morph.getY(v) - (g.morphTargetsRelative ? 0 : positions.getY(v));
		const z = morph.getZ(v) - (g.morphTargetsRelative ? 0 : positions.getZ(v));
		if (![x, y, z].every(Number.isFinite))
			throw new Error("The blendshape contains non-finite position data.");
		if (x * x + y * y + z * z > threshold * threshold) {
			vertices[v] = 1;
			selected++;
		}
	}
	const indexCount = g.index?.count ?? positions.count;
	const triangles = new Uint8Array(indexCount / 3);
	let count = 0;
	for (let i = 0; i < indexCount; i += 3) {
		let remove = false;
		for (let j = 0; j < 3; j++) {
			const vertex = g.index?.getX(i + j) ?? i + j;
			if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertices.length)
				throw new Error("A triangle refers to an invalid vertex.");
			remove ||= !!vertices[vertex];
		}
		if (remove) {
			triangles[i / 3] = 1;
			count++;
		}
	}
	return { vertices: selected, triangles, count };
}
function filterIndices(
	source: BufferGeometry,
	copy: BufferGeometry,
	masks: Mask[],
) {
	const count = source.index?.count ?? source.getAttribute("position").count;
	const indices: number[] = [];
	const offsets = new Uint32Array(count / 3 + 1);
	for (let i = 0; i < count; i += 3) {
		offsets[i / 3] = indices.length;
		if (masks.some((m) => m.triangles[i / 3])) continue;
		for (let j = 0; j < 3; j++)
			indices.push(source.index?.getX(i + j) ?? i + j);
	}
	offsets[count / 3] = indices.length;
	const array =
		source.getAttribute("position").count > 65535
			? new Uint32Array(indices)
			: new Uint16Array(indices);
	// Reuse the allocation across toggles; Three cannot resize an uploaded buffer.
	let buffer = copy.index;
	if (
		!buffer ||
		buffer.array.length !== count ||
		buffer.array.constructor !== array.constructor
	) {
		buffer = new BufferAttribute(
			array instanceof Uint32Array
				? new Uint32Array(count)
				: new Uint16Array(count),
			1,
		);
		copy.setIndex(buffer);
	}
	buffer.array.set(array);
	buffer.needsUpdate = true;
	copy.clearGroups();
	for (const group of source.groups) {
		const start = offsets[group.start / 3],
			end = offsets[(group.start + group.count) / 3];
		copy.addGroup(start, end - start, group.materialIndex);
	}
	const start = Math.min(count, Math.max(0, source.drawRange.start));
	const end = Math.min(count, start + source.drawRange.count);
	copy.setDrawRange(offsets[start / 3], offsets[end / 3] - offsets[start / 3]);
}
