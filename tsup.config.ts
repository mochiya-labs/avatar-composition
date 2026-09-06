import { defineConfig } from "tsup";
export default defineConfig({
	entry: ["src/index.ts", "src/liltoon.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "es2022",
	external: ["three", "@pixiv/three-vrm", "three-liltoon"],
});
