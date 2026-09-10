# MOCHIYA_avatar_composition 0.1

Draft glTF 2.0 extension for composing an avatar with attachments. This document defines behavior; the [JSON Schema](../schema/MOCHIYA_avatar_composition.schema.json) defines JSON structure. The runtime's TypeScript schema generates that JSON Schema. Consumers also validate references and execution graphs.

The current draft replaces the earlier action/joint-mapping draft. Re-export older files. There is no legacy reader.

## Scope and placement

Put the extension on the glTF document root and list its name in `extensionsUsed`. A consumer without support can display the ordinary model. Do not depend on this extension for standard skinning, VRM expressions, physics or materials: those remain glTF/VRM data. Cross-asset collider linking is outside this specification.

```json
{
	"extensionsUsed": ["MOCHIYA_avatar_composition"],
	"extensions": {
		"MOCHIYA_avatar_composition": {
			"specVersion": "0.1",
			"assetKind": "attachment",
			"requiredCapabilities": ["mergeArmature", "shapeChanger"],
			"components": [
				{
					"id": "coat-rig",
					"type": "mergeArmature",
					"sourceNode": 12,
					"origin": "modularAvatar",
					"target": {
						"asset": "base",
						"path": ["Armature"],
						"boneKeywords": ["Armature"]
					},
					"prefix": "Coat_",
					"lockMode": "unidirectional"
				},
				{
					"id": "fit",
					"type": "shapeChanger",
					"sourceNode": 4,
					"condition": { "type": "nodeActive", "node": 4 },
					"shapes": [
						{
							"target": {
								"asset": "base",
								"meshKeywords": ["Body"],
								"blendshapeKeywords": ["HideTorso"]
							},
							"changeType": "set",
							"value": 1
						}
					]
				}
			]
		}
	}
}
```

The example assumes local nodes 4 and 12 exist in the containing glTF.

## Root and references

| Field                  | Meaning                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `specVersion`          | Required literal `"0.1"`.                                                                        |
| `assetKind`            | Required `avatar` or `attachment`. A reference humanoid does not change an attachment's role.    |
| `rig.role`             | Optional role hint: `avatar` or `attachmentReference`. Contains no bone-pair table.              |
| `requiredCapabilities` | Component types a consumer must support. An unknown required capability is an error.             |
| `matching`             | Optional `mode: "keywordBestEffort"`, `onUnresolved: "warnAndContinue"`, and `armatureKeywords`. |
| `nodes`                | Optional local node indices with `aliases` and initial `active` state (default true).            |
| `components`           | Ordered component records (default empty). Every `id` must be unique within the file.            |

| Selector                     | Reference semantics                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asset: "self"`              | Requires a file-local glTF `node` index. Morph references also require a final mesh `morphIndex`. Material indices address this file's `materials`.                   |
| `asset: "base"`              | Never contains another file's node/morph index. Uses `path`, bone/mesh/node/blendshape keywords, optional `parentKeywords`, and optional `humanBone`/`humanBonePath`. |
| `path`                       | Array of ancestor names relative to the authored avatar root; an empty array explicitly means the root. It is a structural hint, not an identity requirement.         |
| `humanBone`, `humanBonePath` | VRM humanoid bone name and optional path below it; retained from MA Bone Proxy for fallback.                                                                          |

All node indices must survive export. A serializer whose glTF writer omits the scene container must materialize a node when a component references that container. Preserve source aliases and initial active states; inactive option geometry must remain available. Alternate materials/textures used only by components must also be exported.

Resolve external targets by hierarchy and names, with Unicode/case/separator normalization and left/right distinctions. Prefer an exact hierarchy path; otherwise rank exact, normalized, token and substring names. Mesh hints refine blendshape matches; a uniquely named shape may match another mesh with a warning. Split primitives belonging to one authored glTF node form one mesh target. Remaining ties or missing targets warn and skip only the unresolved entry. There is no checksum, base identity, minimum match count, topology or body-shape gate.

## Component records

Every record has `id`, `type`, and file-local `sourceNode` identifying the GameObject on which the instruction was authored. Optional `origin` is `authored` (default), `modularAvatar`, `referenceRig` or `colliderAnchor`; origin records provenance and does not alter execution.

| Type / MA source                   | Fields and defaults                                                                                                             | Execution                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mergeArmature` / Merge Armature   | `target`; `prefix`, `suffix` (empty); `lockMode` (`unidirectional`); `mangleNames` (true)                                       | Resolve the source root and target root, then discover descendant pairs. No exported per-bone mapping.                                              |
| `boneProxy` / Bone Proxy           | `target`; `attachmentMode` (`keepWorldPose`); `matchScale` (false)                                                              | Attach the source root to the resolved base target. `atRoot` matches target position/rotation and preserves source world scale.                     |
| `shapeChanger` / Shape Changer     | `shapes: [{target, changeType, value}]`; `changeType` is `set` or `delete`, value defaults to 0; `threshold` defaults to `0.01` | Set writes a normalized weight. Delete removes affected triangles reversibly, using the rules below.                                                |
| `blendshapeSync` / Blendshape Sync | `bindings: [{driver, driven, curve?}]`                                                                                          | Read the driver after expression/fit updates and copy/remap to the driven shape.                                                                    |
| `objectToggle` / Object Toggle     | `objects: [{target, value}]` with Boolean value                                                                                 | Apply logical object visibility, including original ancestor visibility after bones move.                                                           |
| `materialSetter` / Material Setter | `objects: [{target, slot, material}]`                                                                                           | Replace the specified material slot using a file-local alternative. No shader-specific interpretation.                                              |
| `menuItem` / Menu Item             | `label`, `controlType` (`toggle` or `button`); optional `parameter`; `value` (1), `defaultValue` (0), `automatic` (true)        | Expose an asset-local input keyed by parameter or component ID. Automatic items drive their source node's activation when the input equals `value`. |

### Armatures and physics

Strip the configured prefix/suffix from descendant names before matching. Prefer matching children beneath the resolved parent; broaden the search beneath the target root when needed. If the root is missing, a global base search may recover descendants. Missing intermediate bones do not end traversal. Another component's source root starts an independent traversal; mesh subtrees are not treated as bone chains.

The runtime implements **unidirectional base-to-attachment following**. `bidirectional` and `notLocked` retain the MA setting but MUST warn and fall back to unidirectional behavior. These values describe MA's authoring position-lock setting; this runtime does not reproduce MA's build-time skeleton collapse. It retains the source bones, skin weights, inverse-bind matrices and rest offsets. `mangleNames` is retained as intent; independent instance ownership avoids name mutation. Local-to-local merges are preserved as records but warn and remain unapplied.

Bone Proxy `keepPosition`, `keepRotation` or `matchScale: true` are currently compatibility fallbacks: warn and keep world pose. Singular transforms warn and keep the source rig. Remove generated offset helpers and restore parent, sibling order and transforms on detach.

Generated `referenceRig` records let a copied parent skeleton follow the base without exporting a pair table. Generated `colliderAnchor` proxies follow external collider roots copied into the attachment. Springs and collider groups still belong to their own VRM; composition never links one file's colliders to another file's joints.

### Shape Changer deletion

`threshold` is a finite, non-negative position distance in the **matched mesh's exported local coordinates**, independent of its current morph weight, pose or world scale. The extension stores names and settings, not vertex masks or a required base identity. Missing `threshold` means `0.01`; re-export older assets to retain a custom MA threshold.

| Rule                | Required behavior                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vertex selection    | Use the matched morph's position displacement from rest. For relative morphs, read the delta directly; for absolute morphs, subtract the base position. Select when `dx² + dy² + dz² > threshold²`. A zero threshold selects any nonzero displacement.          |
| Triangle selection  | Remove a triangle if **any** vertex is selected. Decode sparse/normalized attributes before comparison. Apply to each matched primitive of the authored mesh. The result is independent of material type.                                                       |
| Precedence          | Process Set/Delete in the usual asset, component and entry order. Set writes its weight and cancels an earlier Delete on that shape. Delete activates filtering without changing any preceding Set weight. Later entries win the deletion state for that shape. |
| Competing deletions | For each matched mesh and shape, use the minimum threshold of all registered Delete entries, including inactive entries, as MA does. Union the winning masks for different shapes; do not count an overlapping triangle twice in the final geometry.            |
| Synchronization     | Successful Delete does not modify morph weights or propagate deletion through Blendshape Sync. Set values still synchronize normally. The Delete entry's `value` is retained metadata and has no effect on selection.                                           |
| Restoration         | Withdraw filtering when conditions become false or the attachment is hidden/removed. Recompute the union of remaining masks and restore original geometry when none remain. Preserve skinning, morph indices, material slots and source buffers.                |
| Compatibility       | Missing names warn and skip only that entry. If a matched morph lacks usable position/topology data, MUST warn and use reversible weight **0** for that entry. Continue supported deletions on other targets.                                                   |

The reference runtime uses session-owned index overlays with adjusted material groups and draw ranges; it retains vertex buffers and conservative bounds. Normal rendering, shadows and ordinary Three.js raycasting use the filtered geometry. Masks are cached until source attribute/index versions, layout or ranges change. Host code must flag buffer edits with `needsUpdate`; replacing `mesh.geometry` during an overlay warns and uses the fallback without overwriting the replacement. Detach and reattach to compile that replacement. Session disposal releases copies, never source assets.

MA checks all Unity frames in a blendshape. glTF morphs contain one displacement per vertex, so lost frames, quantization, and baking scale/current weights can change selection. The Unity exporter preserves the authored threshold and warns about multi-frame morphs and metric-changing Freeze Mesh settings. General Mesh Cutter filters, vertex compaction, sealed cut boundaries and smaller downloads are outside this feature.

### Conditions, remaps and controls

| Rule             | Behavior                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conditions       | Shape Changer, Blendshape Sync, Object Toggle and Material Setter accept an optional `condition`. Without it, the component is active whenever the asset is visible.                                                                                             |
| `nodeActive`     | Test the indicated node and its authored ancestors. Local `node` defaults to `asset: "self"`; base targets use paths/keywords. Optional `inverse` negates the resolved state. An unresolved external condition disables its entries, even when inverted.         |
| `control`        | Test an input keyed by a menu ID or parameter. Optional `value` compares numerically; otherwise test truthiness. Optional `inverse` negates it.                                                                                                                  |
| Remaps           | `curve` contains `interpolation: "linear"` or `"step"` and increasing `[input, output]` points. No curve means identity. Linear end segments extrapolate; steps clamp at endpoints. MA uses linear control points; Unity weights/coordinates are divided by 100. |
| Toggle           | Write the authored `value` when on and 0 when off. Items sharing a parameter share state within the asset instance; a nonzero authored default initializes that group.                                                                                           |
| Button           | The host writes `value` while held and **0 on release/cancel**. Buttons are momentary and should start at 0.                                                                                                                                                     |
| Named parameters | Retained as local state/metadata; no automatic object activation when `automatic` is false. Warn that arbitrary Animator effects, networking and saving are not executed.                                                                                        |

For a local `nodeActive` condition, also test the nearest `menuItem` on that node or an authored ancestor: its local input must equal the menu's value. Inversion applies to the combined node/menu condition. This lets named menu parameters gate reactive descendants without an Animator or an automatic visibility change. The Unity adapter exports reactive source-node activation and inversion, including components on the asset root; Blendshape Sync is unconditional, matching MA's source behavior. Menu hierarchy, parameter renaming and arbitrary Animator graphs are outside this profile.

## Evaluation and diagnostics

1. Parse structural data and validate local references.
2. Resolve component targets and compile private runtime operations without rewriting the manifest.
3. Resolve and apply base-to-attachment links transactionally.
4. Before the base VRM update, restore previous overlays and evaluate visibility/material changes. The host advances the base animation and VRM once.
5. Advance attachment expressions, constraints and springs, then evaluate Set/Delete states, geometry overlays and blendshape synchronization. Do not advance the attachment humanoid as another base animation driver.
6. Hiding/removing an attachment withdraws its writes. Detach restores its hierarchy and spring initialization; disposal belongs to the host.

Within each phase, process the base first, then attachments in ascending layer order and stable instance ID. Component and entry array order determines order within an asset. Fit overrides run before synchronization. Later writers win, with overlap warnings. Chained/cyclic sync and cyclic visibility conditions are execution errors; malformed data and invalid local indices are also errors. Missing external names remain noncritical warnings.

Expose authored records separately from resolved operations: component ID, matched source/target, skipped status and warning. Delete diagnostics include whether the entry won the active deletion state, its selected vertex/removed triangle counts, and any fallback reason. Counts describe each entry across its matched primitives, before union with other shapes. Do not write resolved pairs back into the extension. The current runtime exposes `session.resolved` for base components and `attachment.resolved` for attachment components.

## Source references

The mappings follow MA's public components, within the limits above: [Merge Armature](https://modular-avatar.nadena.dev/docs/reference/merge-armature), [Bone Proxy](https://modular-avatar.nadena.dev/docs/reference/bone-proxy), [Blendshape Sync](https://modular-avatar.nadena.dev/docs/reference/blendshape-sync), [reactive components](https://modular-avatar.nadena.dev/docs/reference/reaction), and [Menu Item](https://modular-avatar.nadena.dev/docs/reference/menu-item).
