import { SuggestModal, setIcon } from "obsidian";
import type { App } from "obsidian";
import { extractVendor } from "../../lib/modelVendorClassification";
import type { UiClassifiableModel } from "../../lib/modelVendorClassification";
import { getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import type { HydratedChatModelMetadata, HydratedEmbeddingModelMetadata } from "../../types/modelMetadata";
import type { ModelType, SelectedModel } from "./ModelSelectionModal";

type HydratedModel = HydratedChatModelMetadata | HydratedEmbeddingModelMetadata;

/** Vendors offered in the filter strip, in display order. */
const VENDOR_FILTERS = [
	{ id: "openai", name: "OpenAI" },
	{ id: "anthropic", name: "Anthropic" },
	{ id: "google", name: "Google" },
	{ id: "microsoft", name: "Microsoft" },
	{ id: "meta-llama", name: "Meta" },
	{ id: "deepseek", name: "DeepSeek" },
	{ id: "x-ai", name: "xAI" },
	{ id: "mistralai", name: "Mistral" },
	{ id: "qwen", name: "Qwen" },
] as const;

function formatCost(costPer1M?: number): string {
	if (costPer1M === undefined) return "—";
	if (costPer1M === 0) return "Free";
	if (costPer1M < 0.01) return `$${costPer1M.toFixed(4)}`;
	return `$${costPer1M.toFixed(2)}`;
}

function formatTokenLimit(tokens?: number): string {
	if (!tokens) return "—";
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return tokens.toString();
}

function getVariantKeyDisplay(model: HydratedModel): string {
	return model.provider === "ollama" ? model.variantKey.replace(/:latest$/i, "") : model.variantKey;
}

/**
 * Mobile model picker.
 *
 * On a phone Obsidian styles `SuggestModal` (`.prompt`) natively: the input is
 * pinned directly above the keyboard, results flow upward from it, and the
 * sheet fills the screen. That keyboard tracking is handled by the host — it is
 * the reason this exists as a separate class rather than as more `.is-mobile`
 * overrides on the desktop Svelte modal, which floats mid-screen and cannot
 * follow the keyboard without re-solving the problem in
 * `reference_obsidian_native_keyboard_css_vars`.
 *
 * Search is the primary interaction here (installs routinely discover 400+
 * models), so a search-first surface fits the task better than a scrolling grid.
 * The desktop modal is untouched.
 */
export class ModelSuggestModal extends SuggestModal<HydratedModel> {
	private readonly models: HydratedModel[];
	private readonly currentSelection: SelectedModel | null;
	private readonly onSelectModel: (model: SelectedModel | null) => void;
	private readonly openRouterModels: Map<string, unknown> | null;
	private readonly pluginData = getData();

	/** Active vendor filter, or null for "all". Mirrors the desktop rail. */
	private selectedVendor: string | null = null;
	private showFavorites = false;
	private filterBarEl: HTMLElement | null = null;

	constructor(
		app: App,
		modelType: ModelType,
		models: HydratedModel[],
		currentSelection: SelectedModel | null,
		openRouterModels: Map<string, unknown> | null,
		onSelectModel: (model: SelectedModel | null) => void,
	) {
		super(app);
		this.models = models;
		this.currentSelection = currentSelection;
		this.onSelectModel = onSelectModel;
		this.openRouterModels = openRouterModels;

		this.modalEl.addClass("s2b-model-suggest-modal");
		this.setPlaceholder(modelType === "chat" ? "Search chat models..." : "Search embedding models...");
		this.limit = 200;
	}

	onOpen(): void {
		super.onOpen();
		this.buildFilterBar();
	}

	private toClassifiable(model: HydratedModel): UiClassifiableModel {
		const providerMeta = this.pluginData.getProviderMeta(model.provider);
		const providerAuth = this.pluginData.getResolvedProviderAuth(model.provider);
		return {
			provider: model.provider,
			model: model.variantKey,
			templateId: providerMeta?.templateId,
			baseUrl: providerAuth.baseUrl,
		};
	}

	private vendorOf(model: HydratedModel): string | null {
		return extractVendor(this.toClassifiable(model), this.openRouterModels as Parameters<typeof extractVendor>[1]);
	}

	private getProviderDisplayName(providerId: string): string {
		return getProviderDefinition(providerId, this.pluginData.getAllProviderMeta())?.displayName ?? providerId;
	}

	/**
	 * Filter strip above the input. `SuggestModal` has no slot for this, so it
	 * is inserted after the input container — the same approach the search
	 * modal uses for its mobile action bar.
	 */
	private buildFilterBar(): void {
		const inputContainer = this.modalEl.querySelector<HTMLElement>(".prompt-input-container");
		if (!inputContainer) return;

		const presentVendors = new Set<string>();
		for (const model of this.models) {
			const vendor = this.vendorOf(model);
			if (vendor) presentVendors.add(vendor);
		}

		const bar = document.createElement("div");
		bar.className = "s2b-model-filter-bar";

		const favBtn = document.createElement("button");
		favBtn.type = "button";
		favBtn.className = "s2b-pill s2b-pill--interactive s2b-model-filter-fav";
		const favIcon = document.createElement("span");
		favIcon.className = "s2b-model-filter-icon";
		setIcon(favIcon, "star");
		favBtn.appendChild(favIcon);
		favBtn.appendChild(document.createTextNode("Favorites"));
		favBtn.addEventListener("click", (evt) => {
			evt.preventDefault();
			this.showFavorites = !this.showFavorites;
			if (this.showFavorites) this.selectedVendor = null;
			this.refreshFilterBar();
			this.rerunSearch();
		});
		bar.appendChild(favBtn);

		for (const vendor of VENDOR_FILTERS) {
			if (!presentVendors.has(vendor.id)) continue;
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "s2b-pill s2b-pill--interactive";
			btn.dataset.vendorId = vendor.id;
			btn.textContent = vendor.name;
			btn.addEventListener("click", (evt) => {
				evt.preventDefault();
				this.selectedVendor = this.selectedVendor === vendor.id ? null : vendor.id;
				if (this.selectedVendor) this.showFavorites = false;
				this.refreshFilterBar();
				this.rerunSearch();
			});
			bar.appendChild(btn);
		}

		inputContainer.insertAdjacentElement("afterend", bar);
		this.filterBarEl = bar;
		this.refreshFilterBar();
	}

	private refreshFilterBar(): void {
		const bar = this.filterBarEl;
		if (!bar) return;
		bar.querySelector(".s2b-model-filter-fav")?.toggleClass("s2b-pill--active", this.showFavorites);
		for (const btn of Array.from(bar.querySelectorAll<HTMLElement>("[data-vendor-id]"))) {
			btn.toggleClass("s2b-pill--active", btn.dataset.vendorId === this.selectedVendor);
		}
	}

	/** Re-run the current query so a filter change takes effect immediately. */
	private rerunSearch(): void {
		const input = this.modalEl.querySelector<HTMLInputElement>(".prompt-input");
		if (input) input.dispatchEvent(new Event("input"));
	}

	getSuggestions(query: string): HydratedModel[] {
		const needle = query.trim().toLowerCase();

		return this.models.filter((model) => {
			if (this.showFavorites && !this.pluginData.isFavoriteModel(model.provider, model.variantKey)) {
				return false;
			}
			if (this.selectedVendor && this.vendorOf(model) !== this.selectedVendor) {
				return false;
			}
			if (!needle) return true;
			return (
				model.displayName.toLowerCase().includes(needle) ||
				model.variantKey.toLowerCase().includes(needle) ||
				this.getProviderDisplayName(model.provider).toLowerCase().includes(needle)
			);
		});
	}

	renderSuggestion(model: HydratedModel, el: HTMLElement): void {
		el.addClass("s2b-model-suggestion");
		const isSelected =
			this.currentSelection?.provider === model.provider && this.currentSelection?.model === model.variantKey;
		el.toggleClass("s2b-model-suggestion--selected", isSelected);

		const header = el.createDiv({ cls: "s2b-model-suggestion-header" });
		const info = header.createDiv({ cls: "s2b-model-suggestion-info" });
		info.createDiv({ text: model.displayName, cls: "s2b-model-suggestion-name" });

		const variantDisplay = getVariantKeyDisplay(model);
		if (variantDisplay !== model.displayName) {
			info.createDiv({ text: variantDisplay, cls: "s2b-model-suggestion-slug" });
		}

		const actions = header.createDiv({ cls: "s2b-model-suggestion-actions" });
		const isFavorite = this.pluginData.isFavoriteModel(model.provider, model.variantKey);
		const favBtn = actions.createEl("button", { cls: "s2b-model-suggestion-fav" });
		favBtn.type = "button";
		favBtn.toggleClass("is-favorite", isFavorite);
		favBtn.setAttribute("aria-label", isFavorite ? "Remove from favorites" : "Add to favorites");
		setIcon(favBtn, "star");
		// The row itself selects the model, so the star must not bubble.
		favBtn.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.pluginData.toggleFavoriteModel(model.provider, model.variantKey);
			favBtn.toggleClass("is-favorite", this.pluginData.isFavoriteModel(model.provider, model.variantKey));
		});

		if (isSelected) {
			actions.createSpan({ text: "✓", cls: "s2b-model-suggestion-check" });
		}

		const meta = el.createDiv({ cls: "s2b-model-suggestion-meta" });
		const tag = (text: string, extraCls?: string) =>
			meta.createSpan({ text, cls: `s2b-model-suggestion-tag${extraCls ? ` ${extraCls}` : ""}` });

		tag(this.getProviderDisplayName(model.provider), "s2b-model-suggestion-tag--provider");

		if (model.kind === "chat") {
			tag(`${formatTokenLimit(model.contextWindow)} ctx`);
			if (model.pricing?.inputUsdPer1M !== undefined || model.pricing?.outputUsdPer1M !== undefined) {
				tag(`${formatCost(model.pricing?.inputUsdPer1M)}/${formatCost(model.pricing?.outputUsdPer1M)}`);
			}
			if (model.capabilities.toolCalls) tag("Tools", "capability");
			if (model.capabilities.reasoning) tag("Reasoning", "capability");
			if (model.capabilities.vision) tag("Vision", "capability");
			if (model.capabilities.structuredOutput) tag("JSON", "capability");
		} else {
			tag(`${formatTokenLimit(model.maxInputTokens)} max input`);
			if (model.pricing?.inputUsdPer1M !== undefined) {
				tag(formatCost(model.pricing.inputUsdPer1M));
			}
		}
	}

	onChooseSuggestion(model: HydratedModel): void {
		this.onSelectModel({ provider: model.provider, model: model.variantKey });
	}
}
