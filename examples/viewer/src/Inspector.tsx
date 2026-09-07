import { useEffect, useState } from "react";
import {
	CaretRightIcon,
	CheckCircleIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import type { Bone, Mesh } from "three";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { ViewerEngine, ViewerItem, ViewerSnapshot } from "./engine";
import type { Labels } from "./i18n";
import {
	menuItems,
	type MenuItem,
	type CompositionComponent,
	type CompositionWarning,
	type Condition,
	type Selector,
} from "@mochiya/avatar-composition";

export function ValueControl({
	label,
	initial = 0,
	max = 1,
	min = 0,
	onChange,
}: {
	label: string;
	initial?: number;
	max?: number;
	min?: number;
	onChange(value: number): void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<div className="space-y-2.5">
			<div className="flex justify-between gap-2 text-xs">
				<span className="truncate" title={label}>
					{label}
				</span>
				<output className="text-muted-foreground tabular-nums">
					{value.toFixed(2)}
				</output>
			</div>
			<Slider
				aria-label={label}
				min={min}
				max={max}
				step={0.01}
				value={[value]}
				onValueChange={([v]) => {
					setValue(v);
					onChange(v);
				}}
			/>
		</div>
	);
}

function AssetControl({
	control,
	item,
	engine,
}: {
	control: MenuItem;
	item: ViewerItem;
	engine?: ViewerEngine;
}) {
	const key = control.parameter ?? control.id;
	const groupDefault =
		menuItems(item.asset.manifest).find(
			(c) => (c.parameter ?? c.id) === key && Number(c.defaultValue) !== 0,
		)?.defaultValue ?? control.defaultValue;
	const value = item.controls[key] ?? groupDefault;
	useEffect(() => {
		if (control.controlType !== "button" || !engine) return;
		const release = () => {
			const state = engine.getSnapshot();
			const current =
				item.id === "base"
					? state.base
					: state.attachments.find((entry) => entry.id === item.id);
			if (
				current?.asset === item.asset &&
				Number(current.controls[key] ?? 0) !== 0
			)
				engine.setControl(item.id, key, 0);
		};
		window.addEventListener("blur", release);
		return () => {
			window.removeEventListener("blur", release);
			release();
		};
	}, [engine, item.id, item.asset, key, control.controlType]);
	const set = (value: number) => engine?.setControl(item.id, key, value);
	if (control.controlType === "button")
		return (
			<button
				type="button"
				className="w-full rounded-md border px-3 py-2 text-xs hover:bg-muted"
				aria-label={control.label}
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId);
					set(control.value);
				}}
				onPointerUp={() => set(0)}
				onPointerCancel={() => set(0)}
				onLostPointerCapture={() => set(0)}
				onBlur={() => set(0)}
				onKeyDown={(event) => {
					if (event.key === " " || event.key === "Enter") {
						event.preventDefault();
						set(control.value);
					}
				}}
				onKeyUp={(event) => {
					if (event.key === " " || event.key === "Enter") set(0);
				}}
			>
				{control.label}
			</button>
		);
	return (
		<label className="flex items-center justify-between gap-3 text-xs">
			<span>{control.label}</span>
			<Switch
				aria-label={control.label}
				checked={Number(value) === control.value}
				onCheckedChange={(checked) => set(checked ? control.value : 0)}
			/>
		</label>
	);
}

function WarningAccordion({
	title,
	warnings,
}: {
	title: string;
	warnings: CompositionWarning[];
}) {
	if (!warnings.length) return null;
	return (
		<details className="group overflow-hidden rounded-md border bg-muted/20">
			<summary
				aria-label={`${title} (${warnings.length})`}
				className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium marker:hidden"
			>
				<CaretRightIcon className="shrink-0 transition-transform group-open:rotate-90" />
				<span className="min-w-0 flex-1 truncate">{title}</span>
				<Badge variant="outline">{warnings.length}</Badge>
			</summary>
			<div className="space-y-2 border-t p-2">
				{warnings.map((warning, index) => (
					<div
						key={`${warning.code}-${index}`}
						className="space-y-1 rounded-md bg-muted/60 p-2.5"
					>
						<p className="text-[10px] font-medium">
							{warning.code}
							{warning.operation ? ` · ${warning.operation}` : ""}
						</p>
						<p className="break-words text-[11px] leading-relaxed text-muted-foreground">
							{warning.message}
						</p>
						{warning.query && (
							<p className="break-words text-[10px] text-muted-foreground">
								{[
									...(warning.query.boneKeywords ?? []),
									...(warning.query.blendshapeKeywords ?? []),
								].join(", ")}
							</p>
						)}
					</div>
				))}
			</div>
		</details>
	);
}

function BoneBranch({ bone, boneSet }: { bone: Bone; boneSet: Set<Bone> }) {
	const children = [...boneSet]
		.filter((child) => parentBone(child, boneSet) === bone)
		.sort((a, b) => a.name.localeCompare(b.name));
	const name = bone.name || "(unnamed)";
	return (
		<li>
			{children.length ? (
				<details>
					<summary className="cursor-pointer py-0.5 text-[11px]">
						{name}
					</summary>
					<ul className="ml-2 border-l pl-3">
						{children.map((child) => (
							<BoneBranch key={child.uuid} bone={child} boneSet={boneSet} />
						))}
					</ul>
				</details>
			) : (
				<span className="block py-0.5 text-[11px]">{name}</span>
			)}
		</li>
	);
}

function parentBone(bone: Bone, boneSet: Set<Bone>): Bone | undefined {
	for (let parent = bone.parent; parent; parent = parent.parent)
		if ((parent as Bone).isBone && boneSet.has(parent as Bone))
			return parent as Bone;
	return undefined;
}

function BoneTree({ bones }: { bones: Bone[] }) {
	const boneSet = new Set(bones);
	const roots = bones
		.filter((bone) => !parentBone(bone, boneSet))
		.sort((a, b) => a.name.localeCompare(b.name));
	return (
		<ul className="space-y-0.5">
			{roots.map((bone) => (
				<BoneBranch key={bone.uuid} bone={bone} boneSet={boneSet} />
			))}
		</ul>
	);
}

function MeshCard({
	engine,
	item,
	mesh,
	index,
	t,
}: {
	engine?: ViewerEngine;
	item: ViewerItem;
	mesh: Mesh;
	index: number;
	t: Labels;
}) {
	const name = mesh.name || `${t.unnamedMesh} ${index + 1}`;
	const blendshapes = Object.entries(mesh.morphTargetDictionary ?? {}).sort(
		([a], [b]) => a.localeCompare(b),
	);
	const visible = mesh.visible && !item.hiddenMeshes.has(mesh.uuid);
	return (
		<div className="relative rounded-md border">
			<details className="group/blendshapes">
				<summary
					aria-label={`${name} ${t.blendshapes}`}
					className="flex cursor-pointer list-none items-center gap-2 py-2.5 pl-3 pr-16 text-xs marker:hidden"
				>
					<CaretRightIcon className="shrink-0 transition-transform group-open/blendshapes:rotate-90" />
					<span className="min-w-0 flex-1 truncate font-medium" title={name}>
						{name}
					</span>
					<Badge variant="outline" title={t.blendshapes}>
						{blendshapes.length}
					</Badge>
				</summary>
				<div className="space-y-4 border-t p-3">
					{blendshapes.length ? (
						<>
							{blendshapes.map(([blendshape, morphIndex]) =>
								item.id === "base" ? (
									<ValueControl
										key={blendshape}
										label={blendshape}
										initial={mesh.morphTargetInfluences?.[morphIndex] ?? 0}
										onChange={(value) =>
											engine?.setMorph(mesh.name, blendshape, value)
										}
									/>
								) : (
									<div
										key={blendshape}
										className="flex justify-between gap-2 text-[11px]"
									>
										<span className="min-w-0 truncate" title={blendshape}>
											{blendshape}
										</span>
										<span className="text-muted-foreground tabular-nums">
											{(mesh.morphTargetInfluences?.[morphIndex] ?? 0).toFixed(
												2,
											)}
										</span>
									</div>
								),
							)}
						</>
					) : (
						<p className="text-[11px] text-muted-foreground">
							{t.noBlendshapes}
						</p>
					)}
				</div>
			</details>
			<Switch
				className="absolute right-3 top-2.5"
				aria-label={`${t.meshVisibility}: ${name}`}
				checked={visible}
				onCheckedChange={(checked) =>
					engine?.setMeshVisible(item.id, mesh.uuid, checked)
				}
			/>
		</div>
	);
}

function localNodeLabel(item: ViewerItem, node: number) {
	const object = item.asset.nodes.get(node);
	const aliases = object ? (item.asset.names.get(object) ?? []) : [];
	const authoredAliases =
		item.asset.manifest?.nodes.find((entry) => entry.node === node)?.aliases ??
		[];
	const names = [
		...new Set([object?.name, ...aliases, ...authoredAliases]),
	].filter((name): name is string => Boolean(name));
	return names.length ? `${names.join(" / ")} (#${node})` : `#${node}`;
}

function selectorEntries(selector: Selector, item: ViewerItem, t: Labels) {
	const entries: [string, string][] = [];
	if (selector.path !== undefined)
		entries.push(["path", selector.path.join("/") || "/"]);
	if (selector.node !== undefined)
		entries.push([t.node, localNodeLabel(item, selector.node)]);
	if (selector.morphIndex !== undefined)
		entries.push([t.morphIndex, String(selector.morphIndex)]);
	if (selector.humanBone) entries.push([t.humanBone, selector.humanBone]);
	if (selector.humanBonePath?.length)
		entries.push(["humanBonePath", selector.humanBonePath.join(" / ")]);
	for (const [label, values] of [
		[t.boneKeywords, selector.boneKeywords],
		[t.meshKeywords, selector.meshKeywords],
		[t.nodeKeywords, selector.nodeKeywords],
		[t.blendshapeKeywords, selector.blendshapeKeywords],
		[t.parentKeywords, selector.parentKeywords],
	] as const)
		if (values?.length) entries.push([label, values.join(", ")]);
	return entries;
}

function SelectorDebug({
	label,
	selector,
	item,
	t,
}: {
	label: string;
	selector: Selector;
	item: ViewerItem;
	t: Labels;
}) {
	return (
		<div className="space-y-1.5 rounded-md bg-muted/60 p-2.5">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					{label}
				</span>
				<Badge variant={selector.asset === "base" ? "default" : "outline"}>
					{selector.asset === "base" ? t.baseAsset : t.thisAsset}
				</Badge>
			</div>
			{selectorEntries(selector, item, t).map(([key, value]) => (
				<div
					key={key}
					className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-[11px]"
				>
					<span className="text-muted-foreground">{key}</span>
					<span className="break-words font-mono text-[10px]">{value}</span>
				</div>
			))}
		</div>
	);
}

function ConditionDebug({
	condition,
	item,
	t,
}: {
	condition: Condition;
	item: ViewerItem;
	t: Labels;
}) {
	const values = [
		condition.control && `${t.controlId}: ${condition.control}`,
		condition.node !== undefined &&
			`${t.node}: ${localNodeLabel(item, condition.node)}`,
		condition.nodeKeywords?.length &&
			`${t.nodeKeywords}: ${condition.nodeKeywords.join(", ")}`,
		condition.value !== undefined && `${t.value}: ${String(condition.value)}`,
		condition.inverse && t.inverted,
	].filter(Boolean);
	return (
		<div className="text-[10px] text-muted-foreground">
			{t.condition}: {condition.type} ·{" "}
			{condition.asset === "base" ? t.baseAsset : t.thisAsset}
			{values.length ? ` · ${values.join(" · ")}` : ""}
		</div>
	);
}

function InstructionValue({
	name,
	value,
	item,
	t,
}: {
	name: string;
	value: unknown;
	item: ViewerItem;
	t: Labels;
}) {
	if (value && typeof value === "object" && "asset" in value)
		return (
			<SelectorDebug
				label={name}
				selector={value as Selector}
				item={item}
				t={t}
			/>
		);
	if (Array.isArray(value))
		return (
			<div className="space-y-2">
				<p className="text-[10px] font-medium">
					{name} ({value.length})
				</p>
				{value.map((entry, i) => (
					<div className="space-y-2 border-l pl-2" key={i}>
						<InstructionValue
							name={String(i)}
							value={entry}
							item={item}
							t={t}
						/>
					</div>
				))}
			</div>
		);
	if (value && typeof value === "object")
		return (
			<div className="space-y-2">
				{Object.entries(value).map(([key, v]) => (
					<InstructionValue key={key} name={key} value={v} item={item} t={t} />
				))}
			</div>
		);
	return (
		<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-[10px]">
			<span className="text-muted-foreground">{name}</span>
			<span className="break-words font-mono">{String(value)}</span>
		</div>
	);
}
function ComponentDebug({
	component,
	item,
	t,
}: {
	component: CompositionComponent;
	item: ViewerItem;
	t: Labels;
}) {
	const { id, type, sourceNode, ...settings } = component;
	const condition = "condition" in component ? component.condition : undefined;
	const resolved = item.resolved.filter((r) => r.componentId === id);
	return (
		<details className="rounded-md border" data-component-id={id}>
			<summary className="cursor-pointer break-words p-3 text-xs">
				<Badge variant="outline">{type}</Badge> {id}
			</summary>
			<div className="space-y-3 border-t p-3">
				<p className="break-words font-mono text-[10px]">
					{localNodeLabel(item, sourceNode)}
				</p>
				{condition && (
					<ConditionDebug condition={condition} item={item} t={t} />
				)}
				<InstructionValue
					name="settings"
					value={Object.fromEntries(
						Object.entries(settings).filter(([key]) => key !== "condition"),
					)}
					item={item}
					t={t}
				/>
				<div className="space-y-2 border-t pt-2">
					<h4 className="text-xs font-medium">
						{t.resolvedOperations} ({resolved.length})
					</h4>
					{resolved.map((r, i) => (
						<div
							key={i}
							className="break-words text-[10px]"
							data-rig-link={r.operation === "bone" ? "bone" : undefined}
						>
							<Badge variant="outline">
								{r.status === "resolved" ? t.matched : t.skipped}
							</Badge>{" "}
							{r.sourceNode !== undefined
								? localNodeLabel(item, r.sourceNode)
								: r.operation}{" "}
							→ {r.target || "—"}
						</div>
					))}
				</div>
			</div>
		</details>
	);
}
function CompositionExtensionDebug({
	item,
	t,
}: {
	item: ViewerItem;
	t: Labels;
}) {
	const manifest = item.asset.manifest;
	if (!manifest) return null;
	return (
		<>
			<Separator />
			<details className="group" data-section="composition-extension">
				<summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium marker:hidden">
					<CaretRightIcon className="transition-transform group-open:rotate-90" />
					<span className="min-w-0 flex-1">{t.compositionExtension}</span>
					<Badge variant="outline">{manifest.components.length}</Badge>
				</summary>
				<div className="mt-3 space-y-3">
					<p className="font-mono text-[11px]">
						{manifest.specVersion} · <span>{manifest.assetKind}</span> ·{" "}
						<span>{manifest.rig?.role}</span>
					</p>
					<p className="text-[10px] text-muted-foreground">
						{t.requiredCapabilities}
					</p>
					<div className="flex flex-wrap gap-1">
						{manifest.requiredCapabilities.map((c) => (
							<Badge key={c} variant="outline">
								{c}
							</Badge>
						))}
					</div>
					{manifest.components.map((c) => (
						<ComponentDebug key={c.id} component={c} item={item} t={t} />
					))}
					<details className="rounded-md border">
						<summary className="cursor-pointer p-3 text-[11px]">
							{t.rawManifest}
						</summary>
						<pre className="max-h-80 overflow-auto border-t bg-muted/40 p-3 text-[9px]">
							{JSON.stringify(manifest, null, 2)}
						</pre>
					</details>
				</div>
			</details>
		</>
	);
}

export function Inspector({
	engine,
	item,
	view,
	t,
}: {
	engine?: ViewerEngine;
	item?: ViewerItem;
	view: ViewerSnapshot;
	t: Labels;
}) {
	if (!item)
		return (
			<p className="p-5 text-xs leading-relaxed text-muted-foreground">
				{t.none}
			</p>
		);
	const warnings = [
		...view.warnings,
		...item.warnings,
		...(item.result?.warnings ?? []),
	];
	const lilToonWarnings = warnings.filter(
		(warning) => warning.code === "LILTOON",
	);
	const compositionWarnings = warnings.filter(
		(warning) => warning.code !== "LILTOON",
	);
	const controls = menuItems(item.asset.manifest);
	return (
		<div className="space-y-5 p-4">
			<div>
				<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
					{t.selected}
				</p>
				<h2 className="break-words text-sm font-semibold">{item.label}</h2>
				<div className="mt-2 flex flex-wrap gap-1">
					<Badge variant="outline">{item.asset.vrm ? "VRM" : "GLB"}</Badge>
					<Badge variant="outline">
						{item.asset.meshes.length} {t.meshes}
					</Badge>
					<Badge variant="outline">
						{item.asset.bones.length} {t.bones}
					</Badge>
				</div>
			</div>
			{item.asset.vrm && (
				<>
					<Separator />
					<section className="space-y-3">
						<h3 className="text-xs font-medium">{t.debugVisualizers}</h3>
						<label className="flex items-center justify-between gap-3 text-xs">
							<span>{t.showDebugVisualizers}</span>
							<Switch
								aria-label={`${t.showDebugVisualizers} ${item.label}`}
								checked={item.debugVisualizersVisible}
								onCheckedChange={(checked) =>
									engine?.setDebugVisualizers(item.id, checked)
								}
							/>
						</label>
						<p className="text-[11px] leading-relaxed text-muted-foreground">
							{t.debugVisualizersHint}
						</p>
					</section>
				</>
			)}
			{item.result && (
				<>
					<Separator />
					<section className="space-y-3">
						<h3 className="text-xs font-medium">{t.report}</h3>
						<div className="grid grid-cols-2 gap-2">
							<div className="rounded-md bg-muted px-3 py-2">
								<strong className="text-lg tabular-nums">
									{item.result.matchedBones}
									<span className="text-xs font-normal text-muted-foreground">
										{" "}
										/ {item.result.requestedBones}
									</span>
								</strong>
								<p className="text-[10px] text-muted-foreground">
									{t.bones} {t.matched}
								</p>
							</div>
							<div className="rounded-md bg-muted px-3 py-2">
								<strong className="text-lg tabular-nums">
									{item.result.appliedActions}
								</strong>
								<p className="text-[10px] text-muted-foreground">{t.actions}</p>
							</div>
						</div>
						<p className="text-[11px] leading-relaxed text-muted-foreground">
							{t.warningHint}
						</p>
					</section>
				</>
			)}
			<CompositionExtensionDebug item={item} t={t} />
			<Separator />
			<section className="space-y-4">
				<h3 className="text-xs font-medium">{t.control}</h3>
				{controls.length ? (
					controls.map((control) => (
						<AssetControl
							key={`${item.id}-${control.id}`}
							control={control}
							item={item}
							engine={engine}
						/>
					))
				) : (
					<p className="text-xs text-muted-foreground">{t.emptyControls}</p>
				)}
			</section>
			<Separator />
			<details
				className="group/meshes"
				data-section="meshes"
				key={item.asset.scene.uuid}
			>
				<summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium marker:hidden">
					<CaretRightIcon className="transition-transform group-open/meshes:rotate-90" />
					<span className="min-w-0 flex-1">{t.meshes}</span>
					<Badge variant="outline">{item.asset.meshes.length}</Badge>
				</summary>
				<div className="mt-3 space-y-2">
					{item.asset.meshes.map((mesh, index) => (
						<MeshCard
							key={mesh.uuid}
							engine={engine}
							item={item}
							mesh={mesh}
							index={index}
							t={t}
						/>
					))}
				</div>
			</details>
			<Separator />
			<details className="group" data-section="bones">
				<summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium marker:hidden">
					<CaretRightIcon className="transition-transform group-open:rotate-90" />
					<span className="flex-1">{t.boneHierarchy}</span>
					<Badge variant="outline">{item.asset.bones.length}</Badge>
				</summary>
				<div className="mt-3 rounded-md border bg-muted/20 p-3">
					<BoneTree bones={item.asset.bones} />
				</div>
			</details>
			{item.id === "base" && item.asset.vrm && (
				<>
					<Separator />
					<section className="space-y-4">
						<h3 className="text-xs font-medium">{t.expressions}</h3>
						{item.asset.vrm.expressionManager?.expressions.map((expression) => (
							<ValueControl
								key={`${item.asset.scene.uuid}-${expression.expressionName}`}
								label={expression.expressionName}
								onChange={(value) =>
									engine?.setExpression(expression.expressionName, value)
								}
							/>
						))}
					</section>
				</>
			)}
			<Separator />
			<section className="space-y-3" aria-label={t.review}>
				<h3 className="flex items-center gap-2 text-xs font-medium">
					{warnings.length ? (
						<WarningCircleIcon size={15} />
					) : (
						<CheckCircleIcon size={15} />
					)}
					{warnings.length ? `${t.review} (${warnings.length})` : t.noWarnings}
				</h3>
				<WarningAccordion
					title={t.lilToonWarnings}
					warnings={lilToonWarnings}
				/>
				<WarningAccordion
					title={t.compositionWarnings}
					warnings={compositionWarnings}
				/>
			</section>
		</div>
	);
}
