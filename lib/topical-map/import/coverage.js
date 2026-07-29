'use strict'

/**
 * Collect every title present in a consolidated Koray tree: pillar, cluster,
 * and supporting nodes alike. Membership in this set is the hard coverage
 * rule; sheet pages can legitimately become a pillar or cluster hub instead
 * of a leaf, so title membership (not "must be a supporting leaf") is what
 * we check.
 */
function collectTreeTitles(structure) {
  const titles = new Set()
  for (const branch of structure?.pillars || []) {
    if (branch.pillar?.title) titles.add(branch.pillar.title)
    for (const c of branch.clusters || []) {
      if (c.title) titles.add(c.title)
      for (const s of c.supporting || []) {
        if (s.title) titles.add(s.title)
      }
    }
  }
  return titles
}

/** Count only leaf (supporting) nodes in the tree. */
function countSupporting(structure) {
  let n = 0
  for (const branch of structure?.pillars || []) {
    for (const c of branch.clusters || []) n += (c.supporting || []).length
  }
  return n
}

/**
 * Assert that every non-rolling sheet page with a title survived
 * consolidation somewhere in the tree (as a pillar, cluster, or supporting
 * title). Title membership is the hard rule. A mismatch between the
 * consolidator's reported counts.supporting and the tree's actual
 * supporting-leaf count is reported too, but only as a secondary signal:
 * sheet rows that become pillar or cluster hubs are expected to disappear
 * from the "supporting" count without ever being missing from the tree.
 */
function assertImportCoverage({ pages, structure, counts }) {
  const errors = []
  const treeTitles = collectTreeTitles(structure)

  const expectedPages = (pages || []).filter((p) => p?.title && !p.rolling_placeholder)
  const missing_titles = expectedPages.map((p) => p.title).filter((t) => !treeTitles.has(t))

  if (missing_titles.length) {
    errors.push(
      `${missing_titles.length} sheet page(s) missing from consolidated tree: ${missing_titles
        .slice(0, 8)
        .join('; ')}`
    )
  }

  const actual_supporting = countSupporting(structure)
  const expected_supporting = expectedPages.length

  if (counts && typeof counts.supporting === 'number' && counts.supporting !== actual_supporting) {
    errors.push(`counts.supporting (${counts.supporting}) does not match tree supporting (${actual_supporting})`)
  }

  return {
    ok: errors.length === 0,
    errors,
    expected_supporting,
    actual_supporting,
    missing_titles,
  }
}

module.exports = { assertImportCoverage, collectTreeTitles, countSupporting }
