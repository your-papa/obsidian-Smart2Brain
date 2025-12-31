import type { Callbacks } from "@langchain/core/callbacks/manager";

import type { AgentResult } from "../Agent";

export interface Telemetry {
	getCallbacks(): Callbacks | undefined;
	onRunComplete?(result: AgentResult): Promise<void> | void;
}

export class NullTelemetry implements Telemetry {
	getCallbacks(): undefined {
		return undefined;
	}
}
