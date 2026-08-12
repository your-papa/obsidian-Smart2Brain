import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import AnthropicLogo from "../components/ui/logos/AnthropicLogo.svelte";
import DeepSeekLogo from "../components/ui/logos/DeepSeekLogo.svelte";
import GoogleLogo from "../components/ui/logos/GoogleLogo.svelte";
import MetaLogo from "../components/ui/logos/MetaLogo.svelte";
import MicrosoftLogo from "../components/ui/logos/MicrosoftLogo.svelte";
import MistralLogo from "../components/ui/logos/MistralLogo.svelte";
import OpenAILogo from "../components/ui/logos/OpenAILogo.svelte";
import QwenLogo from "../components/ui/logos/QwenLogo.svelte";
import XAILogo from "../components/ui/logos/XAILogo.svelte";

/**
 * Vendor logos keyed by the ids `extractVendor` returns. Only these nine have
 * artwork — model catalogues carry far more labs than that (Z.ai, MiniMax,
 * NVIDIA, Poolside, Sakana…), so callers must handle a miss rather than
 * assuming a logo exists.
 */
const VENDOR_LOGO_COMPONENTS: Record<string, Component<{ width?: number; height?: number; class?: string }>> = {
	openai: OpenAILogo,
	anthropic: AnthropicLogo,
	google: GoogleLogo,
	microsoft: MicrosoftLogo,
	"meta-llama": MetaLogo,
	deepseek: DeepSeekLogo,
	"x-ai": XAILogo,
	mistralai: MistralLogo,
	qwen: QwenLogo,
};

/**
 * Serialized `<svg>` markup per vendor, built on first request.
 *
 * The logos are Svelte components but the mobile model picker is a plain
 * `SuggestModal` that re-renders hundreds of rows per keystroke. Mounting a
 * component per row would be wasteful, so each logo is mounted once into a
 * detached node, its markup cached, and clones handed out from then on.
 */
const svgCache = new Map<string, string | null>();

function renderVendorLogoSvg(vendorId: string): string | null {
	const LogoComponent = VENDOR_LOGO_COMPONENTS[vendorId];
	if (!LogoComponent) return null;

	const host = document.createElement("div");
	const instance = mount(LogoComponent, {
		target: host,
		props: { width: 16, height: 16 },
	});
	const markup = host.querySelector("svg")?.outerHTML ?? null;
	void unmount(instance);
	return markup;
}

/** Whether this vendor has artwork, without paying for the render. */
export function hasVendorLogo(vendorId: string | null | undefined): boolean {
	return !!vendorId && vendorId in VENDOR_LOGO_COMPONENTS;
}

/**
 * A detached `<svg>` element for the vendor, or null when unknown. Each call
 * returns a fresh clone, so the result can be inserted straight into the DOM.
 */
export function createVendorLogoElement(vendorId: string | null | undefined): SVGElement | null {
	if (!vendorId || !(vendorId in VENDOR_LOGO_COMPONENTS)) return null;

	if (!svgCache.has(vendorId)) {
		svgCache.set(vendorId, renderVendorLogoSvg(vendorId));
	}

	const markup = svgCache.get(vendorId);
	if (!markup) return null;

	const template = document.createElement("div");
	template.innerHTML = markup;
	const svg = template.querySelector("svg");
	return svg ? (svg.cloneNode(true) as SVGElement) : null;
}
