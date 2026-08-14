/**
 * Template used to seed a per-plugin "API scripting" skill when the user enables
 * an auto-discovered Obsidian plugin that exposes a public `api` object but ships
 * no dedicated skill of its own.
 *
 * This is intentionally NOT a bundled skill (it does not live under
 * `src/skills/defaults/`, so it is never discovered or attached to an agent
 * directly). Instead it is the seed content for a generated, plugin-specific
 * skill the user can then edit and iterate on independently. The template tells
 * the agent to introspect the API, do the task, and then persist a verified
 * replacement — via the `manage_skills` tool (staged for review) when available,
 * or otherwise by emitting a SKILL.md code block the user copies over this file
 * — turning a throwaway introspection session into a durable, documented skill.
 */

import type { SkillFrontmatter } from "../../types/plugin";
import { slugifySkillName } from "../validation";

/**
 * Generic introspect-first instructions, parameterized by the plugin's display
 * name and its runtime `exec_<plugin>` tool name. Written so a user can start
 * from a working baseline and specialize it as they learn the plugin's API.
 *
 * `skillName` and `pluginId` are woven into the "Persist what you learned"
 * section so the agent can emit a copy-paste-ready replacement SKILL.md with
 * the correct frontmatter (name must match the skill's directory; the
 * `linkedPlugin` metadata is what keeps the skill wired to its exec tool).
 */
export function pluginApiSkillTemplate(
	displayName: string,
	execToolName: string,
	skillName: string,
	pluginId: string,
): string {
	return `# ${displayName} API scripting

This skill covers scripting **${displayName}**'s public JavaScript \`api\` object. You have an
\`${execToolName}\` tool that runs JavaScript against this plugin's \`api\` on the main thread.

There is no hand-written documentation for this plugin's API yet, so **discover it at runtime
before you rely on it**. Do not assume method names — introspect, then call. As you learn the API,
replace the generic steps below with the concrete methods and patterns that work.

## What's in scope

- \`api\` — the plugin's public API object (\`app.plugins.plugins["<id>"].api\`).
- \`app\` — the Obsidian \`App\` instance.
- \`input\` — optional JSON you pass to the tool.
- \`return\` the final value you want back (objects/arrays are stringified for you).

## Introspect first

Always start by inspecting the surface. Never call a method you haven't confirmed exists.

\`\`\`javascript
// 1. What top-level members does the API expose?
return Object.keys(api);
\`\`\`

\`\`\`javascript
// 2. Inspect a specific member's type and, for functions, its arity/source signature.
const name = "someMember"; // ← the member you're curious about
const m = api[name];
return { type: typeof m, arity: typeof m === "function" ? m.length : undefined, preview: String(m).slice(0, 200) };
\`\`\`

\`\`\`javascript
// 3. For nested/namespaced APIs, walk one level deeper.
return Object.fromEntries(Object.keys(api).map((k) => [k, typeof api[k]]));
\`\`\`

Once you know the shape, call the real methods. If a call throws, the error is returned to you as
a string — read it, adjust, and retry with a corrected call.

## Rules & constraints

- **Introspect before calling.** The API surface varies by plugin and version; guessing wastes turns.
- **Read-only by default.** Only perform mutations (create/update/delete) when the user explicitly
  asked to change data. When unsure whether a method mutates, inspect it or ask.
- **Not sandboxed.** This runs on the main thread with full \`app\` access — a call can do anything the
  plugin can. Keep snippets small and focused.
- **Awaited work times out.** Long-running or hanging promises are cut off; a runaway synchronous
  loop cannot be preempted, so avoid unbounded loops.
- **Prefer existing tools when they fit.** \`read_content\`, \`manage_notes\`, and \`search_notes\`
  respect the user's privacy rules — they skip or redact notes marked private for the current
  provider. \`api\` and \`app\` do not: this is unsandboxed main-thread access and a call can read
  or write any note regardless of privacy settings. Use \`read_content\` / \`manage_notes\` /
  \`search_notes\` for ordinary note reads and writes; reach for \`${execToolName}\` only for logic
  ${displayName}'s API uniquely provides.
- **Report honestly.** If introspection shows the API can't do what the user asked, say so rather
  than fabricating a method.

## Typical flow

1. \`return Object.keys(api)\` to see what's available.
2. Inspect the one or two members that look relevant (type + arity).
3. Call them with the real arguments; return the result.
4. Once the task is done and you know which calls actually work, **persist what you learned** (see
   below) so future runs skip the introspection.

## Persist what you learned

There is no hand-written documentation for **${displayName}** yet — this skill is a generic
starting point. After you have completed a real task and confirmed which \`api\` calls work, fold
that knowledge back into this skill so future runs start from concrete, verified instructions.

**Preferred: use the \`manage_skills\` tool.** If you have a \`manage_skills\` tool available, call its
update operation with \`skillName: "${skillName}"\` and a \`newBody\` that replaces the generic guidance
below with the **specific, verified** calls — real method names, argument shapes, return values, and
any gotchas. The edit applies immediately, with no review step, so only do this once you're
confident. Keep the read-only-by-default and safety guidance, and only document methods you
actually confirmed exist.

**Fallback (no \`manage_skills\` tool):** output a complete replacement for this SKILL.md in a single
fenced code block and tell the user they can copy it over the skill file at
\`Skills/${skillName}/SKILL.md\` under the vault's agent folder. Keep the frontmatter exactly as
below — the \`name\` must stay \`${skillName}\` (it must match the skill's folder name) and
\`metadata.linkedPlugin\` must stay \`${pluginId}\` (this keeps the skill wired to its \`${execToolName}\` tool).

\`\`\`markdown
---
name: ${skillName}
description: <one line: what ${displayName}'s API does and when to use it>
license: MIT
metadata:
  linkedPlugin: ${pluginId}
  displayName: ${displayName}
---

# ${displayName} API scripting

<the concrete, verified instructions you built up — real methods, arguments, patterns, and safety notes>
\`\`\`

Either way, do not persist anything until you have verified real calls; a skill full of unconfirmed
methods is worse than the generic template.
`;
}

/**
 * Build a plugin-specific "API scripting" skill (frontmatter + body) from the
 * template, linked to `pluginId` so the modal's curated-skill path renders and
 * toggles it (and its paired `exec_<plugin>` tool) like any bundled plugin skill.
 */
export function buildPluginApiSkill(
	pluginId: string,
	displayName: string,
): { frontmatter: SkillFrontmatter; content: string } {
	const skillName = slugifySkillName(displayName);
	const execToolName = `exec_${pluginId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

	return {
		frontmatter: {
			name: skillName,
			description: `Script the ${displayName} plugin via its public JavaScript API. Use when the user asks to work with ${displayName} and you have an ${execToolName} tool — introspect the API first, then call it.`,
			license: "MIT",
			metadata: {
				linkedPlugin: pluginId,
				displayName,
			},
		},
		content: pluginApiSkillTemplate(displayName, execToolName, skillName, pluginId),
	};
}
