/**
 * Topic Labeler
 *
 * Turns a graph topic (a set of notes) into a short concept name via the
 * configured graph chat model.
 *
 * Without this, a topic is labelled with the filename of its best-connected
 * note — so a cluster of monetary-policy notes might read "Vendor Call -
 * Observability Tooling". The label is the main thing that makes the graph
 * legible, so it's worth an LLM call.
 *
 * Results are cached by topic membership, which means the expensive work only
 * repeats when the topics themselves actually change — not when the user tweaks
 * an unrelated display setting.
 */

import type { ChatModel } from "../../stores/chatTimeline";
import { getRegistry } from "../../providers/registry";
import { createAiTransportContext, runWithAiTransportContext } from "../../lib/aiTransport";
import { Logger } from "../../utils/logging";

/**
 * How many note titles per topic are sent to the model.
 *
 * Exported because the cache key is derived from exactly this slice: a caller
 * restoring cached labels has to take the same prefix or it computes a
 * different key and misses every entry.
 */
export const TITLES_PER_TOPIC = 12;

/** Hard ceiling on label length; the model is also told to be brief. */
const MAX_LABEL_LENGTH = 40;

/**
 * How many labelling calls may be in flight at once.
 *
 * Topics are independent prompts, so this work fans out cleanly — but it has to
 * stay bounded: an unbounded `Promise.all` over a large vault's topics would
 * fire dozens of requests at once and earn a 429 from most hosted providers.
 * Sequential execution was rate-limit-safe only by accident.
 */
const LABEL_CONCURRENCY = 4;

export interface TopicToLabel {
	/** Topic id — echoed back on the result. */
	id: number;
	/** Note titles belonging to this topic, most representative first. */
	titles: string[];
	/** Fallback used when the model is unavailable or returns nothing usable. */
	fallbackLabel: string;
}

/**
 * Stable cache key for a topic's membership. Sorting makes the key independent
 * of the order notes happen to arrive in, so an unrelated rebuild that produces
 * the same grouping still hits cache.
 */
export function topicMembershipKey(titles: string[]): string {
	return [...titles].sort().join("\u0000");
}

/** Strip quoting/markdown/trailing punctuation an LLM may wrap a label in. */
function cleanLabel(raw: string): string {
	const firstLine = raw.split("\n").find((line) => line.trim().length > 0) ?? "";
	const stripped = firstLine
		.replace(/^\s*[-*\d.)\]]+\s*/, "") // list markers
		.replace(/^["'#*:\s]+|["'#*:.\s]+$/g, "")
		.trim();
	return stripped.slice(0, MAX_LABEL_LENGTH).trim();
}

function buildPrompt(titles: string[]): string {
	const list = titles.map((title) => `- ${title}`).join("\n");
	return `These note titles all belong to one cluster in a personal knowledge base. Name the shared topic.

Rules:
- Reply with the topic name only — no explanation, quotes, or punctuation at the end.
- Use at most 4 words.
- Name the shared subject, not one note. Never copy a single title verbatim.
- Use the same language as the titles.

Titles:
${list}`;
}

/**
 * Extract plain text from a LangChain message content field, which may be a
 * string or an array of content blocks depending on provider.
 */
function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (typeof part === "string" ? part : ((part as { text?: string }).text ?? "")))
			.join("");
	}
	return "";
}

/**
 * Generate concept labels for the given topics.
 *
 * Never throws and never returns a partial map: every requested topic gets an
 * entry, falling back to its `fallbackLabel` when labelling isn't possible. The
 * graph is expected to stay usable whether or not a model is configured.
 *
 * Calls run concurrently up to `LABEL_CONCURRENCY`. `options.signal` cancels
 * in-flight requests, not just queued ones; topics already labelled stay in the
 * cache, so a cancelled run doesn't have to be re-paid for on the next attempt.
 *
 * `options.force` bypasses the cache read so every topic is re-generated — the
 * manual "name topics" action, where the user is asking for different names and
 * a cache hit would silently return the same ones.
 */
export async function labelTopics(
	topics: TopicToLabel[],
	chatModel: ChatModel | null,
	options: { signal?: AbortSignal; cache?: Map<string, string>; force?: boolean } = {},
): Promise<Record<number, string>> {
	const labels: Record<number, string> = {};
	for (const topic of topics) {
		labels[topic.id] = topic.fallbackLabel;
	}

	if (!chatModel || topics.length === 0) return labels;

	let model: ReturnType<ReturnType<typeof getRegistry>["createChatInstance"]>;
	try {
		model = getRegistry().createChatInstance(chatModel.provider, chatModel.model, chatModel.modelConfig);
	} catch (error) {
		Logger.error("[TopicLabeler] Could not create model instance:", error);
		return labels;
	}

	// Buffered transport for the same reason generateTitle uses it: some
	// providers return bodies the streaming path fails to parse on plain invokes.
	const transportContext = createAiTransportContext("buffered", "labelTopics");

	// Serve cache hits up front so the worker pool only ever handles topics that
	// genuinely need a call — a fully-cached run then costs no workers at all.
	//
	// `force` skips the *read* but not the write: a deliberate re-roll should
	// produce fresh names, then leave them cached like any other result.
	const pending: Array<{ topic: TopicToLabel; titles: string[]; cacheKey: string }> = [];
	for (const topic of topics) {
		if (topic.titles.length === 0) continue;

		const titles = topic.titles.slice(0, TITLES_PER_TOPIC);
		const cacheKey = topicMembershipKey(titles);
		const cached = options.force ? undefined : options.cache?.get(cacheKey);
		if (cached) {
			labels[topic.id] = cached;
			continue;
		}
		pending.push({ topic, titles, cacheKey });
	}

	// Fixed pool of workers pulling from a shared cursor: each finishes one topic
	// and immediately takes the next, so a slow call never idles the others.
	let cursor = 0;
	const worker = async () => {
		while (true) {
			if (options.signal?.aborted) return;
			const next = pending[cursor++];
			if (!next) return;

			try {
				const response = await runWithAiTransportContext(transportContext, async () =>
					// Passing the signal is what makes cancellation real: without it an
					// abort only stops the *next* call while this one runs to completion.
					model.invoke([{ role: "user", content: buildPrompt(next.titles) }], {
						signal: options.signal,
					}),
				);
				const label = cleanLabel(contentToText(response.content));
				if (label) {
					labels[next.topic.id] = label;
					options.cache?.set(next.cacheKey, label);
				}
			} catch (error) {
				// One topic failing shouldn't cost the rest their labels — so this
				// catch stays inside the worker, and a worker never rejects (that
				// would tear down the whole pool). A deliberate cancel rejects every
				// in-flight call at once, which isn't worth N console errors.
				if (!options.signal?.aborted) {
					Logger.error(`[TopicLabeler] Failed to label topic ${next.topic.id}:`, error);
				}
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(LABEL_CONCURRENCY, pending.length) }, worker));

	return labels;
}
