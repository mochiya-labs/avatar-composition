import { defineConfig } from "tsup";
export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	// Distribute compiled code and declarations without the original sources.
	sourcemap: false,
	clean: true,
	target: "es2022",
	external: ["three", /^three\//, "@pixiv/three-vrm"],
});
