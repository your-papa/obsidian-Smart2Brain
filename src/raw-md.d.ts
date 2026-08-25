/**
 * Direct `?raw` imports of markdown files (Vite core feature). Used by
 * `src/skills/shippedSkills.ts` to retain previously-shipped SKILL.md bodies verbatim for
 * fingerprinting — see PRIOR_SKILL_FINGERPRINTS there. The bundled-skill glob in
 * `src/skills/defaults/index.ts` types itself via `import.meta.glob` generics and does not
 * need this declaration.
 */
declare module "*.md?raw" {
	const content: string;
	export default content;
}
