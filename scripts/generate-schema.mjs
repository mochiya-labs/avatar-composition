import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EXTENSION_NAME, manifestSchema } from "../dist/index.js";
const schema =
	JSON.stringify(
		zodToJsonSchema(manifestSchema, {
			name: EXTENSION_NAME,
			target: "jsonSchema7",
		}),
		null,
		2,
	) + "\n";
for (const directory of ["schema", "dist/schema"]) {
	await mkdir(new URL(`../${directory}/`, import.meta.url), {
		recursive: true,
	});
	await writeFile(
		new URL(`../${directory}/${EXTENSION_NAME}.schema.json`, import.meta.url),
		schema,
	);
}
await mkdir(new URL("../dist/specification/", import.meta.url), {
	recursive: true,
});
await copyFile(
	new URL("../specification/README.md", import.meta.url),
	new URL("../dist/specification/README.md", import.meta.url),
);
