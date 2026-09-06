import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"@mochiya/avatar-asset-runtime": fileURLToPath(
				new URL("../../src/index.ts", import.meta.url),
			),
		},
		dedupe: [
			"three",
			"react",
			"react-dom",
			"@pixiv/three-vrm",
			"three-liltoon",
		],
	},
	build: { sourcemap: true },
});
