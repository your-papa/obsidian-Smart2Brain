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
 * A second tier (`HARD_PROBES`) exists for a different purpose: those notes are shaped
 * to *discriminate between embedding models* rather than to guard the ranker. The
 * properties above are all saturated — every strong model scores ~1.0 — so they cannot
 * show that one model is better than another. See the `HARD_PROBES` block for the four
 * axes and `integration/README.md` for how the results are read.
 *
 * Deterministic: a fixed-seed PRNG means re-running produces byte-identical output,
 * so regenerating never shows up as benchmark noise.
 *
 * Usage:
 *   bun run scripts/generate-search-corpus.ts [--out <vault path>] [--clean]
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	/**
	 * German equivalents of `vocabulary`, for the cross-lingual notes.
	 *
	 * Without these the German filler would still carry English technical terms
	 * ("Wie stark photic zone tatsächlich wirkt…"), leaving the note code-mixed. An
	 * English-only embedder would then get free traction from the very terms the
	 * cross-lingual case is supposed to withhold, and the axis would measure nothing.
	 */
	vocabularyDe: readonly string[];
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
		vocabularyDe: [
			"Salzgehalt",
			"Bodenzone",
			"Freiwasserzone",
			"Symbiose",
			"Larvenverdriftung",
			"Nahrungskette",
			"Auftriebsströmung",
			"Lichtzone",
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
		vocabularyDe: [
			"Basispunkte",
			"Gegenpartei",
			"Bilanzsumme",
			"Transmissionsmechanismus",
			"nominaler Anker",
			"Laufzeitprämie",
			"Repomarkt",
			"Produktionslücke",
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
		vocabularyDe: [
			"x-Höhe",
			"Laufweite",
			"Zeilenabstand",
			"Serifenansatz",
			"Strichkontrast",
			"Geviert",
			"Zeichenvorrat",
			"diakritische Zeichen",
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
		vocabularyDe: [
			"anaerob",
			"Animpfen",
			"Kahmhaut",
			"Säuregrad",
			"Substrat",
			"Teigausbeute",
			"osmotischer Druck",
			"Nachgärung",
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
	/** Render filler prose and headings in German, so the note is monolingual German. */
	german?: boolean;
}

const PROBES: readonly Probe[] = [
	{
		slug: "photovoltaic-array-degradation",
		domain: "Marine Biology",
		title: "Photovoltaic Array Degradation Offshore",
		// Query will say "solar panel wear at sea" — no shared content words.
		answer: "Offshore photovoltaic arrays lose roughly half a percent of rated output each year, driven mainly by salt-spray corrosion of the cell interconnects rather than by ultraviolet damage.",
		aliases: ["Offshore Solar Wear"],
		tags: ["degradation"],
		words: 1800,
		repeatAnswerLate: true,
	},
	{
		slug: "cephalopod-problem-solving",
		domain: "Marine Biology",
		title: "Cephalopod Problem Solving",
		answer: "Octopuses open sealed containers by rotating the lid counter-clockwise, and individuals retain the technique for at least three weeks without reinforcement.",
		aliases: ["Octopus Intelligence"],
		words: 240,
	},
	{
		slug: "policy-rate-transmission-lag",
		domain: "Monetary Policy",
		title: "Policy Rate Transmission Lag",
		answer: "A change in the overnight target reaches consumer borrowing costs after four to six quarters, with mortgage rates responding faster than small-business credit.",
		tags: ["transmission"],
		words: 2400,
		repeatAnswerLate: true,
	},
	{
		slug: "hyperinflation-episodes",
		domain: "Monetary Policy",
		title: "Hyperinflation Episodes",
		answer: "Once monthly price growth passes fifty percent, households abandon the domestic unit of account within weeks and switch to foreign currency for savings.",
		aliases: ["Runaway Price Growth"],
		words: 45,
	},
	{
		slug: "legibility-at-small-sizes",
		domain: "Typography",
		title: "Legibility at Small Sizes",
		answer: "Below nine points, open apertures and a generous x-height preserve character recognition far more effectively than increasing the stroke weight.",
		tags: ["legibility"],
		words: 900,
	},
	{
		slug: "starter-hydration-and-rise",
		domain: "Fermentation",
		title: "Starter Hydration and Rise Time",
		answer: "A hundred percent hydration starter doubles in about five hours at twenty-four degrees, while a stiff sixty percent starter takes nearly twice as long.",
		aliases: ["Levain Timing"],
		words: 1400,
		repeatAnswerLate: true,
	},
];

/**
 * Hard probes — the tier that exists to *discriminate between embedding models*.
 *
 * The `PROBES` above are saturated: every strong model scores ~1.0 on them, so they
 * can confirm a ranking regression but cannot tell a 22M-param local model from a
 * 600M one. These are built to have headroom, along the four axes where a small
 * distilled encoder is expected to give up ground:
 *
 *  - **multi-hop** — the query describes a *situation*; answering it means joining
 *    two facts stated in different sections. Term overlap and single-fact similarity
 *    both fail; only a model with real compositional signal ranks these.
 *  - **cross-lingual** — German queries against English notes and vice versa.
 *    bge-micro-v2 is English-distilled; harrier/qwen3 are multilingual. This is the
 *    axis most likely to disqualify a candidate outright.
 *  - **long-context** — the answering passage sits deep inside a deliberately
 *    *unstructured* section (no sub-headings for the chunker to split on), past the
 *    512-token window of small encoders. `unstructuredTail` builds that shape.
 *  - **dilution** — the answer is one sub-topic inside a note that genuinely covers
 *    many, reproducing the measured multi-topic signal collapse.
 *
 * Unlike `PROBES`, these are *expected* to score below 1.0 today. That is the point:
 * a benchmark with no headroom cannot measure an improvement or a downgrade.
 */
interface HardProbe extends Probe {
	/** Difficulty axis, mirrored in the judgment file's `tier` reporting. */
	axis: "multi-hop" | "cross-lingual" | "long-context" | "dilution";
	/**
	 * Second fact required to answer, placed in a *different* section from `answer`.
	 * Neither sentence alone is sufficient — this is what makes a case multi-hop.
	 */
	secondFact?: string;
	/**
	 * Bury `answer` this many words into a single heading-free section.
	 *
	 * The chunker splits on every heading level H1–H6, so a note with normal section
	 * structure never produces an oversized chunk no matter how long it is. Only an
	 * unbroken run of prose pushes the answer past a small model's token ceiling.
	 */
	unstructuredTail?: number;
	/** Sub-topics rendered as sibling sections, to dilute the answer's signal. */
	dilutionTopics?: readonly string[];
}

const HARD_PROBES: readonly HardProbe[] = [
	// ── multi-hop ───────────────────────────────────────────────────────────
	{
		slug: "vent-chemosynthesis-energy-budget",
		domain: "Marine Biology",
		title: "Vent Chemosynthesis Energy Budget",
		axis: "multi-hop",
		// Query: "why do vent communities collapse when the flow shifts" — neither
		// sentence answers that alone; the causal chain spans both.
		answer: "Tubeworm symbionts fix carbon using hydrogen sulfide drawn directly from the vent plume, and derive essentially none of their energy from surface-derived organic fall.",
		secondFact:
			"When a chimney's flow path reroutes, sulfide concentration at the original aperture falls to background within a matter of days.",
		words: 1600,
	},
	{
		slug: "reserve-scarcity-and-repo-spikes",
		domain: "Monetary Policy",
		title: "Reserve Scarcity and Repo Spikes",
		axis: "multi-hop",
		// Query: "what makes overnight funding costs suddenly spike" — requires
		// joining the balance-sheet mechanism to the intraday timing constraint.
		answer: "Once aggregate reserves fall below the level banks hold for intraday payment needs, the marginal borrower can no longer source cash at the target rate.",
		secondFact:
			"Settlement obligations cluster in the final hour of the trading day, so any shortfall in available cash is expressed as a price spike rather than a delay.",
		words: 1900,
	},
	// ── cross-lingual ───────────────────────────────────────────────────────
	{
		slug: "salzgehalt-und-larvenwanderung",
		domain: "Marine Biology",
		title: "Salzgehalt und Larvenwanderung",
		axis: "cross-lingual",
		// German note, English query ("how does freshwater runoff affect larval drift").
		answer: "Sinkt der Salzgehalt im Mündungsbereich nach starken Regenfällen unter zwanzig Promille, verlängert sich die pelagische Phase der Larven um mehrere Tage, wodurch sie deutlich weiter abgetrieben werden.",
		aliases: ["Larval Drift and Salinity"],
		words: 800,
		german: true,
	},
	{
		slug: "sauerteig-fuehrung-im-winter",
		domain: "Fermentation",
		title: "Sauerteigführung im Winter",
		axis: "cross-lingual",
		// German note, English query ("keeping a starter active in a cold kitchen").
		answer: "In einer ungeheizten Küche unter achtzehn Grad verschiebt sich das Verhältnis zugunsten der Essigsäurebakterien, weshalb der Ansatz häufiger und mit wärmerem Wasser aufgefrischt werden muss.",
		words: 700,
		german: true,
	},
	{
		slug: "variable-font-axis-registration",
		domain: "Typography",
		title: "Variable Font Axis Registration",
		axis: "cross-lingual",
		// English note, German query ("wie werden Schriftachsen genormt").
		answer: "Registered axes carry four-character tags reserved by the specification, while any foundry-defined axis must use an uppercase tag to avoid colliding with future registrations.",
		words: 750,
	},
	// ── long-context ────────────────────────────────────────────────────────
	{
		slug: "koji-substrate-preparation",
		domain: "Fermentation",
		title: "Koji Substrate Preparation",
		axis: "long-context",
		// The answer sits ~900 words into one heading-free section, so it lands well
		// past a 512-token window while remaining a single chunk for the chunker.
		answer: "Rice for koji must be polished to about ninety percent and steamed rather than boiled, because surface starch that gelatinizes in free water prevents the mycelium from penetrating the grain.",
		words: 400,
		unstructuredTail: 900,
	},
	{
		slug: "yield-curve-signal-decay",
		domain: "Monetary Policy",
		title: "Yield Curve Signal Decay",
		axis: "long-context",
		answer: "The inversion's predictive value weakens sharply once term premia turn negative, since the spread then reflects compressed compensation for duration rather than any expectation of policy easing.",
		words: 400,
		unstructuredTail: 1100,
	},
	// ── dilution ────────────────────────────────────────────────────────────
	{
		slug: "reef-survey-field-notes",
		domain: "Marine Biology",
		title: "Reef Survey Field Notes",
		axis: "dilution",
		// One genuine answer inside a note that really is about six other things.
		answer: "Transects run at dawn record roughly forty percent more grazing activity than the same lines walked at midday, which is enough to change the estimated herbivore load.",
		words: 300,
		dilutionTopics: [
			"Permit paperwork and site access",
			"Boat scheduling and fuel logs",
			"Camera housing maintenance",
			"Volunteer training rotations",
			"Sample jar labelling conventions",
			"Weather cancellation policy",
		],
	},
	{
		slug: "foundry-operations-log",
		domain: "Typography",
		title: "Foundry Operations Log",
		axis: "dilution",
		answer: "Hinting instructions authored for the regular weight cannot be reused on the condensed cut, because the stem positions shift relative to the pixel grid at every size below fourteen points.",
		words: 300,
		dilutionTopics: [
			"Licensing tiers and resellers",
			"Invoice reconciliation",
			"Specimen printing schedule",
			"Trademark filings",
			"Conference booth logistics",
			"Freelance contractor onboarding",
		],
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
	/**
	 * Render the note as a long multi-topic sprawl with these sibling sections,
	 * making it the corpus's *biggest* note for the query it decoys.
	 *
	 * This is what makes the benchmark two-sided on note size. Every other note
	 * shape here — probes and ordinary distractors alike — either rewards length
	 * or is neutral to it: graded targets skew long (median 8 headings against a
	 * corpus median of 4) and plain distractors are all under 700 words. So the
	 * suite could measure the *cost* of a length penalty and never its *benefit*,
	 * which is exactly how a measured chunk-count fix came to look purely
	 * negative (the measured A/B is recorded in `src/vectorstore/chunkAggregation.ts`).
	 *
	 * A note built this way is long, many-chunked, and shares the query's
	 * vocabulary across every section — while the actual answer lives in a short
	 * focused note elsewhere. It is the case where the many-chunk note must
	 * *lose*.
	 */
	padTopics?: readonly string[];
	/** Extra tags beyond the domain and `distractor` tags. */
	tags?: string[];
}

const DISTRACTORS: readonly Distractor[] = [
	{
		slug: "solar-panel-metaphors-in-design",
		domain: "Typography",
		title: "Solar Panel Metaphors in Signage Design",
		decoy: "Wayfinding signage for solar farms borrows the visual language of the panel grid: repeated rectangular modules, high contrast, and a cool blue cast. The panels themselves are only a motif here — this note is about sign layout, not about how any array performs or wears over time.",
		words: 700,
	},
	{
		slug: "interest-in-typography-history",
		domain: "Typography",
		title: "Interest and Rates of Change in Type History",
		decoy: "Interest in revival faces rose sharply after 1990, and the rate at which foundries released new families climbed with it. The words interest and rate appear throughout this note in their ordinary English sense, with no monetary meaning whatsoever.",
		words: 650,
	},
	{
		slug: "octopus-recipes",
		domain: "Fermentation",
		title: "Fermented Octopus Preparations",
		decoy: "Octopus is salted and left to ferment briefly before grilling. This note covers brining and texture, not animal behaviour, learning, or any container-opening problem solving.",
		words: 500,
	},
	{
		slug: "small-sizes-of-fermentation-vessels",
		domain: "Fermentation",
		title: "Small Sizes of Fermentation Vessels",
		decoy: "At small sizes, a vessel loses heat quickly and the ferment stalls. Small batch sizes also make the pH swing faster. Nothing here concerns reading, type, or character recognition.",
		words: 480,
	},

	// ── size-bias distractors ───────────────────────────────────────────────
	// Long, sprawling, many-chunk notes that share a query's vocabulary without
	// answering it. Each one is paired with a *short* graded target in
	// `relevanceJudgments.ts`, so the query is only answered correctly by a
	// ranker that does not reward surface area.
	//
	// These are the notes with the most chunks in the whole corpus, and they are
	// all wrong answers. Sized well past the largest probe (2400 words) so the
	// max-of-N advantage they enjoy is the largest available anywhere.
	{
		slug: "octopus-husbandry-program-notes",
		domain: "Marine Biology",
		title: "Octopus Husbandry Program Notes",
		// Decoys "can an octopus learn to open a sealed jar" — every word of the
		// query appears, but the note is about tank logistics, never about
		// learning, retention, or container opening.
		decoy: "Running an octopus program means keeping sealed tanks, jar-style feeders, and lids in constant rotation. This is a logistics and husbandry record: stocking, transport, water chemistry, and enclosure hardware. It does not describe what any animal learns, how long a technique is retained, or whether a container can be opened.",
		words: 2200,
		padTopics: [
			"Stocking and Transport",
			"Enclosure Hardware",
			"Water Chemistry Logs",
			"Feeding Schedules",
			"Lid and Seal Inventory",
			"Staffing Rotations",
			"Supplier Correspondence",
			"Budget Notes",
		],
		tags: ["size-bias"],
	},
	{
		slug: "type-specimen-production-handbook",
		domain: "Typography",
		title: "Type Specimen Production Handbook",
		// Decoys "what makes very small text readable" — saturated with "small",
		// "text", "readable", "size", while being about print production workflow.
		decoy: "A specimen book sets text at every size the family supports, from very small captions upward, and the print run must stay readable across all of them. This handbook covers paper stock, ink density, binding, and proofing schedules. It records no findings about aperture, x-height, stroke weight, or why any size is legible.",
		words: 3600,
		padTopics: [
			"Paper Stock Selection",
			"Ink Density and Proofing",
			"Binding and Trim",
			"Colour Management",
			"Press Scheduling",
			"Client Sign-off",
			"Archive and Reprints",
			"Vendor Contacts",
			"Sample Distribution",
			"Storage Conditions",
			"Reorder Thresholds",
			"Courier Arrangements",
			"Damage Claims",
			"Invoice Reconciliation",
			"Studio Calendar",
			"Equipment Servicing",
			"Trade Show Logistics",
			"Mailing List Upkeep",
		],
		tags: ["size-bias"],
	},
	{
		slug: "central-bank-communications-archive",
		domain: "Monetary Policy",
		title: "Central Bank Communications Archive",
		// Decoys "how long before a rate change reaches borrowers" — full of
		// "rate", "change", "borrowers", but it is a press-office filing record.
		decoy: "This archive files every statement in which a rate change was announced, along with the press schedule and the borrower-facing summaries issued alongside it. It is a record of how announcements were published and when, not of how long transmission takes or which borrowers feel a change first.",
		words: 5000,
		padTopics: [
			"Press Release Index",
			"Embargo Procedures",
			"Speech Transcripts",
			"Translation Workflow",
			"Website Publication Log",
			"Media Contact List",
			"Accessibility Requirements",
			"Retention Policy",
			"Photo Library",
			"Broadcast Bookings",
			"Correction Notices",
			"Style Guide Updates",
			"Intranet Mirroring",
			"Freedom of Information Requests",
			"Briefing Room Bookings",
			"Interpreter Roster",
			"Distribution Lists",
			"Archive Migration",
			"Social Channel Log",
			"Approval Chain",
			"Template Revisions",
			"Vendor Contracts",
			"Training Records",
			"Incident Reports",
			"Quarterly Review Notes",
			"Budget Allocation",
			"Filing Conventions",
			"Access Permissions",
		],
		tags: ["size-bias"],
	},
	{
		slug: "bakery-equipment-maintenance-log",
		domain: "Fermentation",
		title: "Bakery Equipment Maintenance Log",
		// Decoys "how long does a wet sourdough starter take to double" — repeats
		// "sourdough", "starter", "wet", "double" in an equipment context.
		decoy: "Maintenance record for the sourdough line: the starter fridge, the wet-mix hopper, and the double-deck oven. Entries cover servicing intervals, part numbers, and downtime. Nothing here measures how long any starter takes to rise, double, or respond to hydration.",
		words: 3800,
		padTopics: [
			"Mixer Servicing",
			"Oven Calibration",
			"Refrigeration Units",
			"Spare Part Numbers",
			"Downtime Incidents",
			"Cleaning Schedules",
			"Safety Inspections",
			"Warranty Records",
			"Proofer Humidity Sensors",
			"Scale Calibration",
			"Water Filter Changes",
			"Extraction Fan Servicing",
			"Trolley and Rack Repairs",
			"Supplier Call-outs",
			"Consumables Stock",
			"Shift Handover Notes",
			"Electrical Testing",
			"Pest Control Visits",
			"Waste Disposal Log",
			"Contractor Access",
		],
		tags: ["size-bias"],
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

/**
 * Filler prose drawn from a caller-supplied PRNG rather than the shared `rng`.
 *
 * Every note built through the shared generator consumes draws from one global
 * stream, so *inserting* a note anywhere except the very end silently rewrites
 * every note generated after it. That is not a cosmetic problem: the benchmark's
 * recency and crowding cases name specific filler notes, and a corpus-wide
 * reshuffle would move every score at once while looking like a ranking change.
 *
 * Notes that need to be insertable without disturbing their neighbours (the
 * size-bias distractors) pass their own independently-seeded PRNG here.
 */
function fillerSentenceFrom(domain: Domain, rand: () => number): string {
	const choose = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
	const a = choose(domain.vocabulary);
	const b = choose(domain.vocabulary);
	const templates = [
		`Practitioners disagree about ${a}, though most accounts treat ${b} as the limiting factor.`,
		`Measurements of ${a} vary widely between sites, which complicates any comparison against ${b}.`,
		`The relationship between ${a} and ${b} is rarely linear, and small deviations accumulate over a season.`,
		`Field records covering ${a} are uneven, so conclusions about ${b} stay provisional.`,
		`Routine handling of ${a} is well documented; ${b} receives far less attention in the same sources.`,
	];
	return choose(templates);
}

const GERMAN_SECTION_TITLES = [
	"Hintergrund",
	"Vorgehen",
	"Beobachtungen",
	"Messung",
	"Häufige Fehler",
	"Praktische Hinweise",
	"Offene Fragen",
] as const;

/**
 * German filler, so a cross-lingual note is German *throughout* rather than a German
 * sentence embedded in English prose. A model that only handles English must fail on
 * the whole note, not merely on one line of it — otherwise the surrounding English
 * would hand it the match for free and the case would measure nothing.
 */
function germanFillerSentence(domain: Domain): string {
	const a = pick(domain.vocabularyDe);
	const b = pick(domain.vocabularyDe);
	const templates = [
		`Die Fachliteratur behandelt ${a} ausführlich, während ${b} meist nur am Rande erwähnt wird.`,
		`Wie stark ${a} tatsächlich wirkt, hängt erheblich von den örtlichen Bedingungen ab.`,
		`Zwischen ${a} und ${b} besteht kein linearer Zusammenhang, kleine Abweichungen summieren sich über eine Saison.`,
		`Angaben zu ${a} schwanken je nach Quelle deutlich, was den Vergleich mit ${b} erschwert.`,
		`In der Praxis lässt sich ${a} nur selten unabhängig von ${b} beurteilen.`,
	];
	return pick(templates);
}

/**
 * Build one heading-free run of prose with `answer` buried `depth` words deep.
 *
 * The chunker splits on every heading level, so section structure — not note length —
 * decides chunk size. A long *structured* note yields many small chunks and never
 * exercises a token ceiling. Only unbroken prose produces a chunk big enough for the
 * answer to fall outside a 512-token window.
 */
function buildUnstructuredTail(domain: Domain, depth: number, answer: string, german?: boolean): string {
	const sentences: string[] = [];
	let count = 0;
	while (count < depth) {
		const sentence = german ? germanFillerSentence(domain) : fillerSentence(domain);
		sentences.push(sentence);
		count += sentence.split(/\s+/).length;
	}
	sentences.push(answer);
	// A little prose after the answer as well, so it is not merely "the last line" —
	// a ranker must not be able to find it by position alone.
	for (let i = 0; i < 6; i++) {
		sentences.push(german ? germanFillerSentence(domain) : fillerSentence(domain));
	}
	return sentences.join(" ");
}

/** Generate a body of approximately `words` words, split into `##` sections. */
function buildBody(domain: Domain, words: number, leadPara: string, repeatLate?: string, german?: boolean): string {
	const parts: string[] = [leadPara];
	let count = leadPara.split(/\s+/).length;

	const sections = shuffled(german ? GERMAN_SECTION_TITLES : SECTION_TITLES);
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
			const sentence = german ? germanFillerSentence(domain) : fillerSentence(domain);
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
		const body = buildBody(domain, probe.words, probe.answer, probe.repeatAnswerLate ? probe.answer : undefined);
		const content = `${frontmatter([domain.tag, ...(probe.tags ?? [])], probe.aliases)}# ${probe.title}\n\n${body}\n`;
		write(domain, probe.slug, content);
	}

	// 2. Hard probe notes — the model-discrimination tier. Each axis needs a
	//    different note *shape*, so these are built explicitly rather than through
	//    the standard body builder.
	for (const probe of HARD_PROBES) {
		const domain = domainByName(probe.domain);
		let body: string;

		if (probe.axis === "long-context" && probe.unstructuredTail) {
			// Normal sections first, then one unbroken run with the answer buried in it.
			const lead = probe.german
				? `${probe.title} betrifft mehrere Teilbereiche.`
				: `${probe.title} spans several practical concerns.`;
			const structured = buildBody(domain, probe.words, lead, undefined, probe.german);
			const tailHeading = probe.german ? "Ausführliche Darstellung" : "Extended Discussion";
			const tail = buildUnstructuredTail(domain, probe.unstructuredTail, probe.answer, probe.german);
			body = `${structured}\n\n## ${tailHeading}\n\n${tail}`;
		} else if (probe.axis === "dilution" && probe.dilutionTopics) {
			// The answer is one section among many genuinely different sub-topics, so
			// the note-level embedding is an average over topics that share nothing.
			const parts: string[] = [
				probe.german
					? `Sammelnotiz zu ${probe.title}.`
					: `Working notes for ${probe.title}, covering everything the project touches.`,
			];
			for (const topic of probe.dilutionTopics) {
				parts.push(`\n## ${topic}\n`);
				const sentences: string[] = [];
				let n = 0;
				while (n < 110) {
					const sentence = probe.german ? germanFillerSentence(domain) : fillerSentence(domain);
					sentences.push(sentence);
					n += sentence.split(/\s+/).length;
				}
				parts.push(sentences.join(" "));
			}
			// Answer section placed in the middle of the topic list, not at either end.
			const insertAt = 1 + 2 * Math.floor(probe.dilutionTopics.length / 2);
			const answerHeading = probe.german ? "Feldbeobachtung" : "Field Observation";
			parts.splice(insertAt, 0, `\n## ${answerHeading}\n`, probe.answer);
			body = parts.join("\n");
		} else if (probe.axis === "multi-hop" && probe.secondFact) {
			// The two required facts sit in different sections so no single chunk
			// contains both — the join has to happen at retrieval time.
			const lead = probe.german
				? `${probe.title} wird in mehreren getrennten Abschnitten behandelt.`
				: `${probe.title} is discussed across several distinct threads.`;
			const structured = buildBody(domain, probe.words, lead, undefined, probe.german);
			const halves = structured.split("\n## ");
			const mid = Math.max(1, Math.floor(halves.length / 2));
			const withFirst = [
				...halves.slice(0, mid),
				`${probe.german ? "Wirkmechanismus" : "Mechanism Detail"}\n\n${probe.answer}`,
				...halves.slice(mid),
				`${probe.german ? "Auswirkung im Betrieb" : "Operational Consequence"}\n\n${probe.secondFact}`,
			];
			body = withFirst.join("\n## ");
		} else {
			body = buildBody(domain, probe.words, probe.answer, undefined, probe.german);
		}

		const content = `${frontmatter([domain.tag, "hard", probe.axis], probe.aliases)}# ${probe.title}\n\n${body}\n`;
		write(domain, probe.slug, content);
	}

	// 3. Distractor notes — lexically tempting, semantically wrong.
	//
	//    Entries carrying `padTopics` are the size-bias variants: long multi-topic
	//    sprawls that must *lose* to a short focused note.
	//
	//    They draw from their own per-note PRNG rather than the shared `rng`. The
	//    bulk-filler loop below runs *after* this one off the same shared stream,
	//    so a distractor that consumed shared draws would rewrite all ~285 filler
	//    notes — and the judgments name specific filler notes by slug. Isolating
	//    the seed keeps adding a distractor a genuinely additive change.
	for (const distractor of DISTRACTORS) {
		const domain = domainByName(distractor.domain);
		const tags = [domain.tag, "distractor", ...(distractor.tags ?? [])];

		let body: string;
		if (distractor.padTopics) {
			// Same shape as the `dilution` hard probe: many sibling sections on
			// unrelated sub-topics. Here the point is bulk rather than dilution —
			// the note has no answer to dilute, it just accumulates chunks.
			//
			// Seeded from the slug so each note is stable and independent of how
			// many distractors precede it.
			let seed = 0x9e3779b9;
			for (const ch of distractor.slug) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
			const localRng = makeRng(seed);

			const parts: string[] = [distractor.decoy];
			const perTopic = Math.max(60, Math.floor(distractor.words / distractor.padTopics.length));
			for (const topic of distractor.padTopics) {
				parts.push(`\n## ${topic}\n`);
				const sentences: string[] = [];
				let n = 0;
				while (n < perTopic) {
					const sentence = fillerSentenceFrom(domain, localRng);
					sentences.push(sentence);
					n += sentence.split(/\s+/).length;
				}
				parts.push(sentences.join(" "));
			}
			body = parts.join("\n");
		} else {
			body = buildBody(domain, distractor.words, distractor.decoy);
		}

		const content = `${frontmatter(tags)}# ${distractor.title}\n\n${body}\n`;
		write(domain, distractor.slug, content);
	}

	// 4. Bulk filler — gives the corpus realistic scale so rank-sensitive behaviour
	//    (cutoffs, normalization) is exercised rather than trivially satisfied.
	//    Lengths follow a long-tailed spread instead of the old bimodal fixture.
	//
	//    Fixed *filler* count, deliberately not a fixed corpus total. When this was
	//    `300 - written.length`, adding a probe note silently deleted a filler note
	//    from the tail of the series — which broke a judgment case referencing
	//    `sourdough-starter-maintenance-8` by name. Judgments name filler notes, so
	//    the filler set must not shift when cases are added.
	const BULK_TARGET = 285;
	for (let i = 0; i < BULK_TARGET; i++) {
		const domain = DOMAINS[i % DOMAINS.length];
		const subject = domain.subjects[Math.floor(i / DOMAINS.length) % domain.subjects.length];
		const variant = Math.floor(i / (DOMAINS.length * domain.subjects.length)) + 1;
		const title = variant > 1 ? `${subject} ${variant}` : subject;

		// Long tail: mostly short/medium notes, a few genuinely long ones.
		const roll = rng();
		const words =
			roll < 0.5
				? 60 + Math.floor(rng() * 120)
				: roll < 0.85
					? 300 + Math.floor(rng() * 500)
					: 1200 + Math.floor(rng() * 1400);

		const lead = `${title} is a recurring topic in ${domain.name.toLowerCase()}. ${fillerSentence(domain)}`;
		const body = buildBody(domain, words, lead);
		const slug = title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
		const content = `${frontmatter([domain.tag])}# ${title}\n\n${body}\n`;
		write(domain, slug, content);
	}

	// Guard: judgment cases reference specific filler notes by name (the recency and
	// near-duplicate crowding cases lean on the `sourdough-starter-maintenance-*`
	// series). A change that shortens the filler run would otherwise degrade those
	// cases silently — the note simply stops existing and quietly scores as absent.
	// Fail loudly here instead.
	const REQUIRED_FILLER = [
		"Fermentation/sourdough-starter-maintenance-8.md",
		"Fermentation/sourdough-starter-maintenance-4.md",
		"Fermentation/sourdough-starter-maintenance-3.md",
	];
	const writtenRelative = new Set(written.map((w) => w.path.slice(corpusRoot.length + 1)));
	const missing = REQUIRED_FILLER.filter((p) => !writtenRelative.has(p));
	if (missing.length > 0) {
		throw new Error(
			`Filler notes referenced by RELEVANCE_JUDGMENTS were not generated: ${missing.join(", ")}.\n` +
				`BULK_TARGET (${BULK_TARGET}) is too low, or the filler naming changed. ` +
				`Raise it — do not silently drop the notes the benchmark grades against.`,
		);
	}

	// Guard: the size-bias axis only measures anything if its distractors really are
	// the longest notes competing for their query. If one of them stopped being
	// long — a `words` edit, a dropped `padTopics` — the axis would keep reporting a
	// score while silently testing nothing. Assert the shape, not just the presence.
	const chunkishHeadings = (content: string) => (content.match(/^## /gm) ?? []).length;
	for (const distractor of DISTRACTORS) {
		if (!distractor.padTopics) continue;
		const domain = domainByName(distractor.domain);
		const rel = `${domain.name}/${distractor.slug}.md`;
		const entry = written.find((w) => w.path.slice(corpusRoot.length + 1) === rel);
		if (!entry) {
			throw new Error(`Size-bias distractor was not generated: ${rel}`);
		}
		const headings = chunkishHeadings(readFileSync(entry.path, "utf8"));
		if (entry.words < 2000 || headings < 8) {
			throw new Error(
				`Size-bias distractor ${rel} is too small to test anything: ` +
					`${entry.words} words / ${headings} sections (need >=2000 words and >=8 sections).\n` +
					`These notes exist to out-chunk the short note that actually answers their query — ` +
					`the chunker splits on headings, so it is the section count that decides. If a graded ` +
					`target gains sections, its distractor must gain more or the axis measures nothing.`,
			);
		}
	}

	const totalWords = written.reduce((sum, w) => sum + w.words, 0);
	const lengths = written.map((w) => w.words).sort((a, b) => a - b);
	const median = lengths[Math.floor(lengths.length / 2)];
	console.log(`Wrote ${written.length} notes to ${corpusRoot}`);
	console.log(`  probes: ${PROBES.length}, hard probes: ${HARD_PROBES.length}, distractors: ${DISTRACTORS.length}`);
	console.log(
		`  words: total ${totalWords}, median ${median}, min ${lengths[0]}, max ${lengths[lengths.length - 1]}`,
	);
}

main();
