# Regional chemistry sources

Expand chemistry-leaf coverage with FAO/INFOODS and a few specialist databases. The UI stays dish-name → 0–10 profile. Wrong matches are worse than misses: a rejected hit falls through to nested recipe search; a wrong hit poisons the Turso catalog forever (`INSERT OR IGNORE`).

## Problem

A leaf only scores today if USDA and FooDB both recognize the food (or Gemini calls it common pantry). USDA search is Foundation / SR Legacy only, token-strict, and US-centric. FooDB is a small dump. Regional ingredients miss and become expensive nested recipes. USDA also often stores the ingredient only as a branded product, which we currently never query.

## Hard rule: Gemini identity

**No database row is scored until Gemini says it is the same grocery ingredient as the canonical English name, in this dish’s cuisine.** Heuristics may rank candidates. They may not accept them.

This applies to every source: FAO tables, Japan, Frida, CIQUAL, USDA Foundation, USDA Branded, FooDB, UmamiDB, Phenol-Explorer, Dr. Duke.

Today `confirmFoodIdentity` is a yes/no on a single pre-picked title, twice per ingredient (USDA then FooDB), plus a common-pantry call. That is too weak once we have many databases: the heuristic winner can be wrong while the right row is sitting at #3. One call per source would be worse: eight sources × a 15-ingredient dish is over a hundred identity calls.

**One identity call per ingredient, not per source.** Search all sources first (cheap, no Gemini). Each source keeps up to five ranked candidates. One Gemini call sees the grocery name, cuisine, and every shortlist labeled by source, and returns the matching index per source or none. USDA Branded candidates go in that same USDA list when Foundation is thin; do not make a second identity round. Cached Turso names skip this entirely. If every source is none, that ingredient is not a leaf.

Treat FAO Excel tables as one nutrient-table client (origin-matched first, then the rest), not one Gemini call per spreadsheet.

Accept:

- The generic food (`Soy sauce`; `Tamarinds, raw` for tamarind paste when the flavoring food is right).
- A branded product that *is* that ingredient (`Kikkoman Soy Sauce` for soy sauce; `Red Boat Fish Sauce` for fish sauce).
- Local or scientific names for the same grocery item (`Piper nigrum` fruit for black pepper).

Reject:

- Keyword collisions (`greater galangal` ≠ `greater than 3% juice`).
- Same family, wrong species (galangal ≠ ginger).
- Wrong plant part when taste changes (leaf ≠ seed ≠ root).
- Carrier vs flavoring (chili oil ≠ canola).
- A meal or mix that merely contains the ingredient (chicken alfredo ≠ chicken).
- A flavored or sweetened variant unless the query is that variant (wasabi soy ≠ soy sauce; honey ham ≠ ham).
- A branded product that is a different food with a similar name.

Juice / paste / oil still inherit the flavoring food, not the carrier. Dish context still disambiguates (chili in som tam is the hot pepper, not sweet chili sauce). A miss is success: skip that source. Never persist a rejected hit.

## Sources and jobs

Do not ingest PDFs, scrape live sites at taste time, or take every INFOODS directory entry.

| Job | Source | Format |
| --- | --- | --- |
| Identity, sugars, sodium; origin-aware foods | FAO/INFOODS Excel first, then other easy national tables, USDA last | Excel / CSV / API |
| Free glutamate, IMP, GMP | UmamiDB; Japan amino-acid sheets as backup | Snapshot / Excel |
| Plant bitter (polyphenols) | Phenol-Explorer | Official Excel/CSV |
| Spicy (and extra plant bitters) | USDA Dr. Duke | CSV export; ppm ranges |
| Glue for odd quantified compounds | Existing FooDB dump | Already bundled |

Phenol-Explorer is polyphenols: bitter (and astringent, which we ignore). It is not spicy. Capsaicin, piperine, gingerol, mustard oil come from Duke and FooDB.

Sour stays the weak dimension. Frida is the best structured source of organic acids. Gemini may still add sour/umami/spicy when other lab evidence exists, same as today. Never `source: "llm"`.

## FAO/INFOODS first, easy formats only

Ingest only Excel, CSV, or a documented API. Values must be concentrations per 100 g (or trivially convertible). Japan is the template: spreadsheet plus extra sheets for sugars and amino acids.

**FAO Excel (wave 1):** Western Africa 2019 (WAFCT), BioFoodComp, uPulses, uFiSh, AnFooD. Optional: FAO density table for volume conversion.

**National tables in the same class (wave 1):** Japan Standard Tables 2023, Denmark Frida (organic acids), France CIQUAL (individual sugars), Kenya 2018.

**Wave 2 if still needed:** UK CoFID, Australia AFCD, Canada Nutrient File, NZ FOODfiles, Finland Fineli.

**Skip:** ASEANFOODS, Thai, China, LATINFOODS portal, Brazil TACO (PDF or scrape). India IFCT has the right chemistry but a restricted Excel — revisit only if we get a licensed file.

Lookup for nutrient tables: origin-matched table first, then other FAO Excel, then Japan / Frida / CIQUAL, then USDA. A Thai dish does not start at USDA.

## USDA branded fallback

Today `UsdaFdcClient.search` queries only Foundation and SR Legacy, and `pickUsdaFood` requires every query token in the description. Many ingredients exist only as Branded Foods.

Search Foundation + SR Legacy first. If that pool is empty or obviously thin, add Branded Foods to the same USDA shortlist (products that could *be* the ingredient, not meals). Gemini sees Foundation and Branded titles together in the one identity call. A branded hit is valid only when Gemini says the product is that ingredient. Label sodium and sugars are usable; missing acids or glutamate are not invented. Foundation / SR Legacy still beats Branded when both confirm.

Do not open Branded search for names classify already rejected as brands. This fallback is “the grocery item is sold as a product,” not “score Coca-Cola because the user typed a brand.”

## Leaf eligibility and merge

A leaf is allowed when **any** trusted source has a Gemini-confirmed hit **and** the mixer has quantified taste chemistry. Drop the USDA∩FooDB dual-hit requirement and the common-pantry eligibility check. Identity plus amounts is the gate; Gemini does not get a second vote that “this feels like a pantry item.”

Per compound class, first confirmed value wins in this order: UmamiDB (glutamate / IMP / GMP only), Phenol-Explorer (polyphenols only), Dr. Duke (pungents and bitters FooDB lacks), FooDB, origin FAO/national table, other FAO tables, USDA Foundation/SR, USDA Branded. Skip qualitative Duke rows (activity tag, no ppm). For Duke low–high ppm, use the midpoint.

Keep `draftTasteFromCompounds` and calibration. Expand `compounds.ts` only for chemicals we will actually ingest with amounts (Phenol-Explorer phenolics mapped to bitter; Duke pungents mapped to existing spicy classes).

## Matching details that are easy to get wrong

- Canonical English grocery name from existing `canonicalizeIngredientNames` is the query. Tables may be searched with English, local, and scientific aliases; Gemini still judges against that canonical name plus cuisine.
- Dr. Duke is botanical: confirm scientific name **and** plant part (black pepper = fruit of *Piper nigrum*, not a random *Piper* leaf).
- UmamiDB titles are often Japanese foods; kombu ≠ wakame; dried shiitake ≠ fresh button mushroom.
- Phenol-Explorer foods are generic (tea, cocoa, blueberry); do not attach tea polyphenols to “tea-smoked” as if it were brewed tea unless Gemini says it is tea.

## Out of scope

UI changes. Live scraping of UmamiDB or Phenol-Explorer at request time (cited snapshots / official downloads only). Phenol-Explorer “plant molecular taste” percentages. Astringency. Ingesting every INFOODS PDF.

Phenol-Explorer asks permission for commercial redistribution; cite it, keep the dump out of public Git if the license requires, and request permission before a public commercial dump. FAO Excel and USDA Duke are the easy-license core.

## Tests and docs

Tests first in `lib/engine/*.test.ts`:

- FAO/Japan/Frida mappers: INFOODS tagnames / local columns → mixer ids; ignore potassium, vitamin C, protein glutamic acid.
- USDA: Foundation hit preferred; Branded fallback only after Foundation shortlist is all rejected; branded meal rejected; branded product that *is* the ingredient accepted only after Gemini match.
- Identity: shortlist picker accepts the right row and returns none when every candidate is a collision (galangal vs juice; chili oil vs canola; wasabi soy vs soy sauce).
- Leaf: one confirmed FAO hit is enough; unconfirmed USDA/FooDB hits do not score; Duke midpoint ppm; Phenol-Explorer bitter, not spicy.

Update in the same change: `docs/ai/architecture.md`, `docs/ai/taste-engine.md`, `AGENTS.md`, `.cursor/rules/taste-engine.mdc`.
