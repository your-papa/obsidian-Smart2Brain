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

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_VAULT = "integration/S2B Test Vault";
/** Corpus lives in its own folder so it is trivially separable from hand-written fixtures. */
const CORPUS_DIR = "Corpus";
/**
 * The Zettelkasten layer, flat by design (see `ZETTEL_NOTES`).
 *
 * It is a sibling of `Corpus/` rather than a subfolder of it because the two are
 * organised on opposite principles — `Corpus/` is topic-foldered, this is a single
 * directory — and mixing them would give these notes a folder signal they are
 * specifically meant to lack.
 */
const ZETTEL_DIR = "Zettel";
/** Applied to every Zettel note so the layer is filterable as a unit. */
const ZETTEL_TAG = "zettel";

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
	/**
	 * Alternate titles for a subject's repeat notes, keyed by subject name.
	 *
	 * The bulk filler has 40 unique subjects and 285 notes to produce, so each subject
	 * recurs about seven times. That used to be rendered as `Kimchi Seasonality 2`
	 * through `Kimchi Seasonality 7`, which is a shape no real vault has: people write
	 * several notes that circle the same idea from different angles, under different
	 * names, months apart — they do not number them.
	 *
	 * The numbered scheme also made the crowding *too easy to spot*. Sibling notes
	 * sharing a title stem give a ranker a free grouping signal (and `getNumericSuffixPenalty`
	 * in `lexicalScoring.ts` explicitly keys on a trailing number), where real
	 * near-duplicates are only discoverable through their overlapping vocabulary.
	 *
	 * Each entry supplies distinct titles that stay recognisably about the same subject
	 * — that topical overlap is the whole point of the filler, since two judgment cases
	 * grade these siblings at 0 to make crowding cost score.
	 *
	 * **Variant 1 keeps the plain subject name.** Four judgment cases grade a base note
	 * (`koji-cultivation`, `variable-font-axes`, `yield-curve-inversion`,
	 * `hinting-and-rasterization`) at 1 as a genuinely-related result, so those slugs
	 * must survive. It also mirrors a real vault: one canonical note on a topic, plus
	 * scattered related ones.
	 */
	variantTitles: Readonly<Record<string, readonly string[]>>;
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
		variantTitles: {
			"Coral Reef Bleaching": [
				"Thermal Stress Thresholds on the Outer Reef",
				"Zooxanthellae Expulsion Timeline",
				"Recovery Rates After the 2024 Event",
				"Bleaching Severity by Depth Band",
				"Reef Mortality Follow-up Surveys",
				"Shading Trials on Nursery Colonies",
				"Symbiont Shuffling and Heat Tolerance",
			],
			"Deep Sea Hydrothermal Vents": [
				"Chimney Formation and Mineral Deposition",
				"Black Smoker Temperature Profiles",
				"Vent Field Mapping Notes",
				"Tubeworm Colony Density Counts",
				"Plume Chemistry Sampling Runs",
				"Vent Site Succession After Eruption",
				"Sulfide Gradient Measurements",
			],
			"Cephalopod Cognition": [
				"Maze Navigation Trials",
				"Colour Change and Signalling",
				"Tool Use in Captive Settings",
				"Arm Coordination Studies",
				"Individual Recognition Experiments",
				"Play Behaviour Observations",
				"Memory Retention Across Weeks",
			],
			"Whale Migration Routes": [
				"Acoustic Tracking in the North Atlantic",
				"Calving Ground Arrival Dates",
				"Feeding Stopover Duration",
				"Route Shifts and Water Temperature",
				"Satellite Tag Recovery Notes",
				"Shipping Lane Overlap Analysis",
				"Population Segment Boundaries",
			],
			"Plankton Blooms": [
				"Spring Bloom Onset Timing",
				"Nutrient Loading and Bloom Size",
				"Harmful Algal Event Records",
				"Chlorophyll Satellite Estimates",
				"Grazing Pressure on Bloom Decline",
				"Diatom to Dinoflagellate Succession",
				"Bloom Patchiness at Small Scales",
			],
			"Mangrove Nurseries": [
				"Juvenile Fish Density in Prop Roots",
				"Seedling Survival After Transplant",
				"Sediment Accretion Measurements",
				"Storm Buffering Capacity",
				"Crab Burrow Density Surveys",
				"Salinity Tolerance by Species",
				"Restoration Site Selection Notes",
			],
			"Shark Population Decline": [
				"Bycatch Rates in Longline Fisheries",
				"Fin Trade Volume Estimates",
				"Nursery Habitat Loss Assessment",
				"Tagging Study Recapture Rates",
				"Protected Area Effectiveness",
				"Age at Maturity by Species",
				"Trophic Effects of Predator Removal",
			],
			"Tidal Zone Ecology": [
				"Zonation Bands on Rocky Shores",
				"Desiccation Tolerance in Limpets",
				"Barnacle Settlement Timing",
				"Wave Exposure and Community Structure",
				"Tide Pool Temperature Extremes",
				"Grazer Exclusion Experiments",
				"Mussel Bed Recovery After Scour",
			],
			Bioluminescence: [
				"Luciferin Chemistry Across Taxa",
				"Counter-illumination in Midwater Fish",
				"Dinoflagellate Flash Kinetics",
				"Bacterial Symbiont Light Organs",
				"Depth Distribution of Luminous Species",
				"Burglar Alarm Hypothesis Notes",
				"Field Photometry Methods",
			],
			"Ocean Acidification": [
				"Aragonite Saturation Trends",
				"Shell Thinning in Pteropods",
				"pH Time Series from Moorings",
				"Larval Development Under Low pH",
				"Coastal Upwelling and Corrosive Water",
				"Calcification Rate Experiments",
				"Carbonate Chemistry Sampling Protocol",
			],
		},
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
		variantTitles: {
			"Interest Rate Corridors": [
				"Floor Systems Versus Corridor Systems",
				"Standing Facility Spread Design",
				"Overnight Rate Dispersion Within the Band",
				"Corridor Width and Interbank Activity",
				"Deposit Facility Take-up Patterns",
				"Ceiling Breaches and Emergency Lending",
				"Corridor Adjustments Across Cycles",
			],
			"Quantitative Tightening": [
				"Runoff Caps and Portfolio Composition",
				"Balance Sheet Normalisation Paths",
				"Market Absorption of Maturing Holdings",
				"Reserve Drainage Estimates",
				"Duration Extraction Effects",
				"Announcement Effects on Long Yields",
				"Coordination With Rate Policy",
			],
			"Inflation Expectations": [
				"Survey Versus Market-Implied Measures",
				"Household Expectation Dispersion",
				"Breakeven Rates and Liquidity Premia",
				"Anchoring After Supply Shocks",
				"Firm Pricing Intentions Data",
				"Expectation Formation and Salience",
				"Long-Horizon Stability Checks",
			],
			"Yield Curve Inversion": [
				"Historical Lead Times to Recession",
				"Spread Choice and Signal Quality",
				"Inversion Depth Versus Duration",
				"Cross-Country Inversion Comparisons",
				"Term Premium Decomposition Methods",
				"False Positives in the Record",
				"Curve Steepening After Trough",
			],
			"Reserve Requirements": [
				"Averaging Periods and Compliance",
				"Remuneration of Required Balances",
				"Requirement Ratios Across Jurisdictions",
				"Abolition and Its Consequences",
				"Vault Cash Eligibility Rules",
				"Requirements as a Liquidity Tool",
				"Small Bank Exemption Thresholds",
			],
			"Currency Pegs": [
				"Defence Costs During Speculative Attack",
				"Crawling Peg Mechanics",
				"Reserve Adequacy for Fixed Regimes",
				"Peg Abandonment Case Studies",
				"Currency Board Arrangements",
				"Parallel Market Premium Dynamics",
				"Basket Weighting Choices",
			],
			"Open Market Operations": [
				"Repo Versus Outright Purchase Mechanics",
				"Auction Format and Bidder Behaviour",
				"Collateral Eligibility Schedules",
				"Fine-Tuning Operations Frequency",
				"Counterparty Access Criteria",
				"Operation Size and Rate Impact",
				"Settlement Timing Conventions",
			],
			"Liquidity Traps": [
				"Zero Lower Bound Constraints",
				"Portfolio Rebalancing Under Satiation",
				"Fiscal Multipliers at the Bound",
				"Negative Rate Experiments",
				"Expectations Management as Substitute",
				"Cash Hoarding Thresholds",
				"Escape Conditions From the Trap",
			],
			"Forward Guidance": [
				"Calendar Versus State Contingent Forms",
				"Credibility and Time Inconsistency",
				"Guidance Revisions and Market Reaction",
				"Odyssean Versus Delphic Readings",
				"Dot Plot Communication Effects",
				"Guidance Under Uncertainty",
				"Exit Language Design",
			],
			Seigniorage: [
				"Revenue From Currency Issuance",
				"Inflation Tax Incidence",
				"Note Denomination and Demand",
				"Digital Currency Effects on Revenue",
				"Historical Debasement Episodes",
				"Central Bank Profit Remittance",
				"Seigniorage Under Dollarisation",
			],
		},
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
		variantTitles: {
			"Optical Sizing": [
				"Display Cuts Versus Text Cuts",
				"Stroke Compensation at Caption Sizes",
				"Optical Size Axis Interpolation",
				"Spacing Adjustments Across Sizes",
				"Historical Punchcutter Practice",
				"Automatic Optical Size Selection",
				"Contrast Reduction in Small Optical Masters",
			],
			"Kerning Pairs": [
				"Pair Coverage in Large Character Sets",
				"Class-Based Kerning Strategies",
				"Diagonal and Round Collisions",
				"Kerning Versus Spacing Decisions",
				"Numeral Pair Handling",
				"Kern Table Size and Performance",
				"Testing Pairs With Real Text",
			],
			"Variable Font Axes": [
				"Weight Axis Interpolation Quality",
				"Custom Axis Naming Conventions",
				"Instance Selection and Named Styles",
				"Axis Count and File Size",
				"Slant Versus Italic Axis Behaviour",
				"Designspace Master Placement",
				"Fallback Rendering Without Variation Support",
			],
			"Grotesque Sans Serifs": [
				"Terminal Shapes in Early Grotesques",
				"Neo-Grotesque Revival Families",
				"Aperture Closure and Texture",
				"Capital Proportions in the Genre",
				"Grotesque Italics as Obliques",
				"Numeral Design Conventions",
				"Regional Variants and Naming",
			],
			"Baseline Grids": [
				"Grid Alignment Across Type Sizes",
				"Leading Ratios and Grid Increments",
				"Figure Placement Against the Grid",
				"Multi-Column Grid Reconciliation",
				"Grid Breaks for Display Elements",
				"Screen Versus Print Grid Behaviour",
				"Rounding Errors in Grid Implementation",
			],
			"Hinting and Rasterization": [
				"Grid Fitting at Low Resolutions",
				"Autohinting Output Quality",
				"Subpixel Rendering Interactions",
				"Delta Instruction Maintenance",
				"Stem Snapping Behaviour",
				"Rendering Across Operating Systems",
				"Hinting Cost in Production Schedules",
			],
			"Ligature Design": [
				"Standard Versus Discretionary Sets",
				"Collision Cases Requiring Ligatures",
				"Script Ligature Complexity",
				"Ligature Substitution Ordering",
				"Historical Ligature Revival",
				"Ligatures in Monospaced Faces",
				"Language-Specific Ligature Rules",
			],
			"Type Foundries": [
				"Independent Foundry Business Models",
				"Distribution and Retail Splits",
				"Custom Commission Workflows",
				"Library Curation Decisions",
				"Foundry Naming and Identity",
				"Archive and Reissue Programmes",
				"Collaborative Release Structures",
			],
			"Counters and Apertures": [
				"Counter Size and Perceived Weight",
				"Aperture Openness in Text Faces",
				"Closed Counters at Small Sizes",
				"Counter Shape and Family Coherence",
				"Ink Trap Placement",
				"Counter Consistency Across Weights",
				"Measurement Conventions for Counters",
			],
			"Reading Cadence": [
				"Saccade Length and Line Width",
				"Fixation Duration Across Faces",
				"Rhythm in Densely Set Text",
				"Paragraph Shape and Reading Flow",
				"Interruption Recovery in Long Text",
				"Cadence in Bilingual Settings",
				"Measuring Reading Speed Reliably",
			],
		},
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
		variantTitles: {
			"Sourdough Starter Maintenance": [
				"Refresh Ratios for Daily Baking",
				"Reviving a Neglected Culture",
				"Fridge Storage Between Bakes",
				"Discard Volume and Waste Reduction",
				"Flour Switches and Culture Response",
				"Off Smells and What They Indicate",
				"Travel and Long Dormancy Handling",
			],
			"Lactic Acid Bacteria": [
				"Homofermentative Versus Heterofermentative Strains",
				"Strain Succession in Mixed Cultures",
				"Acid Production Rates by Temperature",
				"Bacteriocin Activity Against Spoilage",
				"Salt Tolerance Across Species",
				"Starter Culture Selection Criteria",
				"Population Counts Through Fermentation",
			],
			"Koji Cultivation": [
				"Incubation Humidity Control",
				"Mycelium Coverage Assessment",
				"Tray Versus Bed Cultivation",
				"Spore Inoculation Rates",
				"Heat Generation During Growth",
				"Harvest Timing and Enzyme Activity",
				"Contamination Prevention Practices",
			],
			"Kombucha Scoby Health": [
				"Pellicle Thickness and Vigour",
				"Acetic Versus Lactic Balance",
				"Mould Identification and Response",
				"Hotel Storage Between Batches",
				"Tea Type Effects on Culture",
				"Yeast Sediment Interpretation",
				"Culture Sharing and Transport",
			],
			"Brine Concentration": [
				"Percentage Calculations by Weight",
				"Vegetable Water Content Adjustments",
				"Dry Salting Versus Wet Brine",
				"Brine Cloudiness Causes",
				"Salt Type and Mineral Content",
				"Concentration Drift Over Time",
				"Low Salt Ferments and Risk",
			],
			"Wild Yeast Capture": [
				"Fruit Versus Flour Starters",
				"First Rise Timing Expectations",
				"Regional Variation in Captured Strains",
				"Failed Capture Troubleshooting",
				"Water Chemistry and Establishment",
				"Capture Season and Success Rate",
				"Stabilising a New Culture",
			],
			"Miso Aging": [
				"Salt Percentage and Aging Duration",
				"Tamari Formation on the Surface",
				"Vessel Choice and Oxygen Exposure",
				"Colour Development Over Months",
				"Weight and Pressing Methods",
				"Seasonal Temperature Cycling",
				"Batch Records and Tasting Notes",
			],
			"Vinegar Mother Care": [
				"Acetification Rate and Surface Area",
				"Alcohol Content Before Souring",
				"Mother Splitting and Propagation",
				"Vinegar Eel Identification",
				"Sealing Versus Breathable Covers",
				"Acidity Titration Methods",
				"Restarting a Stalled Vinegar",
			],
			"Kimchi Seasonality": [
				"Winter Kimjang Batch Notes",
				"Summer Quick Kimchi Methods",
				"Napa Availability Through the Year",
				"Radish Varieties by Season",
				"Fermentation Speed and Ambient Heat",
				"Seasoning Ratios Across Regions",
				"Storage Depth and Sourness Control",
			],
			"Temperature Control in Fermentation": [
				"Proofing Box Construction Notes",
				"Ambient Swings and Batch Consistency",
				"Cold Retard Effects on Flavour",
				"Thermal Mass in Large Vessels",
				"Heat Mat Placement and Overshoot",
				"Logging Temperature Through a Ferment",
				"Seasonal Adjustment Schedules",
			],
		},
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

// ── phrase-sensitivity pairs ─────────────────────────────────────────────────

/**
 * Phrase pairs: does word *adjacency* carry any ranking weight at all?
 *
 * MiniSearch's inverted index stores term frequencies but no positions, so the
 * lexical leg is bag-of-words by construction — a note containing "deep scattering
 * layer" verbatim and a note containing "deep", "scattering" and "layer" in three
 * unrelated sentences present identical lexical evidence. These pairs exist to turn
 * that structural fact into a measured number *per retrieval leg*, before deciding
 * whether a phrase-aware re-rank is worth building.
 *
 * Each pair is one target and one decoy in the same domain, shaped so the contest
 * is decided by adjacency and nothing else:
 *
 *  - the TARGET contains the query's phrase verbatim; its other query-term
 *    occurrences are kept minimal, so the phrase is its evidence;
 *  - the DECOY uses every word of the phrase at **equal or higher frequency**,
 *    scattered across sentences in honestly different senses, never adjacent —
 *    to a bag-of-words scorer it is at least as good a match;
 *  - **neither title contains any query term**, so `calculateTitleBoost` stays
 *    silent and the contest happens in the content field;
 *  - both bodies are comparable in length, so chunk-count and length
 *    normalization do not decide it (the same reason the Zettel layer asserts
 *    pair balance).
 *
 * Bodies are verbatim rather than generated: exact term frequencies are the whole
 * point, and hand-written prose keeps them reviewable. Verbatim bodies also consume
 * no draws from the shared `rng`, so adding a pair is genuinely additive — the rest
 * of the corpus stays byte-identical (see `fillerSentenceFrom` for why that
 * matters).
 *
 * Like the decoys in the Zettel layer — and unlike `DISTRACTORS` — no decoy here
 * declares its own irrelevance. Each is honestly about its own subject (winter
 * logistics, editorial process, sediment cores); it merely owns the phrase's words
 * in other senses, which is what real vaults do.
 *
 * Graded in `PHRASE_JUDGMENTS` (held out of the ratcheted tiers) and scored per
 * leg by the benchmark's phrase block. The shape is asserted at generation time —
 * see the guard in `main()`.
 */
interface PhrasePairNote {
	slug: string;
	title: string;
	/** Verbatim body — hand-written so term frequencies are exact and reviewable. */
	body: string;
}

interface PhrasePair {
	/**
	 * The multi-word phrase under test. Must appear verbatim in `target.body`,
	 * never in `decoy.body` (nor any adjacent two-word fragment of it).
	 */
	phrase: string;
	domain: string;
	/** Every significant term of the benchmark query, for the title-cleanliness guard. */
	queryTerms: readonly string[];
	target: PhrasePairNote;
	decoy: PhrasePairNote;
}

const PHRASE_PAIRS: readonly PhrasePair[] = [
	{
		phrase: "cold chain",
		domain: "Fermentation",
		// Query: "where does the cold chain usually break"
		queryTerms: ["cold", "chain", "usually", "break"],
		target: {
			slug: "phrase-target-cold-chain",
			title: "Courier Logistics for Live Cultures",
			body: `Shipping a live culture is mostly a question of keeping the cold chain intact from the packing bench to the recipient's fridge. The last courier leg is where the cold chain usually breaks: parcels ride unrefrigerated for the final stretch, and a summer afternoon is enough to push a kefir culture past recovery.

## Packing

Gel packs hold an insulated box below eight degrees for about thirty hours. That covers a next-day service with margin and a two-day service with none, so the day of dispatch matters more than the courier brand — a Friday parcel spends the weekend in a depot, and no packing survives that.

## Handovers

Depot transfers are the weak link. Every handover adds twenty to forty minutes at ambient temperature, and three in a row defeat the gel packs even in January. A shipment that arrives warm smells sharp rather than lactic; the balance has tipped toward the acetic side, and a week of refreshes is needed before the culture behaves again.

## Receiving

Ask the recipient to refrigerate immediately and feed within twelve hours. A cold chain that held all the way to the doorstep still ends there — an afternoon on a porch undoes everything upstream of it.`,
		},
		decoy: {
			slug: "phrase-decoy-cold-chain",
			title: "Basement Temperatures in January",
			body: `The basement runs four degrees colder than the kitchen from November through March, and every ferment down there moves to a different clock. Cold slows the yeast well before it slows the bacteria, so flavour drifts sour long before the rise finishes; a batch that usually takes two days can sit for five.

## Supply

Deliveries are the other winter problem. The mill consolidated its distribution chain in the autumn, and the flour now passes through one more warehouse than before. Nothing in that chain is refrigerated, nor needs to be, but the extra day in transit means the rye arrives noticeably older.

## Managing the room

A cold room does not stop a culture, it stretches it. The practical answer is a chain of small adjustments rather than one big one: warmer water at each refresh, a smaller inoculation, jars moved to the top shelf where the air is least cold. When the weather finally breaks in March, everything speeds up at once and the schedule has to be rebuilt in the opposite direction.`,
		},
	},
	{
		phrase: "forward guidance",
		domain: "Monetary Policy",
		// Query: "does forward guidance actually move expectations"
		queryTerms: ["forward", "guidance", "actually", "move", "expectations"],
		target: {
			slug: "phrase-target-forward-guidance",
			title: "Promises About the Future Stance",
			body: `When the instrument itself has no room left, the announcement becomes the instrument. Forward guidance works — when it works — by moving expectations of where the stance will sit two years out, which is the horizon most long contracts actually price against.

## Evidence

Event studies around guidance announcements show medium-term yields moving within minutes, well before any balance-sheet action follows. The effect is largest when the commitment is stated in calendar terms and smallest when it is hedged with outcome clauses that markets read as escape hatches.

## Limits

Forward guidance borrows credibility rather than creating it. A committee that has revised its stated path twice in a year finds that expectations stop moving on the third announcement; the statement is heard, parsed, and discounted. At that point the promise adds volatility instead of removing it, because every release is read as a test of whether the commitment still holds.

## Working note

The practical question for the next cycle is not whether forward guidance moves markets on the day — it demonstrably does — but whether the shift in expectations survives the first surprise that argues against the promised path.`,
		},
		decoy: {
			slug: "phrase-decoy-forward-guidance",
			title: "Preparing the Quarterly Bulletin",
			body: `The bulletin goes to layout six weeks before publication, which means the editorial calendar runs permanently ahead of the material it describes. Sections that miss the cut are carried forward to the next issue, and about a third of what is carried forward gets cut again.

## House style

Authors get two pages of style guidance and ignore most of it. The guidance that actually sticks is structural: state the finding in the first sentence, keep charts to one message each, and never move a caveat into a footnote. Everything else — hyphenation, capitalisation, the ban on the word "significant" — has to be enforced in the edit.

## Review

Drafts move through three reviewers in sequence, and the schedule assumes each pass takes a week. Reviewer expectations differ enough that authors have learned to read the roster before writing: one wants the method up front, another sends anything back that leads with equations. The editor's guidance on this is to write for the slowest reader and let the fast ones skim.

## Production

Going forward, the print run drops again this year and the tables move to an online annex. Reader expectations have shifted with the format: the emails now ask for the underlying series, not the pdf. The style guidance for the annex is still a draft, and usually one section of it changes per issue.`,
		},
	},
	{
		phrase: "deep scattering layer",
		domain: "Marine Biology",
		// Query: "why does the deep scattering layer rise at night"
		queryTerms: ["deep", "scattering", "layer", "rise", "night"],
		target: {
			slug: "phrase-target-deep-scattering-layer",
			title: "Sonar Echoes That Migrate Daily",
			body: `Early echo sounders reported a second seafloor at three to four hundred metres — one that moved. The false bottom is the deep scattering layer: lanternfish, siphonophores and krill packed densely enough to reflect sound, spread across whole ocean basins.

## Why it moves

The deep scattering layer rises toward the surface at night and sinks again before dawn, tracking its food while staying out of sight. Daylight makes shallow water lethal for a small silvery fish — visual predators hunt by silhouette — so the layer feeds in darkness and spends the day where the light cannot follow. The swim bladders that make lanternfish so acoustically loud are the same organs that let them make the trip twice a day.

## Measuring it

Ship transducers see the layer compress and thin as it ascends; the echo weakens near the surface because the fish spread out to feed. Moonlight matters — on bright nights the ascent stops metres short of the surface, and during a full lunar eclipse the layer has been recorded climbing in the middle of the night as if a switch had flipped.

## Note

The daily vertical commute of the deep scattering layer is plausibly the largest synchronized movement of animals on the planet, and it happens twice every day, unseen.`,
		},
		decoy: {
			slug: "phrase-decoy-deep-scattering-layer",
			title: "Shelf Sediment Core Notes",
			body: `Cores from the shelf transect came up in good condition, and the lab work is mostly about reading the layer sequence in order. Each layer records a season of deposition, and the boundaries between one layer and the next are sharper in the deep basin cores than on the slope, where burrowing animals blur them.

## Optics

Turbidity profiles from the same stations show strong light scattering in the upper water column after storms, and the scattering falls off quickly with depth. We log the scattering coefficient alongside each cast so the optics can be matched to the surface sediment later.

## Deep stations

The deep cores took three times as long to recover, and two came up short. In the deepest one the bottom layer is laminated — no burrowers at all — which argues for low oxygen at the time the layer formed. Sea level rise complicates the shallow end of the transect instead: the top layer at the two inshore stations is reworked storm sand rather than quiet deposition.

## Logistics

Night sampling worked better than expected; the winch queue clears after dark and we got four extra casts a night. The remaining deep stations are scheduled for the next cruise, weather permitting, and the lamination question stays open until the geochemistry comes back.`,
		},
	},
];

// ── Zettelkasten layer ───────────────────────────────────────────────────────

/**
 * A flat, single-directory note layer modelling how a real Obsidian user works.
 *
 * Everything above this point is organised the way a *benchmark* is organised: four
 * hermetic topic folders whose vocabularies never collide, so telling them apart is
 * trivial. Real vaults are the opposite — one person's notes, in which `review`,
 * `feedback`, `block` and `pipeline` each carry several unrelated senses, and the
 * only thing separating them is meaning.
 *
 * Three properties make this layer different from `DISTRACTORS`, and each one exists
 * because the existing corpus cannot express the failure it targets:
 *
 *  1. **Flat.** No subfolders. Hierarchy lives in frontmatter and `[[wikilinks]]`,
 *     Zettelkasten-style. Neither is a ranking signal today — nothing in `src/search/`
 *     reads link structure, and `LexicalSearchService` reads only `aliases`/`tags` from
 *     frontmatter — so these notes are ranked on title, tags, body and embedding alone.
 *     That is precisely the condition under which real-vault search fails, and the
 *     folder-shaped corpus above never reproduces it.
 *
 *  2. **No self-declaring decoys.** Every `decoy` in `DISTRACTORS` ends by announcing
 *     its own irrelevance ("not animal behaviour, learning, or any container-opening
 *     problem solving"). An embedder reads that and correctly pushes the note away,
 *     which is why those cases saturate. Nothing here contains such a sentence: the
 *     wrong answer is *honestly, fully about* the query's topic, in a different sense.
 *
 *  3. **Shared vocabulary by construction.** These notes deliberately reuse each
 *     other's words across senses, so the discrimination has to come from the
 *     relational frame rather than from topic separation.
 */
interface ZettelNote {
	/** Filename slug; the layer is flat, so this is the whole path under `Zettel/`. */
	slug: string;
	title: string;
	/** Arbitrary frontmatter fields. Inert for ranking today — realism, plus a before/after if that changes. */
	fields?: Record<string, string>;
	tags?: string[];
	aliases?: string[];
	/**
	 * The note body, written verbatim rather than generated.
	 *
	 * Generated filler would defeat the point: the whole difficulty of this layer is
	 * that the prose reads like something a person actually wrote, with the query's
	 * sense carried implicitly. That cannot be produced from a vocabulary list.
	 */
	body: string;
	/** Wikilinks appended as a "Links" section, mirroring how a Zettelkasten note connects. */
	links?: string[];
}

/**
 * Notes chosen so that each query has two *plausible* answers, separated only by sense
 * or relational frame.
 *
 * The `feedback` pair is the reported real-vault failure, reproduced: `1-1-priya-2026-03`
 * records feedback a person was given, `feedback-scoring-service` documents an LLM
 * feedback component in an automation pipeline. Both are genuinely about feedback. The
 * 1:1 note deliberately does **not** use the word "received" — a real 1:1 note says
 * "Priya said", not "feedback I received" — so there is no lexical bridge from the query
 * and the entire burden falls on the semantic half.
 */
const ZETTEL_NOTES: readonly ZettelNote[] = [
	// ── polysemy + intent-frame: "feedback" ─────────────────────────────────
	{
		slug: "1-1-priya-2026-03",
		title: "1:1 with Priya — March",
		fields: { type: "meeting", people: "Priya Raman", date: "2026-03-11" },
		tags: ["1-1"],
		body: `Priya said my scoping is still too broad — I take on the whole problem when the team only needed the first slice. She wants me to cut work into pieces someone else could pick up halfway through.

She was direct about the design review two weeks ago: I presented three options without a recommendation, and the room stalled for forty minutes. Her words were "you did the analysis, now do the judgement".

The part that stung, fairly: I have been treating written updates as overhead. Two people told her they did not know what my team shipped last quarter. That is on me.

Good news as well — she thinks the migration went better than anyone expected and said so to her skip. She wants me to write it up before the detail fades.

Next time: bring the scoping doc, and one recommendation rather than three options.`,
		links: ["Weekly Review 2026-03-14", "Migration Retro"],
	},
	{
		slug: "feedback-scoring-service",
		title: "Feedback Scoring Service",
		fields: { type: "project", status: "active" },
		tags: ["platform"],
		body: `The feedback scoring service grades model outputs against a rubric and returns a score with a short justification. It runs as the third stage of the evaluation pipeline, after generation and deduplication.

Each request carries the candidate output, the rubric version, and an optional reference answer. The scorer receives feedback from two judges and reconciles disagreement by taking the lower score, which we found reduces false positives on the safety rubric.

Latency is dominated by the judge call. We batch twenty items per request and cache on a hash of the rubric plus the candidate. Cache hit rate sits around sixty percent in steady state.

Open problem: the judges drift when the rubric is revised, and we have no automated way to detect it. Right now someone re-scores a fixed sample by hand each month and compares.

The service also emits per-criterion feedback that the training pipeline consumes directly.`,
		links: ["Evaluation Pipeline", "Rubric Versioning"],
	},
	{
		slug: "feedback-i-gave-2026-q1",
		title: "Notes Before Review Season",
		fields: { type: "note", date: "2026-03-20" },
		tags: ["management"],
		body: `Writing these down before I forget the specifics, since vague praise helps nobody.

For Tomas: he unblocked the ingest work by rewriting the retry logic nobody wanted to touch. I told him it was the single highest-leverage thing anyone did that month. The thing he needs to hear, and I said it: he ships without telling anyone, so the work is invisible until it lands.

For Wen: excellent instincts on the schema, and she pushed back on my proposal in a way that turned out to be right. I said that plainly in front of the team, which I think mattered more than saying it privately.

For Danilo: I have been putting this off. He is doing fine work on a project that is going to be cancelled, and pretending otherwise would be unkind. I told him this week and offered to help him move onto the platform team.

I am consistently better at the encouraging half of this than the corrective half.`,
		links: ["1:1 with Priya — March"],
	},

	// ── polysemy: "review" ──────────────────────────────────────────────────
	{
		slug: "pr-review-backlog",
		title: "PR Review Backlog",
		fields: { type: "note", date: "2026-03-09" },
		tags: ["platform"],
		body: `Four changes have been sitting in review for more than a week, and two of them block the release branch.

The retry-logic change is the one holding everything up. It touches the shared client, so it needs a second reviewer, and the only two people who know that code are both on the migration.

I have started reviewing in the morning before anything else. The queue is shorter but I am slower on the ones that need real thought, which is the wrong trade.

Proposal for the team: anything under fifty lines gets a single reviewer and a four-hour target. Anything touching the shared client keeps two.`,
		links: ["Migration Retro"],
	},
	{
		slug: "lit-noise-kahneman",
		title: "Noise — Kahneman, Sibony, Sunstein",
		fields: { type: "literature", source: "book", author: "Kahneman et al." },
		tags: ["reading"],
		body: `Central claim: organisations obsess over bias and ignore noise, which is the unwanted variability between judgements that should agree. Two underwriters given the same file quote premiums differing by more than half.

The review of the forecasting literature in the middle third is the most useful part — a survey of where structured judgement beats expert intuition, and the narrow conditions under which it does not.

Their proposed fix is the decision hygiene checklist: break a judgement into independent components, score each separately, and only then form a holistic view. Aggregating independent estimates cancels noise in a way that arguing to consensus does not.

The chapter on performance evaluation is uncomfortable reading for anyone who runs a review cycle. Rating scales without behavioural anchors mostly measure the rater.`,
		links: ["Notes Before Review Season"],
	},

	// ── polysemy: "pipeline" ────────────────────────────────────────────────
	{
		slug: "evaluation-pipeline",
		title: "Evaluation Pipeline",
		fields: { type: "project", status: "active" },
		tags: ["platform"],
		body: `The pipeline runs nightly over the held-out set: generation, deduplication, scoring, then aggregation into the dashboard.

Stage boundaries are queues, so a slow stage backs up rather than dropping work. The scoring stage is the bottleneck and the only one that scales horizontally.

Failure handling is per-item rather than per-batch. An item that fails three times lands in a dead-letter queue that someone reviews weekly, though in practice that has slipped to monthly.

What is genuinely in flight right now: rubric versioning, a faster deduplication pass, and moving aggregation off the box it shares with the dashboard.`,
		links: ["Feedback Scoring Service"],
	},
	{
		slug: "hiring-pipeline-platform-2026",
		title: "Platform Hiring — Spring",
		fields: { type: "note", date: "2026-03-02" },
		tags: ["management", "hiring"],
		body: `Two open roles, both senior. The pipeline is thinner than it looks: nine candidates in play, but four are early-stage and one is almost certainly going elsewhere.

Stage conversion is worst between phone screen and onsite. We are losing people at the take-home, which takes four hours and asks them to build something we would never build that way.

In flight: two onsites next week, one offer out with a deadline of Friday, and a referral I have not chased.

The thing I keep not doing is closing the loop with candidates we rejected. It costs twenty minutes and it is the difference between someone reapplying and not.`,
		links: ["Weekly Review 2026-03-14"],
	},

	// ── provenance / supporting notes ───────────────────────────────────────
	{
		slug: "weekly-review-2026-03-14",
		title: "Weekly Review 2026-03-14",
		fields: { type: "daily", date: "2026-03-14" },
		tags: ["review"],
		body: `Shipped: the retry-logic change finally landed, and the ingest backlog drained overnight.

Did not ship: the write-up Priya asked for, the dead-letter queue cleanup, and closing the loop with the two candidates we passed on.

The week was mostly reactive. Three days had no block longer than forty minutes, which is why nothing that needed real thought moved.

Next week: protect two mornings, write the migration piece, and clear the review queue before it becomes someone else's problem.`,
		links: ["1:1 with Priya — March", "PR Review Backlog", "Platform Hiring — Spring"],
	},
	{
		slug: "migration-retro",
		title: "Migration Retro",
		fields: { type: "meeting", date: "2026-02-27" },
		tags: ["platform", "retro"],
		body: `What went well: the cutover took eleven minutes against a ninety-minute budget, and the rollback path was exercised in staging the week before rather than being theoretical.

What did not: we discovered the shared client had three callers nobody had inventoried, two days before cutover. That was luck, not process.

The dry run was the whole reason this worked. It cost a week and everyone resented it at the time.

Action items: inventory callers of anything shared before planning a change, and keep the dry-run step in the template even when the change looks small.`,
		links: ["PR Review Backlog"],
	},
	{
		slug: "vendor-call-observability",
		title: "Vendor Call — Observability Tooling",
		fields: { type: "meeting", source: "vendor call", date: "2026-03-05" },
		tags: ["vendor"],
		body: `They walked through tracing, log aggregation, and the alerting layer. Pricing is per-host with a separate ingest charge, which is the part that will bite us given how chatty the scoring stage is.

Their retention default is thirty days and going longer roughly doubles the line item.

The integration story for our stack is better than I expected — the collector is standard and we would not need to rewrite instrumentation.

Open questions I did not get answered: what happens to data on contract termination, and whether the ingest charge applies to dropped spans.`,
		links: ["Evaluation Pipeline"],
	},

	// ════════════════════════════════════════════════════════════════════════
	// COLLISION CLUSTERS
	//
	// The ten notes above proved the layer works: at 2.9% of the vault they took
	// ~11% of every lexical top-25 (16% on one query), because their vocabulary
	// cuts across the topic corpus instead of sitting inside one silo.
	//
	// What they could not do is provide *coverage*. The reported failure needed a
	// colliding pair to exist before the benchmark could see it, so a ten-note layer
	// only catches collisions someone thought to write down. These clusters widen
	// that: each group seeds a word used in two or more legitimate senses across
	// contexts a single person genuinely has.
	//
	// Organising principle is the collision, not the topic. `block`, `context`,
	// `run`, `sync`, `draft`, `ship`, `scale`, `charge`, `bank`, `pitch` and
	// `capacity` each appear below in at least two unrelated senses, none of them
	// signposted. As everywhere in this layer: no note declares its own
	// irrelevance, and no target repeats its query's phrasing.
	// ════════════════════════════════════════════════════════════════════════

	// ── "block" — calendar / building / obstruction ─────────────────────────
	{
		slug: "focus-blocks-experiment",
		title: "Protecting Focus Blocks",
		fields: { type: "note", date: "2026-03-16" },
		tags: ["habits"],
		body: `Third attempt at this. Two ninety-minute blocks a day, morning only, calendar marked busy so nobody can book over them.

What killed the previous two attempts was treating the block as optional the moment something urgent appeared. Everything looks urgent at eleven in the morning.

The rule this time: if something displaces a block it gets rescheduled the same day, not dropped. Writing it down because I know I will argue with myself about it.

One week in and it is holding, though the week had no incidents, so this proves nothing yet.`,
		links: ["Weekly Review 2026-03-14"],
	},
	{
		slug: "storage-block-layout",
		title: "Block Layout in the Storage Engine",
		fields: { type: "note" },
		tags: ["platform"],
		body: `Pages are fixed at eight kilobytes and a block is sixteen pages, which is the unit the allocator hands out and the unit we checksum.

Splitting a block on overflow is the expensive path — it rewrites the parent index entry and invalidates any cached pointer into the old extent.

The free list tracks blocks, not pages, so a workload that frees a single page inside a block reclaims nothing until the whole block empties. That is the fragmentation everyone complains about.

Considering a smaller block for the write-heavy tables, though it costs index depth.`,
	},
	{
		slug: "blocked-on-legal",
		title: "Blocked on Legal Review",
		fields: { type: "note", date: "2026-03-18" },
		tags: ["platform"],
		body: `The vendor contract has been with legal for eleven days. Nothing moves until it clears, and I have stopped asking daily because it was not helping.

What is actually blocked: the observability migration, the on-call rotation change that depends on it, and one hire who wants to know what tooling they will be using.

I could unblock two of the three by decoupling them, which I should have done a week ago rather than treating the dependency as real.`,
		links: ["Vendor Call — Observability Tooling"],
	},

	// ── "context" — LLM window / social situation / switching cost ──────────
	{
		slug: "context-window-budget",
		title: "Context Window Budget",
		fields: { type: "note" },
		tags: ["platform"],
		body: `We are spending most of the window on retrieved passages and almost none on instructions, which is backwards for the scoring task.

Measured on a sample of two hundred requests: system prompt eight percent, retrieved context seventy-one percent, candidate output nine percent, everything else overhead.

Trimming retrieval to the top four passages instead of ten cost almost nothing on accuracy and freed enough room to include the full rubric rather than a summary of it.

The remaining waste is duplicated boilerplate across passages from the same source document.`,
		links: ["Evaluation Pipeline"],
	},
	{
		slug: "context-switching-cost",
		title: "The Cost of Switching",
		fields: { type: "note", date: "2026-03-10" },
		tags: ["habits"],
		body: `Counted interruptions for a week: nineteen, of which four genuinely needed me that hour.

The expensive part is not the interruption itself, it is the twenty minutes afterwards spent rebuilding the context I had loaded before it. Four real interruptions cost most of a day once you count the reload.

Batching is the obvious answer and I keep not doing it, because answering immediately feels helpful and deferring feels rude.

Trying: one pass at eleven, one at four, nothing in between unless someone is actually stuck.`,
		links: ["Protecting Focus Blocks", "Weekly Review 2026-03-14"],
	},

	// ── "run" / "running" — execution / management / exercise ───────────────
	{
		slug: "nightly-run-failures",
		title: "Nightly Run Failures",
		fields: { type: "note", date: "2026-03-13" },
		tags: ["platform"],
		body: `Three failures this week, all in the same stage, all at roughly the same wall-clock time.

The pattern points at the shared box: aggregation runs while the dashboard is rebuilding its materialised views, and the box runs out of memory rather than either process being wrong.

Short-term fix is staggering the schedule by twenty minutes. Real fix is moving aggregation off that host, which is already on the list and keeps losing to whatever is on fire.

Worth noting the run itself is not slow — it is contended.`,
		links: ["Evaluation Pipeline"],
	},
	{
		slug: "running-a-team-notes",
		title: "What Running a Team Actually Involves",
		fields: { type: "note", date: "2026-02-20" },
		tags: ["management"],
		body: `Nobody told me the job would be mostly writing. Not code — documents, updates, summaries, and the same explanation four times to four audiences.

The technical part shrank faster than I expected. I am now the person who knows least about the codebase in every meeting, which took some getting used to and is probably correct.

The part I underestimated: pace. Deciding how hard the team should push, and noticing when the answer has quietly become "harder than is sustainable".

The part I overestimated: hiring. It matters enormously but occupies far less time than the calendar suggests.`,
		links: ["Notes Before Review Season", "Platform Hiring — Spring"],
	},

	// ── "sync" — meeting / data replication ─────────────────────────────────
	{
		slug: "weekly-sync-is-too-long",
		title: "The Weekly Sync Is Too Long",
		fields: { type: "note", date: "2026-03-06" },
		tags: ["management"],
		body: `An hour with nine people is nine hours of attention for maybe fifteen minutes of content that needed everyone.

Most of it is status that could be written. The genuinely useful part is the five minutes where someone says a thing that surprises someone else, and that part is unpredictable, which is the argument for keeping the meeting at all.

Trying thirty minutes with a written update posted beforehand. If the surprising part still happens we lost nothing.`,
		links: ["Weekly Review 2026-03-14"],
	},
	{
		slug: "replica-sync-lag",
		title: "Replica Sync Lag",
		fields: { type: "note" },
		tags: ["platform"],
		body: `Read replicas trail the primary by two to four seconds under normal load and by well over a minute during the nightly aggregation.

Anything reading its own write has to be pinned to the primary, and we have at least three places doing that implicitly without saying so.

The lag itself is not the problem — the problem is that nothing surfaces it, so a stale read looks like a bug in whatever code happened to observe it.

Adding lag to the health endpoint and to the dashboard, which is ten minutes of work we should have done a year ago.`,
		links: ["Nightly Run Failures"],
	},

	// ── "draft" / "ship" — writing / releasing ──────────────────────────────
	{
		slug: "migration-writeup-draft",
		title: "Migration Write-up — Draft",
		fields: { type: "note", status: "draft", date: "2026-03-17" },
		tags: ["writing"],
		body: `Priya asked for this and I have been avoiding it for a week, which is its own kind of signal.

The shape I want: what we were afraid of, what actually went wrong, and the one practice that made the difference. Not a timeline — nobody reads timelines.

The honest version includes that we found three uninventoried callers two days out, and that catching them was luck. Leaving that out would make the piece useless to anyone planning their own.

Still missing: the numbers. Eleven minutes against ninety budgeted, and I want the staging dry-run cost alongside it so the tradeoff is visible.`,
		links: ["Migration Retro", "1:1 with Priya — March"],
	},
	{
		slug: "ship-it-culture",
		title: "On Shipping Before It's Ready",
		fields: { type: "note", date: "2026-01-30" },
		tags: ["writing"],
		body: `The advice to ship early is right and is routinely misapplied. It means put it in front of someone, not skip the parts that make it work.

Where I have seen it go wrong: shipping something whose failure mode is silent. A visibly rough thing gets feedback; a quietly wrong thing gets trusted and then discovered months later.

My rule now is that a rough edge is fine if it is loud. Missing feature, ugly interface, obvious gap — all fine. Wrong answer returned confidently is not.

The same applies to a design draft: circulating a rough one invites correction, while circulating a polished one invites approval, and those are different things.

The retry logic sat unreviewed for a week because nobody wanted to touch it, which is the same failure wearing different clothes.`,
		links: ["PR Review Backlog"],
	},

	// ── "scale" / "capacity" — systems / people ─────────────────────────────
	{
		slug: "scaling-the-scoring-stage",
		title: "Scaling the Scoring Stage",
		fields: { type: "note" },
		tags: ["platform"],
		body: `It is the only stage that scales horizontally and the only one that needs to, so the shape of the fix is not in question.

Throughput is roughly linear to about twelve workers and then flattens, which is where the judge provider starts rate-limiting us rather than anything on our side.

Options: negotiate a higher limit, batch harder, or cache more aggressively. Batching is free and we are already at twenty per request; going higher hurts latency on the interactive path.

The cache is the underused lever — sixty percent hit rate should be higher given how much of the corpus is unchanged between runs.`,
		links: ["Feedback Scoring Service", "Evaluation Pipeline"],
	},
	{
		slug: "team-capacity-reality",
		title: "Team Capacity, Honestly",
		fields: { type: "note", date: "2026-03-19" },
		tags: ["management"],
		body: `Six people, and I have been planning as though that means six people of capacity, which it has never once meant.

One is onboarding and will be net negative for another month. One is half-allocated to the migration. One is on call this rotation, which in practice is sixty percent of a person.

Real capacity is closer to three and a half, and every plan I have written this quarter assumed five.

This is not a morale problem or an effort problem. It is an arithmetic problem I keep declining to do.`,
		links: ["Platform Hiring — Spring", "What Running a Team Actually Involves"],
	},

	// ── "charge" / "bank" — money / energy / institutions ───────────────────
	{
		slug: "ingest-charges-surprise",
		title: "The Ingest Charge Nobody Modelled",
		fields: { type: "note", date: "2026-03-12" },
		tags: ["vendor"],
		body: `Per-host pricing was the number everyone looked at. The ingest charge is the one that will actually decide whether this is affordable.

Our scoring stage emits far more than a typical service because every judge call is traced end to end. At current volume the ingest line is roughly double the host line.

Sampling would fix it and would also remove the traces we most want when something goes wrong, which is the whole tension.

Asked whether dropped spans are charged. No answer yet.`,
		links: ["Vendor Call — Observability Tooling"],
	},

	// ── "pitch" / "deck" — sales / sound / slope ────────────────────────────
	{
		slug: "platform-pitch-internal",
		title: "Internal Pitch for the Platform Work",
		fields: { type: "note", date: "2026-02-14" },
		tags: ["writing"],
		body: `Fifteen minutes to argue that the platform work deserves headcount, to an audience that has heard four of these this quarter.

What works with this group: a number they did not know, then the consequence, then the ask. What does not work: architecture diagrams.

The number is that three engineers spend a combined day a week on toil the platform work removes. Annualised that is most of a person.

The ask is two engineers, not four. Asking for four reads as unserious and invites a negotiation I would rather not have.`,
		links: ["Team Capacity, Honestly"],
	},

	{
		slug: "vendor-pitch-notes",
		title: "How the Vendor Pitched It",
		fields: { type: "meeting", source: "vendor call", date: "2026-03-05" },
		tags: ["vendor"],
		body: `Worth separating what they demonstrated from how they pitched it, because the two did not entirely agree.

The pitch was about unified visibility — one pane, every signal, no correlation work. The demo showed three consoles and a fair amount of correlation work.

That is not dishonesty so much as the usual gap between the deck and the product, and the product was still better than what we run now.

The part of the pitch I did believe: the collector really is standard, and the migration really would not require reinstrumenting anything.`,
		links: ["Vendor Call — Observability Tooling", "The Ingest Charge Nobody Modelled"],
	},

	// ── literature notes — the other big real-vault category ────────────────
	{
		slug: "lit-thinking-in-systems",
		title: "Thinking in Systems — Meadows",
		fields: { type: "literature", source: "book", author: "Donella Meadows" },
		tags: ["reading"],
		body: `The idea that stuck: a system's behaviour comes from its structure, so blaming the people inside it is usually a category error.

Stocks and flows as the basic vocabulary. A stock changes slowly even when flows change fast, which is why fixes appear not to work long after they have started working.

Leverage points ranked from weak to strong — parameters near the bottom, goals and paradigms near the top. Most of what organisations argue about sits in the weakest third.

Her warning about delays is the practical part: a delayed feedback signal produces oscillation, and adding more control makes it worse rather than better.`,
		links: ["Noise — Kahneman, Sibony, Sunstein"],
	},
	{
		slug: "lit-shape-of-design",
		title: "The Shape of Design — Chimero",
		fields: { type: "literature", source: "book", author: "Frank Chimero" },
		tags: ["reading"],
		body: `Short, and more useful than its length suggests.

The argument I keep returning to: the gap between craft and intent. Skill lets you make the thing; taste tells you whether it was worth making, and the two arrive years apart.

On improvisation — that a form has to be learned well enough to be abandoned deliberately rather than by accident.

The chapter on audience is the one I disagreed with most and thought about longest.`,
	},

	// ── daily notes — bulk, and the source of most incidental collisions ────
	{
		slug: "daily-2026-03-16",
		title: "2026-03-16",
		fields: { type: "daily", date: "2026-03-16" },
		tags: ["daily"],
		body: `Blocked out the morning and actually kept it, first time in three weeks.

Reviewed two changes, one of which I approved without really reading, which I should go back to.

Started the migration write-up. Got as far as the outline before the sync, then lost the thread.

Danilo asked about the platform team move. Said I would find out this week, so I need to actually ask.`,
		links: ["Protecting Focus Blocks", "Migration Write-up — Draft"],
	},
	{
		slug: "daily-2026-03-17",
		title: "2026-03-17",
		fields: { type: "daily", date: "2026-03-17" },
		tags: ["daily"],
		body: `Nightly run failed again. Same stage, same time, so it is the contention theory rather than anything new.

Staggered the schedule as a stopgap. It will hold until aggregation moves.

Wrote most of the migration piece. The numbers section is still empty because I need the staging costs and never wrote them down.

Legal still has the contract. Eleven days.`,
		links: ["Nightly Run Failures", "Blocked on Legal Review"],
	},
	{
		slug: "daily-2026-03-18",
		title: "2026-03-18",
		fields: { type: "daily", date: "2026-03-18" },
		tags: ["daily"],
		body: `Decoupled the on-call rotation change from the vendor contract, which unblocks it immediately and should have happened last week.

Long conversation with Wen about the schema. She is right and I said so.

Capacity arithmetic finally done properly. Three and a half, not five. Need to redo the quarter plan on that basis and tell Priya before she hears it from the plan slipping.`,
		links: ["Blocked on Legal Review", "Team Capacity, Honestly"],
	},
];

/**
 * Turn a note title into its filename. Used by every region of the corpus.
 *
 * In Obsidian the filename *is* the title, and that is not cosmetic here —
 * `file.basename` is indexed as MiniSearch's title field, and
 * `SEARCH_TERM_SPLIT_REGEX` (`searchTermUtils.ts`) treats `-` as a word character.
 * So `context-switching-cost` is ONE token while `Context Switching Cost` is three,
 * and only the latter can partially match a query through `calculateTitleBoost`.
 *
 * That asymmetry cuts both ways, which is why every region uses this now. A
 * slugified *distractor* loses the title signal that makes it a competitor, so the
 * benchmark gets quietly easier; a slugified *target* loses the signal that would
 * surface it, so the benchmark gets harder for the wrong reason. Neither is a
 * property anyone chose — both were artifacts of the filename convention.
 *
 * Dashes that belong to the title are kept — dates (`2026-03-16`, `Weekly Review
 * 2026-03-14`) and `1-1` read correctly with them. Only characters that are illegal
 * or awkward in a filename are replaced.
 *
 * `slug` is retained on the note types as the stable identifier for the generator's
 * own guards (pair balance, size-bias shape checks, `--clean`), which must not depend
 * on display text.
 */
function titleToFilename(title: string): string {
	return (
		title
			.replace(/\s*—\s*/g, " - ")
			// A colon between digits is a separator, not punctuation to delete: naively
			// stripping it turned "1:1 with Priya" into "11 with Priya", which reads as
			// eleven. Obsidian users write this as "1-1" in filenames for the same reason.
			.replace(/(\d):(\d)/g, "$1-$2")
			.replace(/[:/\\?*"<>|]/g, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}

/** Convenience wrapper for the Zettel layer, which passes whole notes around. */
function zettelFilename(note: ZettelNote): string {
	return titleToFilename(note.title);
}

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
		// `Corpus/` is entirely generated, so wiping it is safe and is how stale notes
		// from a renamed subject get removed.
		rmSync(corpusRoot, { recursive: true, force: true });

		// `Zettel/` is NOT safe to wipe. It is *mixed*: this script writes the 31 notes
		// in `ZETTEL_NOTES`, but the other 28 are hand-written files that were
		// consolidated in from the old `Topics/`, `Large Notes/` and vault root, and
		// nothing here can regenerate them. An earlier version of this block deleted the
		// whole directory and took all 28 with it — recovered from git, but only because
		// they happened to be committed.
		//
		// So remove exactly the generated set, by name, and leave everything else alone.
		for (const note of ZETTEL_NOTES) {
			rmSync(join(vaultPath, ZETTEL_DIR, `${zettelFilename(note)}.md`), { force: true });
			// Also clear the pre-rename kebab filename, so a vault generated by an older
			// revision does not keep a stale duplicate of every persona note.
			rmSync(join(vaultPath, ZETTEL_DIR, `${note.slug}.md`), { force: true });
		}
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
		write(domain, titleToFilename(probe.title), content);
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
		write(domain, titleToFilename(probe.title), content);
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
		write(domain, titleToFilename(distractor.title), content);
	}

	// 3b. Phrase pairs — verbatim bodies, so this step consumes NO draws from the
	//     shared `rng`; everything generated after it stays byte-identical.
	for (const pair of PHRASE_PAIRS) {
		const domain = domainByName(pair.domain);
		const targetContent = `${frontmatter([domain.tag, "hard", "phrase"])}# ${pair.target.title}\n\n${pair.target.body}\n`;
		write(domain, titleToFilename(pair.target.title), targetContent);
		const decoyContent = `${frontmatter([domain.tag, "hard", "phrase", "distractor"])}# ${pair.decoy.title}\n\n${pair.decoy.body}\n`;
		write(domain, titleToFilename(pair.decoy.title), decoyContent);
	}

	// Guard: a phrase pair only measures adjacency if its shape holds. Four things
	// can silently rot under ordinary prose edits, and each one converts the case
	// into a different (wrong) measurement:
	//  - the target losing the verbatim phrase (nothing left to reward);
	//  - the decoy acquiring an adjacent fragment of it (partial credit leaks in);
	//  - the decoy's term frequency dropping below the target's (the case becomes
	//    an ordinary TF contest that bag-of-words already wins correctly);
	//  - a query term drifting into either title (calculateTitleBoost starts
	//    deciding a contest that must happen in the content field).
	const countWord = (text: string, word: string): number =>
		(text.toLowerCase().match(new RegExp(`\\b${word}\\b`, "gu")) ?? []).length;
	for (const pair of PHRASE_PAIRS) {
		const tokens = pair.phrase.toLowerCase().split(/\s+/);
		const targetBody = pair.target.body.toLowerCase();
		const decoyBody = pair.decoy.body.toLowerCase();

		if (!new RegExp(`\\b${tokens.join("\\s+")}\\b`, "u").test(targetBody)) {
			throw new Error(`Phrase pair "${pair.phrase}": target body no longer contains the phrase verbatim.`);
		}
		for (let i = 0; i < tokens.length - 1; i++) {
			const bigram = new RegExp(`\\b${tokens[i]}\\s+${tokens[i + 1]}\\b`, "u");
			if (bigram.test(decoyBody)) {
				throw new Error(
					`Phrase pair "${pair.phrase}": decoy body contains the adjacent fragment "${tokens[i]} ${tokens[i + 1]}".\nThe decoy must hold the phrase's words scattered, never adjacent — that is the whole contest.`,
				);
			}
		}
		for (const token of tokens) {
			const inTarget = countWord(targetBody, token);
			const inDecoy = countWord(decoyBody, token);
			if (inTarget < 1) {
				throw new Error(`Phrase pair "${pair.phrase}": target body never uses "${token}".`);
			}
			if (inDecoy < inTarget) {
				throw new Error(
					`Phrase pair "${pair.phrase}": decoy uses "${token}" ${inDecoy}x vs the target's ${inTarget}x.\nThe decoy must match every phrase word at equal or higher frequency, so a bag-of-words scorer sees it as at least as good — otherwise the case is a TF contest, not an adjacency one.`,
				);
			}
		}
		for (const term of pair.queryTerms) {
			for (const [role, title] of [
				["target", pair.target.title],
				["decoy", pair.decoy.title],
			] as const) {
				if (countWord(title.toLowerCase(), term) > 0) {
					throw new Error(
						`Phrase pair "${pair.phrase}": ${role} title "${title}" contains the query term "${term}".\nTitles must stay clean of query terms so the contest is decided in the content field, not by calculateTitleBoost.`,
					);
				}
			}
		}
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
		// Variant 1 keeps the plain subject name — four judgment cases grade a base
		// note at 1 as a genuinely-related result, and a real vault does have one
		// canonical note per topic. Later variants get distinct hand-written titles
		// rather than `Subject 2`, `Subject 3` (see `variantTitles`).
		const alternates = domain.variantTitles[subject];
		if (!alternates) {
			throw new Error(
				`No variantTitles entry for subject "${subject}" in domain "${domain.name}".\nEvery subject needs one, or its repeat notes fall back to numbered titles — the shape this field exists to remove.`,
			);
		}
		if (variant > 1 && alternates.length < variant - 1) {
			throw new Error(
				`Subject "${subject}" (${domain.name}) needs ${variant - 1} alternate titles but has ${alternates.length}.\nBULK_TARGET (${BULK_TARGET}) drives how many variants each subject gets; raise the title list or lower the target.`,
			);
		}
		const title = variant > 1 ? alternates[variant - 2] : subject;

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
		// Filename = title, spaces and all. This is not cosmetic:
		//
		// `file.basename` is indexed as MiniSearch's title field
		// (`LexicalSearchService.addDocument`), and `SEARCH_TERM_SPLIT_REGEX` in
		// `searchTermUtils.ts` is `/[^\p{L}\p{N}#@_-]+/u` — it keeps `-` as a word
		// character. So `refresh-ratios-for-daily-baking` tokenizes to ONE opaque
		// token, while `Refresh Ratios for Daily Baking` tokenizes to five. A
		// kebab-case filename can therefore never partially match a query, and
		// `calculateTitleBoost` gets nothing from it.
		//
		// That matters most for exactly these notes: the filler exists to *crowd* the
		// correct answer, and slugifying it silently switched off the title signal that
		// makes it a competitor. Spaces also match how Obsidian itself names notes —
		// the hand-written fixtures in this vault have always used them.
		const content = `${frontmatter([domain.tag])}# ${title}\n\n${body}\n`;
		write(domain, titleToFilename(title), content);
	}

	// 5. Zettelkasten layer — flat, hand-written, deliberately ambiguous.
	//
	//    Written *after* the bulk loop and consuming **no draws from the shared `rng`**
	//    (every body is verbatim). Both properties are load-bearing: the shared stream
	//    means anything drawing from it here would rewrite all 285 filler notes above,
	//    and judgment cases name `sourdough-starter-maintenance-3/4/8` by slug. Keeping
	//    this section draw-free is what makes it a genuinely additive change — the
	//    existing corpus stays byte-identical, so existing baselines remain comparable.
	const zettelRoot = join(vaultPath, ZETTEL_DIR);
	mkdirSync(zettelRoot, { recursive: true });
	const zettelWritten: Array<{ slug: string; words: number }> = [];
	for (const note of ZETTEL_NOTES) {
		const lines = ["---"];
		if (note.aliases?.length) {
			lines.push("aliases:");
			for (const alias of note.aliases) lines.push(`  - ${alias}`);
		}
		for (const [key, value] of Object.entries(note.fields ?? {})) {
			lines.push(`${key}: ${value}`);
		}
		lines.push("tags:");
		lines.push(`  - ${ZETTEL_TAG}`);
		for (const tag of note.tags ?? []) lines.push(`  - ${tag}`);
		lines.push("---", "");

		// Link targets are written as display titles, but the *filename* is the title
		// with illegal characters stripped — so an em dash in a title would leave every
		// link to it dangling. Normalising the target through the same function keeps
		// links and filenames from drifting apart by construction rather than by
		// discipline; the guard below then only has to catch genuine typos.
		const linkSection = note.links?.length
			? `\n\n## Links\n\n${note.links
					.map((l) => {
						const [target, alias] = l.split("|");
						const resolved = zettelFilename({ title: target.trim() } as ZettelNote);
						return `- [[${resolved}${alias ? `|${alias}` : ""}]]`;
					})
					.join("\n")}`
			: "";
		const content = `${lines.join("\n")}# ${note.title}\n\n${note.body}${linkSection}\n`;
		writeFileSync(join(zettelRoot, `${zettelFilename(note)}.md`), content, "utf8");
		zettelWritten.push({ slug: note.slug, words: content.split(/\s+/).length });
	}

	// Guard: the polysemy and intent-frame axes measure *sense* discrimination, so their
	// competing notes must stay comparable in size. If one side grew much longer than the
	// other, the case would quietly turn into a size-bias test — the many-chunk note would
	// win or lose on surface area and the axis would report a number that means something
	// else entirely. Assert the shape rather than trusting it to stay put.
	const COMPARABLE_PAIRS: ReadonlyArray<readonly [string, string]> = [
		["1-1-priya-2026-03", "feedback-scoring-service"],
		["1-1-priya-2026-03", "feedback-i-gave-2026-q1"],
		["pr-review-backlog", "lit-noise-kahneman"],
		["evaluation-pipeline", "hiring-pipeline-platform-2026"],
		["focus-blocks-experiment", "storage-block-layout"],
		["context-window-budget", "context-switching-cost"],
		["nightly-run-failures", "running-a-team-notes"],
		["weekly-sync-is-too-long", "replica-sync-lag"],
		["scaling-the-scoring-stage", "team-capacity-reality"],
	];
	for (const [left, right] of COMPARABLE_PAIRS) {
		const a = zettelWritten.find((z) => z.slug === left);
		const b = zettelWritten.find((z) => z.slug === right);
		if (!a || !b) throw new Error(`Zettel pair not generated: ${left} / ${right}`);
		const ratio = Math.max(a.words, b.words) / Math.min(a.words, b.words);
		if (ratio > 1.6) {
			throw new Error(
				`Zettel pair ${left} (${a.words}w) / ${right} (${b.words}w) differs by ${ratio.toFixed(2)}x.\nThese notes compete for the same query and must be separated by *sense*, not size — beyond ~1.6x the case starts measuring length bias instead of polysemy. Rebalance the bodies.`,
			);
		}
	}

	// Guard: every `[[wikilink]]` must resolve to a note that exists.
	//
	// `links` entries are written as display titles, and the filenames are now derived
	// from titles too — so a link breaks the moment a title is edited without its
	// referrers being updated, or when `zettelFilename` strips a character the link
	// still contains. Obsidian renders those as dead links, and since the whole point of
	// this layer is that hierarchy lives in links and frontmatter, a silently broken
	// graph would misrepresent the fixture. Checked against both the Zettel filenames
	// and the hand-written notes already in the directory.
	const zettelFilenames = new Set(ZETTEL_NOTES.map((n) => zettelFilename(n)));
	const handWritten = readdirSync(zettelRoot)
		.filter((f) => f.endsWith(".md"))
		.map((f) => f.slice(0, -3));
	for (const name of handWritten) zettelFilenames.add(name);

	/**
	 * Link targets that intentionally have no note behind them.
	 *
	 * Real Zettelkasten vaults are full of these — you link an idea before you write it
	 * up, and Obsidian renders it as an unresolved link. Keeping one here is realistic.
	 *
	 * It has to be declared rather than tolerated, though: a guard that silently allowed
	 * dangling links could not tell a deliberate stub from a typo, which is exactly what
	 * it exists to catch.
	 */
	const INTENTIONAL_STUBS = new Set(["Rubric Versioning"]);

	const brokenLinks: string[] = [];
	for (const note of ZETTEL_NOTES) {
		for (const link of note.links ?? []) {
			if (INTENTIONAL_STUBS.has(link.split("|")[0].trim())) continue;
			// Strip any `|alias` suffix, then normalise exactly as the writer does — the
			// check is for a target that names no note at all, not for punctuation the
			// writer already reconciles.
			const target = zettelFilename({ title: link.split("|")[0].trim() } as ZettelNote);
			if (!zettelFilenames.has(target)) {
				brokenLinks.push(`${zettelFilename(note)} → [[${target}]]`);
			}
		}
	}
	if (brokenLinks.length > 0) {
		throw new Error(
			`Broken wikilink(s) in ZETTEL_NOTES:\n  ${brokenLinks.join("\n  ")}\n\nEach [[target]] must match a note filename exactly. Filenames come from \`title\` via \`zettelFilename()\`, so a link has to use the title as written (minus characters that are illegal in filenames).`,
		);
	}

	// Guard: a collision cluster with only one member tests nothing.
	//
	// This is not hypothetical. `context-switching-cost` was written for the `context`
	// cluster and its first draft never used the word — it said "state I had in my
	// head" — so the cluster silently had one member and the polysemy it claimed to
	// create did not exist. The note read fine; only counting caught it. The same
	// happened to `pitch`, which had a single member until a second sense was added.
	//
	// Checked against the rendered files rather than the source strings, so a word that
	// appears only in a title or frontmatter still counts the way the indexer sees it.
	const COLLISION_TERMS = [
		"block",
		"context",
		"run",
		"sync",
		"draft",
		"ship",
		"scale",
		"capacity",
		"charge",
		"pitch",
		"review",
		"feedback",
		"pipeline",
	];
	const zettelBodies = ZETTEL_NOTES.map((n) =>
		`${n.title} ${n.body} ${Object.values(n.fields ?? {}).join(" ")}`.toLowerCase(),
	);
	const thinClusters = COLLISION_TERMS.map((term) => ({
		term,
		count: zettelBodies.filter((b) => new RegExp(`\\b${term}`, "u").test(b)).length,
	})).filter(({ count }) => count < 2);
	if (thinClusters.length > 0) {
		throw new Error(
			`Zettel collision cluster(s) with fewer than two notes: ${thinClusters
				.map(({ term, count }) => `${term} (${count})`)
				.join(
					", ",
				)}.\nEach term must appear in at least two notes in *different senses* — that collision is the whole point of the layer, and a single-member cluster silently tests nothing. Add a second sense or drop the term from COLLISION_TERMS.`,
		);
	}

	// Guard: judgment cases reference specific filler notes by name (the recency and
	// near-duplicate crowding cases lean on the `sourdough-starter-maintenance-*`
	// series). A change that shortens the filler run would otherwise degrade those
	// cases silently — the note simply stops existing and quietly scores as absent.
	// Fail loudly here instead.
	// These are the `Sourdough Starter Maintenance` variants 3, 4 and 8 — renamed from
	// `sourdough-starter-maintenance-{3,4,8}` when the filler gained real titles. They
	// still crowd the starter queries by vocabulary, which is what the cases need; they
	// simply no longer announce their kinship through a shared title stem.
	const REQUIRED_FILLER = [
		"Fermentation/Sourdough Starter Maintenance.md",
		"Fermentation/Fridge Storage Between Bakes.md",
		"Fermentation/Discard Volume and Waste Reduction.md",
		"Fermentation/Travel and Long Dormancy Handling.md",
		"Fermentation/Refresh Ratios for Daily Baking.md",
		"Fermentation/Reviving a Neglected Culture.md",
		// Graded 0 by the `griechischer salat` cross-lingual case. German `salat`
		// prefix-matches English `salt`, and these three own "Salt" in their *titles*,
		// so they collect a title boost and beat the actual Greek-salad recipe. The
		// case only measures that if the word stays in the title — rename them and it
		// silently starts passing for the wrong reason.
		"Fermentation/Salt Tolerance Across Species.md",
		"Fermentation/Salt Type and Mineral Content.md",
		"Fermentation/Salt Percentage and Aging Duration.md",
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
		const rel = `${domain.name}/${titleToFilename(distractor.title)}.md`;
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
	console.log(
		`  probes: ${PROBES.length}, hard probes: ${HARD_PROBES.length}, distractors: ${DISTRACTORS.length}, phrase pairs: ${PHRASE_PAIRS.length}`,
	);
	console.log(`Wrote ${ZETTEL_NOTES.length} flat Zettelkasten notes to ${join(vaultPath, ZETTEL_DIR)}`);
	console.log(
		`  words: total ${totalWords}, median ${median}, min ${lengths[0]}, max ${lengths[lengths.length - 1]}`,
	);
}

main();
