# Repository workflow

After creating or editing code in this repository, including the viewer, tests and scripts, run `npm run format` from the repository root. Run `npm run format:check` after the final edit and resolve formatting failures before completing the task. Use `npm.cmd` on PowerShell if needed.

Use the checked-in `.prettierrc`; do not substitute personal editor settings. VS Code uses the Prettier extension and formats on save.

Respect `.prettierignore`: the generated extension schema, build output, lockfiles and local Unity/test assets remain managed by their existing tools. Edit `src/schema.ts` and regenerate the schema with `npm run build`; do not hand-format generated JSON.
