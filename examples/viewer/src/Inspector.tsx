import { useState } from "react";
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { ViewerEngine, ViewerItem, ViewerSnapshot } from "./engine";
import type { Labels } from "./i18n";
import type { AvatarAssetManifest } from "@mochiya/avatar-asset-runtime";

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
	control: AvatarAssetManifest["controls"][number];
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
	const warnings = [...view.warnings, ...(item.result?.warnings ?? [])];
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
			{item.id === "base" && (
				<>
					<Separator />
					<section className="space-y-4">
						<h3 className="text-xs font-medium">{t.morphs}</h3>
						<p className="text-[11px] leading-relaxed text-muted-foreground">
							{t.fitHint}
						</p>
						{item.asset.meshes.flatMap((mesh) =>
							Object.entries(mesh.morphTargetDictionary ?? {}).map(
								([name, index]) => (
									<ValueControl
										key={`${item.id}-${mesh.uuid}-${index}`}
										label={`${mesh.name} · ${name}`}
										initial={mesh.morphTargetInfluences?.[index] ?? 0}
										onChange={(v) => engine?.setMorph(mesh.name, name, v)}
									/>
								),
							),
						)}
					</section>
				</>
			)}
			{item.id === "base" && item.asset.vrm && (
				<>
					<Separator />
					<section className="space-y-4">
						<h3 className="text-xs font-medium">{t.expressions}</h3>
						{item.asset.vrm.expressionManager?.expressions.map((expression) => (
							<ValueControl
								key={`${item.asset.scene.uuid}-${expression.expressionName}`}
								label={expression.expressionName}
								onChange={(v) =>
									engine?.setExpression(expression.expressionName, v)
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
					)}{" "}
					{warnings.length ? `${t.review} (${warnings.length})` : t.noWarnings}
				</h3>
				{warnings.map((warning, i) => (
					<div
						key={`${warning.code}-${i}`}
						className="space-y-1 rounded-md border bg-muted/40 p-2.5"
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
			</section>
		</div>
	);
}
