import { useState } from "react";
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
import type {
	AvatarCompositionManifest,
	CompositionWarning,
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
	control: AvatarCompositionManifest["controls"][number];
	item: ViewerItem;
	engine?: ViewerEngine;
}) {
	const value = item.controls[control.id] ?? control.defaultValue;
	const binary =
		typeof control.defaultValue === "boolean" ||
		((control.min ?? 0) === 0 && (control.max ?? 1) === 1);
	if (!binary)
		return (
			<ValueControl
				label={control.label}
				initial={Number(value)}
				min={control.min}
				max={control.max}
				onChange={(v) => engine?.setControl(item.id, control.id, v)}
			/>
		);
	return (
		<label className="flex items-center justify-between gap-3 text-xs">
			<span>{control.label}</span>
			<Switch
				aria-label={control.label}
				checked={Boolean(value)}
				onCheckedChange={(checked) =>
					engine?.setControl(
						item.id,
						control.id,
						typeof control.defaultValue === "boolean"
							? checked
							: checked
								? 1
								: 0,
					)
				}
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
		<div className="space-y-2.5 rounded-md border p-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate text-xs font-medium" title={name}>
						{name}
					</p>
					<p className="text-[10px] text-muted-foreground">
						{blendshapes.length} {t.blendshapes}
					</p>
				</div>
				<Switch
					aria-label={`${t.meshVisibility}: ${name}`}
					checked={visible}
					onCheckedChange={(checked) =>
						engine?.setMeshVisible(item.id, mesh.uuid, checked)
					}
				/>
			</div>
			{blendshapes.length ? (
				<details className="group/blendshapes">
					<summary
						aria-label={`${name} ${t.blendshapes}`}
						className="flex cursor-pointer list-none items-center gap-2 border-t pt-2 text-[11px] text-muted-foreground marker:hidden"
					>
						<CaretRightIcon className="transition-transform group-open/blendshapes:rotate-90" />
						{t.showBlendshapes}
					</summary>
					<div className="mt-3 space-y-4">
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
										{(mesh.morphTargetInfluences?.[morphIndex] ?? 0).toFixed(2)}
									</span>
								</div>
							),
						)}
					</div>
				</details>
			) : (
				<p className="border-t pt-2 text-[11px] text-muted-foreground">
					{t.noBlendshapes}
				</p>
			)}
		</div>
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
	const controls = item.asset.manifest?.controls ?? [];
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
			<section className="space-y-3">
				<h3 className="text-xs font-medium">{t.meshes}</h3>
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
			</section>
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
