import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Grid } from "@react-three/drei";
import { NeutralToneMapping, SRGBColorSpace } from "three";
import { ViewerEngine, type ViewerSnapshot } from "./engine";

interface StageProps {
	onEngine(engine: ViewerEngine | undefined): void;
	view: ViewerSnapshot;
	dark: boolean;
	frame: number;
}
function Scene({ onEngine, view, dark, frame }: StageProps) {
	const { scene, gl } = useThree();
	const engine = useRef<ViewerEngine | undefined>(undefined);
	const controls = useRef<CameraControls>(null);
	useEffect(() => {
		const next = new ViewerEngine(scene, gl);
		engine.current = next;
		onEngine(next);
		if (import.meta.env.DEV) Reflect.set(window, "mochiyaViewer", next);
		return () => {
			if (Reflect.get(window, "mochiyaViewer") === next)
				Reflect.deleteProperty(window, "mochiyaViewer");
			engine.current = undefined;
			next.dispose();
			onEngine(undefined);
		};
	}, [scene, gl, onEngine]);
	useEffect(() => {
		if (view.base)
			void controls.current?.fitToBox(view.base.asset.scene, true, {
				paddingTop: 0.15,
				paddingBottom: 0.08,
				paddingLeft: 0.2,
				paddingRight: 0.2,
			});
	}, [view.base?.asset, frame]);
	useFrame((_, delta) => engine.current?.update(delta));
	return (
		<>
			<color attach="background" args={[dark ? "#23251f" : "#f3f4ed"]} />
			<hemisphereLight args={["#e0faff", "#fff0db", 0.5]} />
			<directionalLight
				position={[-0.5, 3, 2]}
				intensity={1.75}
				castShadow
				shadow-mapSize={[2048, 2048]}
				shadow-camera-left={-3}
				shadow-camera-right={3}
				shadow-camera-top={3}
				shadow-camera-bottom={-3}
				shadow-bias={-0.0001}
			/>
			<mesh
				rotation={[-Math.PI / 2, 0, 0]}
				position={[0, -0.005, 0]}
				receiveShadow
			>
				<planeGeometry args={[200, 200]} />
				<shadowMaterial opacity={0.12} />
			</mesh>
			<Grid
				args={[30, 30]}
				position={[0, -0.004, 0]}
				cellSize={0.25}
				sectionSize={1}
				cellColor={dark ? "#42463a" : "#d6dbcd"}
				sectionColor={dark ? "#5b604f" : "#b8c1aa"}
				fadeDistance={15}
				infiniteGrid
			/>
			<CameraControls
				ref={controls}
				minDistance={0.4}
				maxDistance={20}
				makeDefault
			/>
		</>
	);
}
export function Stage(props: StageProps) {
	return (
		<Canvas
			shadows
			dpr={[1, 2]}
			camera={{ position: [0, 1.4, 5.5], fov: 26, near: 0.01, far: 300 }}
			gl={{
				antialias: true,
				toneMapping: NeutralToneMapping,
				outputColorSpace: SRGBColorSpace,
			}}
		>
			<Scene {...props} />
		</Canvas>
	);
}
