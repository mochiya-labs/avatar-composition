import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "test/browser",
	timeout: 120_000,
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:5175",
		channel: "chrome",
		viewport: { width: 1440, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "npm run viewer:dev",
		url: "http://127.0.0.1:5175",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
