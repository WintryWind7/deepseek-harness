import { readFileSync } from "node:fs";

const ENV_README = "D:\\why\\my\\环境\\README.md";

export const name = "env-readme";
export const inject = ["systemPrompt"];

export function apply(ctx) {
	ctx.effect(
		() =>
			ctx.systemPrompt.section({
				name: "env:machine",
				order: 10,
				text: () => {
					try {
						return readFileSync(ENV_README, "utf8").trim();
					} catch (error) {
						const detail = error instanceof Error ? error.message : String(error);
						return `未能读取 ${ENV_README}：${detail}`;
					}
				},
			}),
		"systemPrompt.section(env:machine)",
	);
}
