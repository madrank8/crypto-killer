# Author-Cluster Assignment - Per-Author Topical Authority

## What this is

Topical authority is not only a site-level attribute. Google's patent **US8458196B1 "System and method for determining topic authority"** (Procopio, filed 2012, granted 2013, now *Expired - Fee Related*) models authority as an attribute of a **person-like entity**, accumulated per topic across documents.

> Status caveat: this patent lapsed and was built to surface topic experts inside a documents corpus from edit/contribution tracking, not as a confirmed web-ranking factor. Treat it as design philosophy that aligns with the QRG E-E-A-T author-entity direction and the 2024 leak's author/site-authority signals (and Google's reintroduction of author/profile entities) - NOT as a live ranking signal to assert as fact to a client.

## The mechanic

For an author A and a topic T:

```
AuthoritySignatureEntry(A, T, doc D) = AuthorshipPercent(A, T, D) x TopicWeight(T, D)
AuthoritySignatureValue(A, T)        = sum of entries over every document D
```

- **TopicWeight(T, D)** is an NLP confidence that D is about T (0-1). A tightly focused single-topic page scores a high weight on its topic; a multi-topic page splits the weight. Clean topical focus is the multiplier.
- **AuthorshipPercent(A, T, D)** is A's share of the topic-relevant content in D. Co-authors split it; two authors at 80/20 split that topic's authority 80/20.
- The value is a **pure accumulator** in the base claim - no decay, no ceiling, no normalization. Depth compounds.
- Retrieval is **relative**: the system ranks authors per topic and returns the top cluster / those above a distribution-derived (varying) threshold. You out-accumulate rival authors for the topic; you do not hit an absolute number.

## The assignment rule (apply in Phase 6)

**One named author entity per cluster.** Each Core/Outer sub-section of the map is a topic cluster. Assign each cluster a single primary author entity who will own the bulk of that cluster's content.

Why:

1. **Concentration beats scatter.** Spreading one author across many clusters spreads their authorship percentage thin across many topics, so no single AuthoritySignatureValue compounds. One author = one cluster concentrates the accumulation.
2. **Single-topic pages earn higher TopicWeight**, so each piece an author produces in their cluster contributes more authority per piece. This reinforces the map's existing single-vs-hub decision: keep cluster pages topically clean.
3. **Co-authorship dilutes.** Sole-author the cluster's core pages. Reserve co-authorship for deliberate name-attachment plays (a real SME whose entity you want on the page), accepting the split.
4. **Attribution must be machine-readable** or the authority accrues to nobody. A byline string Google cannot resolve to a recognized entity scores zero. Hand the assignment to `schema-markup-generator`: stable `Person` `@id` reused across the cluster, `author` on every Article pointing to it, `knowsAbout` declaring the cluster's topic, `sameAs` to external corroborators (LinkedIn, Muck Rack, ORCID, X/@handle, About page) so the entity resolves.

## Map columns

- **Tier 1 (strategic):** record the assigned **Author Entity** per Core/Outer sub-section (cluster level, not per topic).
- **Tier 3 (Entity Map / production handoff):** add **Author Entity -> Person @id -> sameAs** alongside the page's primary entity, so the handoff to `schema-markup-generator` carries the attribution.

## Coverage check

After assignment, verify:

- Every cluster has exactly one primary author entity (no orphan clusters with no concentrated author).
- No single author entity owns more clusters than they can plausibly sustain real, recognizable expertise across. Over-concentration of one persona across unrelated clusters reads as a thin author entity, not authority (see `classifier-os` author-signature audit).
- Author entities map to real, resolvable people/profiles, not invented bylines. For YMYL this is a Trust requirement, not optional.

## Cross-skill

- `schema-markup-generator` - emits the Person `@id` + `sameAs` + `knowsAbout` attribution layer that makes the percentage computable.
- `classifier-os` - audits live author concentration/dilution across the corpus (the inverse: detect where authority is scattered or orphaned).
- `algorithmic-authorship-gate` - corpus sameness/velocity (FDS) is a separate axis; author concentration is about *who* owns each cluster, not structural sameness. A corpus can pass FDS yet have orphaned or diluted authorship.
