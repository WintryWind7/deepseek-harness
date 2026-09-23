const patched = Symbol.for("dsh.chattt-replay-model");
const rewritten = new WeakMap();

function rewriteChatttReplayModel(message) {
	if (message?.role !== "assistant") return message;
	const source = message.source;
	if (source?.kind !== "model" || source.provider !== "chattt") return message;
	const replay = source.replayState;
	const response = replay?.response;
	if (response?.kind !== "pi-ai" || response.api !== "anthropic-messages") return message;
	if (typeof response.responseModel !== "string" || response.responseModel === response.model) return message;
	if (typeof response.model !== "string" || response.model.length === 0) return message;
	const cached = rewritten.get(message);
	if (cached) return cached;
	const copy = {
		...message,
		source: {
			...source,
			replayState: {
				...replay,
				response: { ...response, responseModel: response.model },
			},
		},
	};
	rewritten.set(message, copy);
	return copy;
}

function mapMessages(messages) {
	let changed = false;
	const next = messages.map((message) => {
		const mapped = rewriteChatttReplayModel(message);
		if (mapped !== message) changed = true;
		return mapped;
	});
	return changed ? next : messages;
}

function install(session) {
	const proto = Object.getPrototypeOf(session);
	if (proto?.[patched] || typeof proto?.deriveMessages !== "function") return;
	const original = proto.deriveMessages;
	function deriveMessages() {
		return mapMessages(original.call(this));
	}
	proto.deriveMessages = deriveMessages;
	proto[patched] = true;
	return () => {
		if (proto.deriveMessages === deriveMessages) {
			proto.deriveMessages = original;
			delete proto[patched];
		}
	};
}

export const name = "chattt-replay-model";
export const inject = ["sessions"];

export function apply(ctx) {
	let restore;
	const mount = (session) => {
		restore ??= install(session);
	};
	ctx.on("session/created", mount);
	for (const session of ctx.sessions.list()) mount(session);
	ctx.effect(() => () => restore?.(), "chattt-replay-model");
}
