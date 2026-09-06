# Mochiya Avatar Composition

Compose a base avatar with clothing, hair and other **attachments** in Three.js, with reversible rig binding, fit settings and controls. This package is the maintenance home of the **`MOCHIYA_avatar_composition` glTF extension**, its schema and runtime behavior.

```mermaid
flowchart LR
  Unity["Mochiya Unity exporter"] --> File["Avatar or attachment<br/>VRM / GLB + Mochiya data"]
  File --> Loader["GLTFLoader + Mochiya plugin"]
  Loader --> Session["AvatarCompositionSession<br/>one base + attachments"]
  VRM["three-vrm<br/>standard VRM behavior"] --> Session
  Session --> View["Host scene and animation loop"]
  LilToon["Any material library<br/>host-owned rendering"] --> View
```

## Avatar or attachment

The runtime follows the Unity exporter's declared kind, including when an attachment contains a humanoid rig.

| `assetKind`  | Unity export rule                                                                                                     | Runtime role                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `avatar`     | Own VRM-compatible humanoid and no external Modular Avatar (MA) dependency. May include clothing and child armatures. | Session base; included content stays together. |
| `attachment` | Needs its direct parent's humanoid or has external MA dependencies/effects. That parent must be a valid avatar.       | Added with `session.attach()`.                 |

Both converted kinds carry the extension when exported through Mochiya. Conversion preserves separate armatures; MA owns Unity-side merging. Files without the extension can use host-selected roles and bone-name attachment, without recovered MA actions.

## Extension capabilities

`MOCHIYA_avatar_composition` **0.1** adds attachment relationships and portable actions to glTF/VRM. It lives at the document root, listed in `extensionsUsed`; unaware viewers display the model without these overlays. Geometry, skinning and standard VRM expressions/physics remain in their ordinary formats.

| Capability       | Extension data          | Behavior and limit                                                                                                               |
| ---------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `rig.bind`       | `rig.jointMappings`     | Follow base bones while retaining skins/offsets. Unmatched bones retain their rig.                                               |
| `rig.attach`     | `rig.attachmentRoots`   | Parent a local root to a base target; preserve world offset or snap.                                                             |
| `morph.override` | `actions`               | Reversible blendshape fit values, using Unity weight / 100.                                                                      |
| `morph.sync`     | `actions`               | Copy blendshape values with linear/step remapping. No sync chains or cycles.                                                     |
| `node.active`    | `actions`               | Conditional visibility with ancestor awareness. No reactive visibility cycles.                                                   |
| `material.swap`  | `actions`               | Replace a material slot with a file-local alternative.                                                                           |
| `control`        | `controls` + conditions | Numeric/boolean inputs with defaults. No shared MA parameter network.                                                            |
| `collider.link`  | `actions`               | Share VRM colliders with spring joints through explicit links. No automatic cross-asset collisions or experimental angle limits. |

### Data and matching

| Field or rule              | Meaning                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `specVersion`, `assetKind` | Required: `0.1` and `avatar`/`attachment`. Optional `rig.role` is `avatar`/`attachmentReference` respectively.                     |
| `requiredCapabilities`     | Operations the consumer must support.                                                                                              |
| `matching`, `nodes`        | Armature hints, local node aliases and initial active states.                                                                      |
| `asset: "self"`            | Local node/morph indices. Material indices also address only the current file.                                                     |
| `asset: "base"`            | Bone/mesh/node/blendshape keywords; optional parent hints and humanoid-bone fallback.                                              |
| Conditions                 | Local control or logical node activation, optionally inverted.                                                                     |
| Precedence                 | Base first, then ascending attachment `layerOrder` and instance ID; `sourceOrder` within assets. Later writers win; overlaps warn. |

**Matching is best effort:** missing/ambiguous names skip only affected operations with warnings. No identity, checksum, body-shape or minimum-match gate applies. Good fit still needs suitable geometry, skin weights, bind matrices and rest transforms. Malformed records, invalid local references, unsupported required capabilities and wrong session roles are errors.

Example root-extension fragment: apply a body fit blendshape while the attachment is active.

```json
{
	"extensionsUsed": ["MOCHIYA_avatar_composition"],
	"extensions": {
		"MOCHIYA_avatar_composition": {
			"specVersion": "0.1",
			"assetKind": "attachment",
			"requiredCapabilities": ["morph.override"],
			"actions": [
				{
					"id": "fit-torso",
					"type": "morph.override",
					"target": {
						"asset": "base",
						"meshKeywords": ["Body"],
						"blendshapeKeywords": ["HideTorso"]
					},
					"value": 1
				}
			]
		}
	}
}
```

Contract: [JSON Schema](schema/MOCHIYA_avatar_composition.schema.json) (exported as `@mochiya/avatar-composition/schema`) and [TypeScript schema](src/schema.ts). Author only current values; `parseManifest()` additionally normalizes legacy `outfit`/`accessory` and `outfitReference` without modifying input.

## Install and try

Use Node.js 20.19+ for the viewer. A normal install uses the published `@mochiya/three-liltoon` package:

```sh
cd avatar-asset-runtime
npm install
npm run build
npm run viewer:dev
# Optional: package the library for installation in another application.
npm pack
```

To test unpublished changes from a sibling `three-liltoon/` checkout, build that package and apply a local install without changing the committed manifest or lockfile:

```sh
npm --prefix ../three-liltoon run build:package
npm run viewer:use-local-liltoon
npm run viewer:dev
```

Run `npm install` again to restore the published dependency recorded in the lockfile. Clean npm and Vercel installs always use the registry package.

Open Vite's URL (normally `http://127.0.0.1:5175`). **Load avatar**, then **Add attachment** using your VRM/GLB files. Select an asset to inspect its controls and matching results; hide or remove attachments to undo their effects. For any selected VRM, **Show debug visualizers** displays its available humanoid, look-at, constraint, spring-joint and collider helpers. This setting is independent for each asset and starts off. Optional base animations use VRMA files. All files stay in the browser.

The viewer starts empty, with Assets, Preview and Inspector always available. Panels stack below the preview on small screens. Lighting and the ground grid use fixed defaults; no demo models or stage settings are included.

Install the tarball in your application with these example peer versions:

```sh
npm install /path/to/mochiya-avatar-composition-0.1.0.tgz three@0.185.1 @pixiv/three-vrm@3.5.5
```

## Use in Three.js

The host supplies `scene`, the base animation `mixer` and render loop. Await loading before preparing assets. The core has no material-library dependency.

```ts
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
	MochiyaAvatarCompositionLoaderPlugin,
	prepareAvatarAsset,
	AvatarCompositionSession,
	disposeAvatarAsset,
} from "@mochiya/avatar-composition";

const loader = new GLTFLoader()
	.register((p) => new VRMLoaderPlugin(p))
	.register((p) => new MochiyaAvatarCompositionLoaderPlugin(p));

async function load(url: string) {
	const gltf = await loader.loadAsync(url);
	if (gltf.userData.vrm) VRMUtils.rotateVRM0(gltf.userData.vrm);
	return prepareAvatarAsset(gltf);
}

const base = await load("/avatar.vrm");
const attachment = await load("/attachment.vrm");
scene.add(base.scene, attachment.scene);
const session = new AvatarCompositionSession({ base });
const result = session.attach(attachment, { id: "coat", layerOrder: 0 });
console.log(result.status, result.warnings); // attached | partial | unbound

function update(delta: number) {
	// Call once per rendered frame.
	session.beforeVrmUpdate();
	mixer?.update(delta);
	base.vrm?.update(delta);
	scene.updateMatrixWorld(true);
	session.afterVrmUpdate(delta);
	const updated = new Set(base.vrm?.materials ?? []);
	for (const material of attachment.vrm?.materials ?? []) {
		if (!attachment.scene.visible || updated.has(material)) continue;
		updated.add(material);
		(
			material as typeof material & { update?: (delta: number) => void }
		).update?.(delta);
	}
}

function hideAttachment() {
	session.setItemState("coat", { visible: false });
}
function cleanup() {
	session.detach("coat");
	disposeAvatarAsset(attachment);
	session.dispose();
	disposeAvatarAsset(base);
}
```

Controls: `setItemState(id, { controls: { controlId: value } })`, `setBaseControl()` and `setBaseMorph()`. The session advances attachment expressions/constraints/springs; update the whole VRM only on the base. Plain GLB has no VRM physics.

Use independent loaded instances per attachment. Detach before disposal; session disposal restores overlays without freeing assets. Changing bases requires a new session and renewed matching.

### Materials and ownership

| Concern                          | Responsibility                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Material swaps                   | Core assigns file-local materials and restores the original binding. No shader-specific bridge.                                                                                |
| glTF primitive                   | Replaces its entire material binding, including loader-expanded arrays; undo restores the original array and geometry groups.                                                  |
| Procedural meshes                | Swaps only the selected material slot. Pass `authoredObjects` when the scene includes generated helpers.                                                                       |
| Rendering and material animation | Host and chosen material library. `base.vrm.update()` advances base materials; advance visible attachment materials once in the host loop.                                     |
| Disposal                         | `prepareAvatarAsset()` captures owned parser resources. Detach before disposal. Procedural assets accept explicit `resources`; omit shared resources managed by another owner. |

The core never inspects shader uniforms or custom texture caches. `disposeAvatarAsset()` releases its resource snapshot once, so later material swaps cannot make it dispose a borrowed material. Procedural default ownership includes geometry, skeletons and materials; declare textures explicitly with `resources` when the asset owns them.

### Optional lilToon rendering

Install `@mochiya/three-liltoon` in the **application** and configure it independently. The sample viewer demonstrates this setup; the core works without the material package.

```ts
import { enableLilToon } from "@mochiya/three-liltoon";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import { enableLilToonVRM } from "@mochiya/three-liltoon/vrm";

const releaseRendering = enableLilToon(renderer); // Once per renderer owner.
const loader = new GLTFLoader()
	.register((p) => enableLilToonVRM(new VRMLoaderPlugin(p)))
	.register((p) => new MochiyaAvatarCompositionLoaderPlugin(p));
// Use this loader with the load(), session and frame loop above.
// On teardown: dispose the session and assets, then releaseRendering().
```

The material plugin reads only `MOCHIYA_materials_liltoon`; the Mochiya plugin reads only `MOCHIYA_avatar_composition`. The helper enhances the standard VRM plugin with material loading and expression bindings; it also loads ordinary glTF/GLB without requiring VRM data. Outlines and casters follow ordinary material assignments automatically. Omitting lilToon leaves ordinary glTF fallback materials and attachment behavior available. See the [viewer engine](examples/viewer/src/engine.ts) for the complete lifecycle.

## Contributing

Run `npm run format` after code changes and `npm run format:check` before submitting them. VS Code uses the same Prettier settings on save; generated files and local Unity assets are excluded.

Browser tests generate minimal VRM/GLB inputs in memory; no model binaries are needed in the repository. Unity export validation belongs to the companion exporter's Editor tests.

Edit `src/schema.ts`, regenerate the JSON Schema with `build`, and align exporter mappings. Geometry cutting, arbitrary MA/VRC controllers and automatic body-shape adaptation are outside this package's scope.

```sh
npm run build
npm run typecheck
npm test
npm run viewer:build
npm run test:browser
```
