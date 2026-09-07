import { basename } from "node:path";

export const name = "project-prompt-var";
export const inject = ["systemPrompt"];

export function apply(ctx) {
	ctx.effect(
		() =>
			ctx.systemPrompt.variable("project", (context) => {
				const cwd = context.agent?.session.header.cwd;
				if (typeof cwd !== "string" || cwd.length === 0) return undefined;
				const trimmed = cwd.replace(/[\\/]+$/, "");
				const value = basename(trimmed);
				return value.length > 0 ? value : undefined;
			}),
		"systemPrompt.variable(project)",
	);
}
