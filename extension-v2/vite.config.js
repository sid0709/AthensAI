import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve, dirname } from "path";
import { copyFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		react(),
		{
			name: "copy-files",
			closeBundle: () => {
				mkdirSync("dist/icons", { recursive: true });

				copyFileSync("manifest.json", "dist/manifest.json");

				copyFileSync(
					"public/icons/icon16.png",
					"dist/icons/icon16.png"
				);
				copyFileSync(
					"public/icons/icon48.png",
					"dist/icons/icon48.png"
				);
				copyFileSync(
					"public/icons/icon128.png",
					"dist/icons/icon128.png"
				);

			},
		},
	],
	build: {
		rollupOptions: {
			input: {
				sidepanel: resolve(__dirname, "index.html"),
				background: resolve(__dirname, "src/background.js"),
				contentScript: resolve(__dirname, "src/contentScript/index.js"),
			},
			output: {
				entryFileNames: (chunkInfo) => {
					if (chunkInfo.name === "background" || chunkInfo.name === "contentScript") {
						return "[name].js";
					}
					return "assets/[name]-[hash].js";
				},
			},
		},
		outDir: "dist",
	},
	server: {
		port: 7173,
	},
});
