interface ModelIdentity {
	provider: string;
	variantKey: string;
	displayName: string;
	paramSize?: string;
	quantization?: string;
}

export interface HydratedChatModelMetadata extends ModelIdentity {
	kind: "chat";
	contextWindow: number;
	temperature?: number;
	capabilities: {
		toolCalls?: boolean;
		vision?: boolean;
		reasoning?: boolean;
		structuredOutput?: boolean;
	};
	pricing?: {
		inputUsdPer1M?: number;
		outputUsdPer1M?: number;
	};
}

export interface HydratedEmbeddingModelMetadata extends ModelIdentity {
	kind: "embedding";
	maxInputTokens: number;
	dimensions?: number;
	similarityThresholdDefault: number;
	pricing?: {
		inputUsdPer1M?: number;
	};
}
