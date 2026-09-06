import { mkdir, writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EXTENSION_NAME, manifestSchema } from "../dist/index.js";
await mkdir(new URL("../schema/", import.meta.url), { recursive: true });
await writeFile(
	new URL(`../schema/${EXTENSION_NAME}.schema.json`, import.meta.url),
	JSON.stringify(
		zodToJsonSchema(manifestSchema, {
			name: EXTENSION_NAME,
			target: "jsonSchema7",
		}),
		null,
		2,
	) + "\n",
);
