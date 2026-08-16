#!/usr/bin/env bun
/**
 * Generate the synthetic relevance corpus used by the search ranking benchmark.
 *
 * The corpus is *generated* rather than committed as 300 hand-written notes so the
 * relevance structure stays reviewable: every property the benchmark measures is
 * declared here, in one place, instead of being implicit in a pile of prose.
 *
 * Properties deliberately encoded (each one exists to defeat a specific ranking
 * failure mode):
 *
 *  - **Near-synonyms across domains** — the target note phrases a concept one way
 *    ("photovoltaic array"), the query another ("solar panel"). Pure lexical search
 *    cannot bridge these; they measure the semantic half of the hybrid.
 *  - **Lexical distractors** — notes that share the query's vocabulary while being
 *    about something else. These punish rankers that reward raw term frequency.
 *  - **Length spread** — stubs (~40 words) through reference notes (~2500 words),
 *    replacing the old bimodal fixture (7 tiny + 2 huge). Long notes are the ones
 *    that win on surface area alone when length normalization is missing.
 *  - **Multi-chunk targets** — notes long enough to split into several chunks, with
 *    the answer repeated in separate sections, so "best chunk wins" and "aggregate
 *    across chunks" produce measurably different rankings.
 *  - **Alias / tag / path signals** — frontmatter aliases and tags that a query can
 *    hit without the title matching.
 *
 * Deterministic: a fixed-seed PRNG means re-running produces byte-identical output,
 * so regenerating never shows up as benchmark noise.
 *
 * Usage:
 *   bun run scripts/generate-search-corpus.ts [--out <vault path>] [--clean]
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_VAULT = "integration/Smart2Brain Test Vault";
/** Corpus lives in its own folder so it is trivially separable from hand-written fixtures. */
const CORPUS_DIR = "Corpus";

// ── deterministic PRNG (mulberry32) ──────────────────────────────────────────

function makeRng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const rng = makeRng(0x5eed_1234);

function pick<T>(items: readonly T[]): T {
	return items[Math.floor(rng() * items.length)];
}

function shuffled<T>(items: readonly T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

// ── domain model ─────────────────────────────────────────────────────────────

interface Domain {
	/** Folder name under Corpus/. */
	name: string;
	/** Frontmatter tag applied to every note in the domain. */
	tag: string;
	/** Subject nouns used to build note titles and prose. */
	subjects: readonly string[];
	/** Domain vocabulary sprinkled into note bodies. */
	vocabulary: readonly string[];
}

const DOMAINS: readonly Domain[] = [
	{
		name: "Marine Biology",
		tag: "marine-biology",
		subjects: [
			"Coral Reef Bleaching",
			"Deep Sea Hydrothermal Vents",
			"Cephalopod Cognition",
			"Whale Migration Routes",
			"Plankton Blooms",
			"Mangrove Nurseries",
			"Shark Population Decline",
			"Tidal Zone Ecology",
			"Bioluminescence",
			"Ocean Acidification",
		],
		vocabulary: [
			"salinity",
			"benthic",
			"pelagic",
			"symbiosis",
			"larval dispersal",
			"trophic cascade",
			"upwelling",
			"photic zone",
		],
	},
	{
		name: "Monetary Policy",
		tag: "monetary-policy",
		subjects: [
			"Interest Rate Corridors",
			"Quantitative Tightening",
			"Inflation Expectations",
			"Yield Curve Inversion",
			"Reserve Requirements",
			"Currency Pegs",
			"Open Market Operations",
			"Liquidity Traps",
			"Forward Guidance",
			"Seigniorage",
		],
		vocabulary: [
			"basis points",
			"counterparty",
			"balance sheet",
			"transmission mechanism",
			"nominal anchor",
			"term premium",
			"repo market",
			"output gap",
		],
	},
	{
		name: "Typography",
		tag: "typography",
		subjects: [
			"Optical Sizing",
			"Kerning Pairs",
			"Variable Font Axes",
			"Grotesque Sans Serifs",
			"Baseline Grids",
			"Hinting and Rasterization",
			"Ligature Design",
			"Type Foundries",
			"Counters and Apertures",
			"Reading Cadence",
		],
		vocabulary: [
			"x-height",
			"tracking",
			"leading",
			"serif bracket",
			"stroke contrast",
			"em square",
			"glyph coverage",
			"diacritics",
		],
	},
	{
		name: "Fermentation",
		tag: "fermentation",
		subjects: [
			"Sourdough Starter Maintenance",
			"Lactic Acid Bacteria",
			"Koji Cultivation",
			"Kombucha Scoby Health",
			"Brine Concentration",
			"Wild Yeast Capture",
			"Miso Aging",
			"Vinegar Mother Care",
			"Kimchi Seasonality",
			"Temperature Control in Fermentation",
		],
		vocabulary: [
			"anaerobic",
			"inoculation",
			"pellicle",
			"acidity",
			"substrate",
			"hydration ratio",
			"osmotic pressure",
			"secondary ferment",
		],
	},
];

/**
 * Query-bearing fixtures: each one pins a specific ranking behaviour the benchmark
 * asserts on. `answer` is the sentence that makes the note the correct result — it is
 * phrased with the *near-synonym*, never the query's own wording, so a match requires
 * semantic understanding rather than term overlap.
 */
interface Probe {
	/** Slug used for the note filename. */
	slug: string;
	domain: string;
	title: string;
	/** The distinctive sentence that answers the probe query. */
	answer: string;
	/** Frontmatter aliases, for alias-signal coverage. */
	aliases?: string[];
	/** Extra tags beyond the domain tag. */
	tags?: string[];
	/** Approximate body length in words. */
	words: number;
	/** Repeat the answer in a late section too, to create a genuine multi-chunk target. */
	repeatAnswerLate?: boolean;
}

const PROBES: readonly Probe[] = [
	{
		slug: "photovoltaic-array-degradation",
		domain: "Marine Biology",
		title: "Photovoltaic Array Degradation Offshore",
		// Query will say "solar panel wear at sea" — no shared content words.
		answer:
			"Offshore photovoltaic arrays lose roughly half a percent of rated output each year, driven mainly by salt-spray corrosion of the cell interconnects rather than by ultraviolet damage.",
		aliases: ["Offshore Solar Wear"],
		tags: ["degradation"],
		words: 1800,
		repeatAnswerLate: true,
	},
	{
		slug: "cephalopod-problem-solving",
		domain: "Marine Biology",
		title: "Cephalopod Problem Solving",
		answer:
			"Octopuses open sealed containers by rotating the lid counter-clockwise, and individuals retain the technique for at least three weeks without reinforcement.",
		aliases: ["Octopus Intelligence"],
		words: 240,
	},
	{
		slug: "policy-rate-transmission-lag",
		domain: "Monetary Policy",
		title: "Policy Rate Transmission Lag",
		answer:
			"A change in the overnight target reaches consumer borrowing costs after four to six quarters, with mortgage rates responding faster than small-business credit.",
		tags: ["transmission"],
		words: 2400,
		repeatAnswerLate: true,
	},
	{
		slug: "hyperinflation-episodes",
		domain: "Monetary Policy",
		title: "Hyperinflation Episodes",
		answer:
			"Once monthly price growth passes fifty percent, households abandon the domestic unit of account within weeks and switch to foreign currency for savings.",
		aliases: ["Runaway Price Growth"],
		words: 45,
	},
	{
		slug: "legibility-at-small-sizes",
		domain: "Typography",
		title: "Legibility at Small Sizes",
		answer:
			"Below nine points, open apertures and a generous x-height preserve character recognition far more effectively than increasing the stroke weight.",
		tags: ["legibility"],
		words: 900,
	},
	{
		slug: "starter-hydration-and-rise",
		domain: "Fermentation",
		title: "Starter Hydration and Rise Time",
		answer:
			"A hundred percent hydration starter doubles in about five hours at twenty-four degrees, while a stiff sixty percent starter takes nearly twice as long.",
		aliases: ["Levain Timing"],
		words: 1400,
		repeatAnswerLate: true,
	},
];

/**
 * Distractors: notes engineered to *look* right lexically for a probe query while
 * being about something else. Without them a ranker that simply counts query terms
 * scores as well as one that understands the question.
 */
interface Distractor {
	slug: string;
	domain: string;
	title: string;
	/** Deliberately stuffed with the query's own words, in the wrong context. */
	decoy: string;
	words: number;
}

const DISTRACTORS: readonly Distractor[] = [
	{
		slug: "solar-panel-metaphors-in-design",
		domain: "Typography",
		title: "Solar Panel Metaphors in Signage Design",
		decoy:
			"Wayfinding signage for solar farms borrows the visual language of the panel grid: repeated rectangular modules, high contrast, and a cool blue cast. The panels themselves are only a motif here — this note is about sign layout, not about how any array performs or wears over time.",
		words: 700,
	},
	{
		slug: "interest-in-typography-history",
		domain: "Typography",
		title: "Interest and Rates of Change in Type History",
		decoy:
			"Interest in revival faces rose sharply after 1990, and the rate at which foundries released new families climbed with it. The words interest and rate appear throughout this note in their ordinary English sense, with no monetary meaning whatsoever.",
		words: 650,
	},
	{
		slug: "octopus-recipes",
		domain: "Fermentation",
		title: "Fermented Octopus Preparations",
		decoy:
			"Octopus is salted and left to ferment briefly before grilling. This note covers brining and texture, not animal behaviour, learning, or any container-opening problem solving.",
		words: 500,
	},
	{
		slug: "small-sizes-of-fermentation-vessels",
		domain: "Fermentation",
		title: "Small Sizes of Fermentation Vessels",
		decoy:
			"At small sizes, a vessel loses heat quickly and the ferment stalls. Small batch sizes also make the pH swing faster. Nothing here concerns reading, type, or character recognition.",
		words: 480,
	},
];

// ── prose generation ─────────────────────────────────────────────────────────

const SECTION_TITLES = [
	"Background",
	"Mechanism",
	"Field Observations",
	"Measurement",
	"Common Failure Modes",
	"Practical Notes",
	"Open Questions",
	"Further Reading",
] as const;

/** Build filler prose from a domain's vocabulary — plausible, never accidentally on-topic. */
function fillerSentence(domain: Domain): string {
	const a = pick(domain.vocabulary);
	const b = pick(domain.vocabulary);
	const subject = pick(domain.subjects);
	const templates = [
		`Work on ${subject.toLowerCase()} tends to foreground ${a} while treating ${b} as a secondary effect.`,
		`Practitioners disagree about how much ${a} explains, particularly where ${b} varies across sites.`,
		`Any survey of ${subject.toLowerCase()} has to reconcile ${a} with the constraints imposed by ${b}.`,
		`Reported figures for ${a} vary widely, which complicates comparison against ${b}.`,
		`The relationship between ${a} and ${b} is not linear, and small shifts compound over a season.`,
	];
	return pick(templates);
}

/** Generate a body of approximately `words` words, split into `##` sections. */
function buildBody(domain: Domain, words: number, leadPara: string, repeatLate?: string): string {
	const parts: string[] = [leadPara];
	let count = leadPara.split(/\s+/).length;

	const sections = shuffled(SECTION_TITLES);
	let s = 0;
	while (count < words) {
		const heading = sections[s % sections.length];
		s++;
		parts.push(`\n## ${heading}\n`);
		count += 2;

		// Each section gets a few sentences; long notes therefore cross chunk
		// boundaries with real headings, exercising the chunker's breadcrumbs.
		const sentences: string[] = [];
		const target = Math.min(words - count, 60 + Math.floor(rng() * 60));
		let sectionCount = 0;
		while (sectionCount < target) {
			const sentence = fillerSentence(domain);
			sentences.push(sentence);
			sectionCount += sentence.split(/\s+/).length;
		}
		parts.push(sentences.join(" "));
		count += sectionCount;
	}

	// Restate the answer far from the top so the note has more than one strong
	// chunk — this is what separates best-chunk from aggregate scoring.
	if (repeatLate) {
		parts.push(`\n## Summary\n`);
		parts.push(repeatLate);
	}

	return parts.join("\n");
}

function frontmatter(tags: string[], aliases?: string[]): string {
	const lines = ["---"];
	if (aliases?.length) {
		lines.push("aliases:");
		for (const alias of aliases) lines.push(`  - ${alias}`);
	}
	lines.push("tags:");
	for (const tag of tags) lines.push(`  - ${tag}`);
	lines.push("---", "");
	return lines.join("\n");
}

function domainByName(name: string): Domain {
	const found = DOMAINS.find((d) => d.name === name);
	if (!found) throw new Error(`Unknown domain: ${name}`);
	return found;
}

// ── main ─────────────────────────────────────────────────────────────────────

function main(): void {
	const args = process.argv.slice(2);
	const outIndex = args.indexOf("--out");
	const vaultPath = outIndex >= 0 ? args[outIndex + 1] : DEFAULT_VAULT;
	const corpusRoot = join(vaultPath, CORPUS_DIR);

	if (args.includes("--clean")) {
		rmSync(corpusRoot, { recursive: true, force: true });
	}

	const written: Array<{ path: string; words: number }> = [];

	const write = (domain: Domain, filename: string, content: string) => {
		const dir = join(corpusRoot, domain.name);
		mkdirSync(dir, { recursive: true });
		const full = join(dir, `${filename}.md`);
		writeFileSync(full, content, "utf8");
		written.push({ path: full, words: content.split(/\s+/).length });
	};

	// 1. Probe notes — the graded-relevance targets.
	for (const probe of PROBES) {
		const domain = domainByName(probe.domain);
		const body = buildBody(
			domain,
			probe.words,
			probe.answer,
			probe.repeatAnswerLate ? probe.answer : undefined,
		);
		const content = `${frontmatter([domain.tag, ...(probe.tags ?? [])], probe.aliases)}# ${probe.title}\n\n${body}\n`;
		write(domain, probe.slug, content);
	}

	// 2. Distractor notes — lexically tempting, semantically wrong.
	for (const distractor of DISTRACTORS) {
		const domain = domainByName(distractor.domain);
		const body = buildBody(domain, distractor.words, distractor.decoy);
		const content = `${frontmatter([domain.tag, "distractor"])}# ${distractor.title}\n\n${body}\n`;
		write(domain, distractor.slug, content);
	}

	// 3. Bulk filler — gives the corpus realistic scale so rank-sensitive behaviour
	//    (cutoffs, normalization) is exercised rather than trivially satisfied.
	//    Lengths follow a long-tailed spread instead of the old bimodal fixture.
	const BULK_TARGET = 300 - written.length;
	for (let i = 0; i < BULK_TARGET; i++) {
		const domain = DOMAINS[i % DOMAINS.length];
		const subject = domain.subjects[Math.floor(i / DOMAINS.length) % domain.subjects.length];
		const variant = Math.floor(i / (DOMAINS.length * domain.subjects.length)) + 1;
		const title = variant > 1 ? `${subject} ${variant}` : subject;

		// Long tail: mostly short/medium notes, a few genuinely long ones.
		const roll = rng();
		const words = roll < 0.5 ? 60 + Math.floor(rng() * 120) : roll < 0.85 ? 300 + Math.floor(rng() * 500) : 1200 + Math.floor(rng() * 1400);

		const lead = `${title} is a recurring topic in ${domain.name.toLowerCase()}. ${fillerSentence(domain)}`;
		const body = buildBody(domain, words, lead);
		const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		const content = `${frontmatter([domain.tag])}# ${title}\n\n${body}\n`;
		write(domain, slug, content);
	}

	const totalWords = written.reduce((sum, w) => sum + w.words, 0);
	const lengths = written.map((w) => w.words).sort((a, b) => a - b);
	const median = lengths[Math.floor(lengths.length / 2)];
	console.log(`Wrote ${written.length} notes to ${corpusRoot}`);
	console.log(`  probes: ${PROBES.length}, distractors: ${DISTRACTORS.length}`);
	console.log(`  words: total ${totalWords}, median ${median}, min ${lengths[0]}, max ${lengths[lengths.length - 1]}`);
}

main();
