/**
 * Review Schema Generator — 2026-Compliant
 *
 * Builds JSON-LD structured data following the schema-markup-generator skill:
 * - Full @graph with @id cross-references
 * - GEO/AI visibility layer (knowsAbout, sameAs, subjectOf)
 * - NO ClaimReview (deprecated Jan 2026)
 * - Dynamic production URL
 * - WebPage entity (was missing)
 * - Authority layer on Organization
 * - Content-schema parity
 */

// Dynamic base URL — uses NEXT_PUBLIC_SITE_URL env var, falls back to Vercel URL
function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'https://crypto-killer.vercel.app')
  )
}

/**
 * Build complete JSON-LD schema for a review page.
 */
function buildReviewSchema({ reviewContent, brandData, slug, currentDate, wordCount, longevityDays }) {
  const siteUrl = getSiteUrl()
  const reviewUrl = `${siteUrl}/review/${slug}`

  return {
    '@context': 'https://schema.org',
    '@graph': [

      // ── Organization Entity (Foundation + Authority Layer) ──
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'Crypto Killer',
        url: siteUrl,
        description: 'Scam intelligence platform powered by SpyOwl ad surveillance technology. Analyzes fraudulent advertising campaigns to protect consumers from cryptocurrency investment scams.',
        knowsAbout: [
          'Cryptocurrency Scam Detection',
          'Crypto Fraud Investigation',
          'Ad Surveillance Technology',
          'Investment Scam Analysis',
          'Celebrity Impersonation Fraud',
          'Financial Consumer Protection',
          'Digital Advertising Fraud Detection',
          'Blockchain Scam Intelligence',
        ],
        sameAs: [
          'https://github.com/madrank8/crypto-killer',
        ],
        alternateName: ['CryptoKiller', 'Crypto Killer Intelligence'],
        areaServed: {
          '@type': 'Place',
          name: 'Worldwide',
        },
        logo: {
          '@type': 'ImageObject',
          url: `${siteUrl}/logo.png`,
          width: 512,
          height: 512,
        },
      },

      // ── Person/Author Entity (Expertise + Experience) ──
      {
        '@type': 'Person',
        '@id': `${siteUrl}/#author`,
        name: 'Crypto Killer Research Team',
        jobTitle: 'Crypto Fraud Intelligence Analysts',
        worksFor: { '@id': `${siteUrl}/#organization` },
        description: reviewContent.expertise_depth || 'Specialists in ad surveillance, blockchain analysis, and financial fraud pattern recognition.',
        knowsAbout: [
          'Cryptocurrency Fraud Investigation',
          'Ad Surveillance Analysis',
          'Scam Pattern Recognition',
          'Financial Regulatory Compliance',
          'WHOIS Analysis',
          'SSL Certificate Inspection',
          'Payment Processor Identification',
        ],
        hasCredential: {
          '@type': 'EducationalOccupationalCredential',
          credentialCategory: 'Professional Experience',
          description: `SpyOwl ad surveillance platform operators with intelligence on 500+ scam brands.`,
        },
      },

      // ── WebSite Entity ──
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: siteUrl,
        name: 'Crypto Killer',
        description: 'Crypto scam intelligence and investigation platform',
        publisher: { '@id': `${siteUrl}/#organization` },
        inLanguage: 'en-US',
      },

      // ── WebPage Entity (was MISSING — required by schema-markup-generator) ──
      {
        '@type': 'WebPage',
        '@id': `${reviewUrl}#webpage`,
        url: reviewUrl,
        name: reviewContent.title || `${brandData.name} Scam Review`,
        description: reviewContent.meta_description || `Investigation of ${brandData.name} crypto scam.`,
        isPartOf: { '@id': `${siteUrl}/#website` },
        breadcrumb: { '@id': `${reviewUrl}#breadcrumb` },
        primaryImageOfPage: reviewContent.heroImage ? {
          '@type': 'ImageObject',
          url: reviewContent.heroImage,
        } : undefined,
        datePublished: currentDate,
        dateModified: currentDate,
        inLanguage: 'en-US',
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['h1', 'h2', '.key-takeaways', '.verdict'],
        },
      },

      // ── Article Entity (primary content) ──
      {
        '@type': 'Article',
        '@id': `${reviewUrl}#article`,
        headline: reviewContent.headline || reviewContent.title,
        description: reviewContent.meta_description,
        datePublished: currentDate,
        dateModified: currentDate,
        wordCount: wordCount,
        author: { '@id': `${siteUrl}/#author` },
        publisher: { '@id': `${siteUrl}/#organization` },
        isPartOf: { '@id': `${siteUrl}/#website` },
        mainEntityOfPage: { '@id': `${reviewUrl}#webpage` },
        inLanguage: 'en-US',
        about: [
          {
            '@type': 'Thing',
            name: brandData.name,
            description: `Alleged cryptocurrency investment scam with ${brandData.scam_score}/100 threat score`,
          },
          {
            '@type': 'Thing',
            name: 'Cryptocurrency Scam',
            sameAs: 'https://www.wikidata.org/wiki/Q110551885',
          },
        ],
        mentions: [
          ...(brandData.celebrity_list || []).slice(0, 5).map(celeb => ({
            '@type': 'Person',
            name: celeb,
          })),
          ...(brandData.geo_list || []).slice(0, 5).map(geo => ({
            '@type': 'Country',
            name: geo,
          })),
        ],
        citation: (reviewContent.sources || []).map(s => ({
          '@type': 'CreativeWork',
          name: s.title,
          url: s.url,
        })),
      },

      // ── Review Entity (rating — NOT ClaimReview which is deprecated) ──
      {
        '@type': 'Review',
        '@id': `${reviewUrl}#review`,
        itemReviewed: {
          '@type': 'Product',
          name: brandData.name,
          description: 'Cryptocurrency investment platform',
          category: 'Cryptocurrency Investment',
        },
        reviewRating: {
          '@type': 'Rating',
          ratingValue: Math.max(1, Math.round((100 - brandData.scam_score) / 20)),
          bestRating: 5,
          worstRating: 1,
          ratingExplanation: `Threat score of ${brandData.scam_score}/100 based on ${brandData.total_creatives} ad creatives detected across ${brandData.total_geos} countries over ${longevityDays} days.`,
        },
        author: { '@id': `${siteUrl}/#author` },
        publisher: { '@id': `${siteUrl}/#organization` },
        reviewBody: reviewContent.verdict,
        datePublished: currentDate,
      },

      // ── FAQPage Entity ──
      ...(reviewContent.faq && reviewContent.faq.length > 0 ? [{
        '@type': 'FAQPage',
        '@id': `${reviewUrl}#faqpage`,
        mainEntity: reviewContent.faq.map(f => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: f.answer,
          },
        })),
      }] : []),

      // ── HowTo Entity (AI-extractable) ──
      {
        '@type': 'HowTo',
        '@id': `${reviewUrl}#howto-protect`,
        name: `How to Protect Yourself from ${brandData.name}`,
        description: `Steps to verify, report, and protect yourself from the ${brandData.name} scam`,
        step: [
          {
            '@type': 'HowToStep',
            position: 1,
            name: 'Verify the platform',
            text: `Check FCA, SEC, and ASIC warning lists for ${brandData.name}. Any legitimate investment platform will be registered with financial regulators.`,
          },
          {
            '@type': 'HowToStep',
            position: 2,
            name: 'Do not deposit money',
            text: `${brandData.name} shows ${brandData.total_creatives} fraudulent ad creatives across ${brandData.total_geos} countries. Do not send any funds.`,
          },
          {
            '@type': 'HowToStep',
            position: 3,
            name: 'Report the scam',
            text: 'File reports with IC3.gov (FBI), ReportFraud.ftc.gov (FTC), and your local financial authority. Document all communications and transactions.',
          },
          {
            '@type': 'HowToStep',
            position: 4,
            name: 'Contact your bank',
            text: 'If you already deposited, contact your bank immediately for a chargeback. Time is critical — most banks have a 60-day dispute window.',
          },
          {
            '@type': 'HowToStep',
            position: 5,
            name: 'Avoid recovery scams',
            text: 'Any company claiming they can recover your crypto for an upfront fee is a secondary scam targeting people who already lost money.',
          },
        ],
      },

      // ── BreadcrumbList Entity ──
      {
        '@type': 'BreadcrumbList',
        '@id': `${reviewUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
          { '@type': 'ListItem', position: 2, name: 'Investigations', item: `${siteUrl}/scams` },
          { '@type': 'ListItem', position: 3, name: brandData.name, item: reviewUrl },
        ],
      },
    ],
  }
}

module.exports = { buildReviewSchema, getSiteUrl }
