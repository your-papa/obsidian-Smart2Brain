import { Client } from "langsmith";
import { LangChainTracer, type LangChainTracerFields } from "@langchain/core/tracers/tracer_langchain";
import type { Callbacks } from "@langchain/core/callbacks/manager";

import type { Telemetry } from "./Telemetry";

export interface LangSmithTelemetryOptions extends LangChainTracerFields {
	/**
	 * Flush spans to LangSmith after each run. This is mainly useful in short-lived
	 * scripts (such as tests) where the Node.js process may exit immediately.
	 */
	flushOnComplete?: boolean;
	apiKey?: string;
	endpoint?: string;
	project?: string;
}

export class LangSmithTelemetry implements Telemetry {
	private readonly tracer: LangChainTracer;
	private readonly flushOnComplete: boolean;

	constructor(options?: LangSmithTelemetryOptions) {
		const { flushOnComplete = false, apiKey, endpoint, project, client, ...fields } = options ?? {};

		let tracerClient = client;
		if (!tracerClient && (apiKey || endpoint)) {
			tracerClient = new Client({
				apiKey,
				apiUrl: endpoint,
			});
		}

		this.tracer = new LangChainTracer({
			...fields,
			projectName: project ?? fields.projectName,
			client: tracerClient,
		});
		this.flushOnComplete = flushOnComplete;
	}

	getCallbacks(): Callbacks {
		return [this.tracer];
	}

	async onRunComplete(): Promise<void> {
		if (!this.flushOnComplete) {
			return;
		}
		const maybeFlush = (this.tracer as unknown as { flush?: () => Promise<void> }).flush;
		if (typeof maybeFlush === "function") {
			await maybeFlush.call(this.tracer);
		}
	}
}
