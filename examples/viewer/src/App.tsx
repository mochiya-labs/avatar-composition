import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	ArrowsOutIcon,
	EyeIcon,
	EyeSlashIcon,
	FilePlusIcon,
	InfoIcon,
	PauseIcon,
	PlayIcon,
	PlusIcon,
	TShirtIcon,
	TrashIcon,
	UserIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "next-themes";
import { ViewerHeader } from "./components/viewer-header";
import { useViewerLocale } from "./use-viewer-locale";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Stage } from "./Stage";
import { ViewerEngine, type ViewerItem, type ViewerSnapshot } from "./engine";
import { Inspector } from "./Inspector";
import { messages, type Labels } from "./i18n";

const empty: ViewerSnapshot = {
	attachments: [],
	busy: 0,
	warnings: [],
	paused: false,
};
const subscribeEmpty = () => () => {};
function IconButton({
	label,
	children,
	onClick,
}: {
	label: string;
	children: React.ReactNode;
	onClick(): void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={label}
					onClick={onClick}
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
function AssetRow({
	item,
	selected,
	engine,
	t,
}: {
	item: ViewerItem;
	selected: boolean;
	engine?: ViewerEngine;
	t: Labels;
}) {
	return (
		<div
			className={`group flex items-center gap-1 rounded-lg border p-1.5 ${selected ? "border-primary/60 bg-primary/10" : "border-transparent hover:bg-muted/60"}`}
		>
			<Button
				variant="ghost"
				className="h-auto min-w-0 flex-1 justify-start gap-2 py-1"
				onClick={() => engine?.select(item.id)}
			>
				<span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
					{item.id === "base" ? (
						<UserIcon className="size-5!" />
					) : (
						<TShirtIcon className="size-5!" />
					)}
				</span>
				<span className="min-w-0 text-left">
					<span className="block truncate text-xs font-medium">
						{item.label}
					</span>
					<span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
						{item.result
							? item.result.status === "attached"
								? t.attached
								: item.result.status === "partial"
									? t.partialStatus
									: t.unbound
							: t.current}
					</span>
				</span>
			</Button>
			{item.id !== "base" && (
				<IconButton
					label={`${item.visible ? t.hide : t.show} ${item.label}`}
					onClick={() => engine?.toggle(item.id)}
				>
					{item.visible ? <EyeIcon /> : <EyeSlashIcon />}
				</IconButton>
			)}
			<IconButton
				label={`${t.remove} ${item.label}`}
				onClick={() => engine?.remove(item.id)}
			>
				<TrashIcon />
			</IconButton>
		</div>
	);
}
export default function App() {
	const [engine, setEngine] = useState<ViewerEngine>();
	const onEngine = useCallback(
		(value: ViewerEngine | undefined) => setEngine(value),
		[],
	);
	const view = useSyncExternalStore(
		engine?.subscribe ?? subscribeEmpty,
		engine?.getSnapshot ?? (() => empty),
	);
	const { locale, setLocale } = useViewerLocale();
	const t: Labels = messages[locale];
	const { resolvedTheme } = useTheme();
	const dark = resolvedTheme === "dark";
	const [frame, setFrame] = useState(0);
	const baseInput = useRef<HTMLInputElement>(null);
	const attachmentInput = useRef<HTMLInputElement>(null);
	const animationInput = useRef<HTMLInputElement>(null);
	const reduceMotion = useReducedMotion();
	const selected =
		view.selected === "base"
			? view.base
			: view.attachments.find((x) => x.id === view.selected);
	const choose = (kind: "base" | "attachment" | "animation") =>
		(kind === "base"
			? baseInput
			: kind === "attachment"
				? attachmentInput
				: animationInput
		).current?.click();
	const input = (kind: "base" | "attachment" | "animation", file?: File) => {
		if (file)
			void (kind === "base"
				? engine?.loadBase(file)
				: kind === "attachment"
					? engine?.loadAttachment(file)
					: engine?.loadAnimation(file));
	};
	return (
		<TooltipProvider>
			<div
				className={
					(dark ? "dark " : "") + "viewer-shell bg-background text-foreground"
				}
				lang={locale}
			>
				<ViewerHeader
					title={t.title}
					locale={locale}
					onLocaleChange={setLocale}
					t={t}
				/>
				<input
					ref={baseInput}
					type="file"
					accept=".vrm,.glb"
					aria-label="Base avatar file"
					className="sr-only"
					onChange={(e) => {
						input("base", e.currentTarget.files?.[0]);
						e.currentTarget.value = "";
					}}
				/>
				<input
					ref={attachmentInput}
					type="file"
					accept=".vrm,.glb"
					aria-label="Attachment file"
					className="sr-only"
					onChange={(e) => {
						input("attachment", e.currentTarget.files?.[0]);
						e.currentTarget.value = "";
					}}
				/>
				<input
					ref={animationInput}
					type="file"
					accept=".vrma"
					aria-label="Animation file"
					className="sr-only"
					onChange={(e) => {
						input("animation", e.currentTarget.files?.[0]);
						e.currentTarget.value = "";
					}}
				/>
				<div className="viewer-workspace">
					<aside
						className="asset-sidebar flex min-w-0 flex-col bg-background"
						aria-label={t.assets}
					>
						<header className="flex h-12 shrink-0 items-center border-b px-4">
							<h2 className="text-xs font-medium">{t.assets}</h2>
						</header>
						<div className="min-h-0 overflow-y-auto p-3">
							<section className="space-y-3">
								<div className="flex items-center justify-between">
									<h3 className="text-xs font-medium">{t.base}</h3>
									<Button
										variant="ghost"
										size="icon"
										aria-label={t.loadBase}
										disabled={!engine}
										onClick={() => choose("base")}
									>
										<PlusIcon />
									</Button>
								</div>
								{view.base ? (
									<AssetRow
										item={view.base}
										selected={view.selected === "base"}
										engine={engine}
										t={t}
									/>
								) : (
									<Button
										variant="outline"
										className="h-20 w-full flex-col gap-2 border-dashed"
										disabled={!engine}
										onClick={() => choose("base")}
									>
										<FilePlusIcon className="size-5!" />
										{t.loadBase}
									</Button>
								)}
							</section>
							<section className="mt-6 space-y-3">
								<h3 className="text-xs font-medium">
									{t.attachment}
									<span className="ml-2 text-muted-foreground">
										{view.attachments.length}
									</span>
								</h3>
								{view.attachments.map((item) => (
									<AssetRow
										key={item.id}
										item={item}
										selected={view.selected === item.id}
										engine={engine}
										t={t}
									/>
								))}
								{!view.attachments.length && (
									<p className="py-2 text-[11px] leading-relaxed text-muted-foreground">
										{t.noAttachments}
									</p>
								)}
								<Button
									variant="outline"
									className="w-full"
									disabled={!view.base}
									onClick={() => choose("attachment")}
								>
									<PlusIcon />
									{t.loadAttachment}
								</Button>
							</section>
							<p className="mt-4 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
								<InfoIcon className="mt-0.5 size-3 shrink-0" />
								{t.libraryHint}
							</p>
						</div>
					</aside>
					<main
						className="viewer-main relative flex min-h-0 min-w-0 flex-col"
						aria-label={t.preview}
						onDragOver={(e) => e.preventDefault()}
						onDrop={(e) => {
							e.preventDefault();
							input(view.base ? "attachment" : "base", e.dataTransfer.files[0]);
						}}
					>
						<div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
							<div className="flex items-center gap-2 text-xs">
								<span className="inline-block size-1.5 rounded-full bg-primary" />
								{t.preview}
								<Badge variant="secondary">
									{view.base ? 1 + view.attachments.length : 0}
								</Badge>
							</div>
							<IconButton
								label={t.frame}
								onClick={() => setFrame((value) => value + 1)}
							>
								<ArrowsOutIcon />
							</IconButton>
						</div>
						<div className="relative min-h-64 flex-1" data-testid="viewport">
							<Stage
								onEngine={onEngine}
								view={view}
								dark={dark}
								frame={frame}
							/>
							<AnimatePresence>
								{!view.base && (
									<motion.div
										key="empty"
										className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										exit={{ opacity: 0 }}
										transition={{ duration: reduceMotion ? 0 : 0.18 }}
									>
										<div className="pointer-events-auto max-w-80 rounded-xl border bg-background/95 p-6 text-center shadow-sm">
											<div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-primary/15 text-primary-foreground">
												<UserIcon size={25} />
											</div>
											<h2 className="text-base font-semibold">{t.emptyBase}</h2>
											<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
												{t.emptyHint}
											</p>
											<Button
												className="mt-5 w-full"
												size="lg"
												disabled={!engine}
												onClick={() => choose("base")}
											>
												<PlusIcon />
												{t.loadBase}
											</Button>
										</div>
									</motion.div>
								)}
							</AnimatePresence>
							{view.busy > 0 && (
								<div
									role="status"
									className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border bg-background px-4 py-2 text-xs shadow-sm"
								>
									{t.working}
								</div>
							)}
							{view.error && (
								<div
									role="alert"
									className="absolute inset-x-4 bottom-4 rounded-lg border border-destructive/30 bg-background p-3 text-xs"
								>
									<p className="flex items-center gap-2 font-medium text-destructive">
										<WarningCircleIcon />
										{t.error}
									</p>
									<p className="mt-1 break-words leading-relaxed text-muted-foreground">
										{view.error}
									</p>
								</div>
							)}
							<div className="pointer-events-none absolute bottom-3 left-3 text-[10px] text-muted-foreground">
								{t.desktop}
							</div>
						</div>
						<div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
							<div className="flex min-w-0 items-center gap-2">
								<IconButton
									label={view.paused ? t.play : t.pause}
									onClick={() => engine?.pause()}
								>
									{view.paused ? <PlayIcon /> : <PauseIcon />}
								</IconButton>
								<div className="min-w-0">
									<p className="text-[10px] text-muted-foreground">
										{t.animation}
									</p>
									<p className="max-w-44 truncate text-xs">
										{view.animation ?? t.idle}
									</p>
								</div>
							</div>
							<Button
								variant="outline"
								disabled={!view.base?.asset.vrm}
								onClick={() => choose("animation")}
							>
								<PlusIcon />
								{t.loadAnimation}
							</Button>
						</div>
					</main>
					<aside
						className="inspector-sidebar min-w-0 overflow-y-auto bg-background"
						aria-label={t.inspector}
					>
						<header className="sticky top-0 z-10 flex h-12 items-center border-b bg-background px-4">
							<h2 className="text-xs font-medium">{t.inspector}</h2>
						</header>
						<Inspector
							key={selected?.id}
							engine={engine}
							item={selected}
							view={view}
							t={t}
						/>
					</aside>
				</div>
			</div>
		</TooltipProvider>
	);
}
