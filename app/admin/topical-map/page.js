'use client';

import { useAdmin } from '@/lib/admin-context';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CADENCES, DEFAULT_CADENCE, buildPublicationPlan } from '@/lib/topical-map/publication-plan';
import { isWritableContentTopic } from '@/lib/topical-map/writable-topic';
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, FORCING_INPUT_SPECS, validateSullivanGate } from '@/lib/content-brief/sullivan';

// ─── Color Systems ───

const typeColors = {
  pillar_page: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  guide: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  educational: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  comparison: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  recovery_guide: 'bg-green-500/10 text-green-400 border-green-500/20',
  prevention: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  brand_review: 'bg-red-500/10 text-red-400 border-red-500/20',
  listicle: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  glossary: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const statusDot = {
  planned: 'bg-gray-500',
  in_progress: 'bg-blue-400',
  draft: 'bg-amber-400',
  review: 'bg-purple-400',
  published: 'bg-green-400',
};

const statusColors = {
  planned: 'bg-gray-500/10 text-gray-400',
  in_progress: 'bg-blue-500/10 text-blue-400',
  draft: 'bg-amber-500/10 text-amber-400',
  review: 'bg-purple-500/10 text-purple-400',
  published: 'bg-green-500/10 text-green-400',
};

// ─── Data Helpers ───

function groupChildrenByParent(topics) {
  const m = new Map();
  for (const t of topics) {
    const key = t.parent_id || 'root';
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(t);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  return m;
}

function buildDescendantCountMap(byParent) {
  const memo = new Map();
  const visit = (id) => {
    if (memo.has(id)) return memo.get(id);
    const children = byParent.get(id) || [];
    let total = children.length;
    for (const child of children) {
      total += visit(child.id);
    }
    memo.set(id, total);
    return total;
  };
  return { count: visit };
}

function collectDescendants(topicId, byParent) {
  const result = [];
  const visit = (id) => {
    const children = byParent.get(id) || [];
    for (const ch of children) {
      result.push(ch);
      visit(ch.id);
    }
  };
  visit(topicId);
  return result;
}

// ─── Micro Components ───

function TypeBadge({ contentType }) {
  const cls = typeColors[contentType] || typeColors.educational;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {contentType?.replace(/_/g, ' ') || '\u2014'}
    </span>
  );
}

function StatusBadge({ status }) {
  const cls = statusColors[status] || statusColors.planned;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>
      {status?.replace(/_/g, ' ') || '\u2014'}
    </span>
  );
}

function EvidenceBadge({ outcome }) {
  if (!outcome || outcome === 'skipped') return null;
  const isOk = outcome === 'sullivan_ok';
  return (
    <span
      title={isOk ? 'Sullivan evidence satisfied' : 'Missing Sullivan evidence - run readiness or fill manually'}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
        isOk
          ? 'bg-green-500/10 text-green-400 border-green-500/20'
          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      }`}
    >
      {isOk ? 'evidence ok' : 'needs evidence'}
    </span>
  );
}

function ImportErrorList({ detailErrors }) {
  if (!detailErrors) return null;
  const { validation_errors, coverage_errors, missing_titles } = detailErrors;
  const hasValidation = Array.isArray(validation_errors) && validation_errors.length > 0;
  const hasCoverage = Array.isArray(coverage_errors) && coverage_errors.length > 0;
  if (!hasValidation && !hasCoverage) return null;

  return (
    <div className="mt-3 rounded-lg border border-red-600/30 bg-red-950/30 p-3 text-xs max-h-48 overflow-y-auto">
      {hasValidation && (
        <>
          <p className="text-red-300 font-semibold mb-1.5">Missing required columns</p>
          <table className="w-full text-left">
            <thead>
              <tr className="text-red-400/70">
                <th className="pr-2 pb-1 font-medium">Row</th>
                <th className="pr-2 pb-1 font-medium">Title</th>
                <th className="pb-1 font-medium">Missing</th>
              </tr>
            </thead>
            <tbody>
              {validation_errors.map((err, i) => (
                <tr key={i} className="border-t border-red-800/20">
                  <td className="pr-2 py-1 text-red-200 tabular-nums">{err.row}</td>
                  <td className="pr-2 py-1 text-gray-300 max-w-[140px] truncate">{err.title}</td>
                  <td className="py-1 text-red-300">{(err.missing_columns || []).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {hasCoverage && (
        <>
          <p className={`text-red-300 font-semibold mb-1 ${hasValidation ? 'mt-3' : ''}`}>Coverage errors</p>
          <ul className="list-disc pl-4 text-red-300 space-y-0.5">
            {coverage_errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          {Array.isArray(missing_titles) && missing_titles.length > 0 && (
            <p className="mt-1.5 text-gray-400">
              Missing titles: {missing_titles.slice(0, 10).join('; ')}
              {missing_titles.length > 10 ? ` (+${missing_titles.length - 10} more)` : ''}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// content_role taxonomy: money (monetization), pillar (authority hubs),
// supporting (informational fan-out), trust (E-E-A-T builders)
const roleColors = {
  money: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
  pillar: 'bg-purple-500/10 text-purple-300 border-purple-500/25',
  supporting: 'bg-gray-500/10 text-gray-400 border-gray-600/30',
  trust: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
};

function RoleBadge({ role, expandsSlug }) {
  if (!role && !expandsSlug) return null;
  return (
    <>
      {role && (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${roleColors[role] || roleColors.supporting}`}>
          {role}
        </span>
      )}
      {expandsSlug && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-blue-500/10 text-blue-300 border-blue-500/25"
          title={`Expands existing page: /${expandsSlug}`}
        >
          \u2197 expands
        </span>
      )}
    </>
  );
}

// node_function taxonomy (lib/topical-map/node-function.js): the page a node
// plays in the authority graph. Orthogonal to content_type / content_role.
const nodeFunctionColors = {
  authority: 'bg-purple-500/10 text-purple-300 border-purple-500/25',
  commercial: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
  entity: 'bg-red-500/10 text-red-300 border-red-500/25',
  retrieval: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
  reinforcement: 'bg-gray-500/10 text-gray-400 border-gray-600/30',
};

function NodeFunctionBadge({ fn }) {
  if (!fn) return null;
  return (
    <span
      title="Node function — role in the authority graph"
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${nodeFunctionColors[fn] || nodeFunctionColors.reinforcement}`}
    >
      {fn}
    </span>
  );
}

// Content Format / format_code (Plan 3d-3). Shows the terse code compactly with
// the human-readable production format on hover.
function FormatBadge({ formatCode, contentFormat }) {
  if (!formatCode && !contentFormat) return null;
  return (
    <span
      title={contentFormat ? `Content format: ${contentFormat}` : undefined}
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-indigo-500/10 text-indigo-300 border-indigo-500/25"
    >
      {formatCode || contentFormat}
    </span>
  );
}

function SchemaBadge({ schemaType }) {
  if (!schemaType) return null;
  return (
    <span
      title="schema.org type"
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-slate-500/10 text-slate-300 border-slate-600/30"
    >
      {schemaType}
    </span>
  );
}

// v4.6 production metadata badges. Each renders null when its field is empty
// (honesty rule — never a placeholder), so sparse topics stay uncluttered.
function MetaBadges({ topic }) {
  return (
    <>
      <NodeFunctionBadge fn={topic.node_function} />
      <FormatBadge formatCode={topic.format_code} contentFormat={topic.content_format} />
      <SchemaBadge schemaType={topic.schema_type} />
    </>
  );
}

// Metric provenance vocabulary (lib/topical-map/provenance.js): a metric is
// measured (a tool returned it), estimated (a model produced it), or unresolved
// (no grounded source). Shown so a reader never mistakes an estimate for fact.
const provenanceStyle = {
  measured: 'text-emerald-400/80',
  estimated: 'text-amber-400/80',
  unresolved: 'text-gray-500',
};
const provenanceMark = { measured: '✓', estimated: '≈', unresolved: '?' };
const metricAbbr = { search_volume: 'SV', keyword_difficulty: 'KD', cpc: 'CPC', traffic_potential: 'TP', rpp_score: 'RPP', volume_trend_yearly: 'trend' };

// True when a topic has any metric worth a chip. Shared so a row wrapper can
// decide whether to render the meta line without duplicating the logic.
function hasMetricChips(topic) {
  const hasAio = !!topic.aio_risk;
  const hasPrio = typeof topic.priority_score === 'number' && topic.priority_score > 0;
  const provCount = topic.metric_provenance && typeof topic.metric_provenance === 'object'
    ? Object.values(topic.metric_provenance).filter(Boolean).length
    : 0;
  return hasAio || hasPrio || provCount > 0;
}

// Per-topic metric chips: AIO-Overview risk, priority score, and metric
// provenance. Renders null when the topic carries none of them (honesty rule).
function MetricChips({ topic }) {
  const hasAio = !!topic.aio_risk;
  const hasPrio = typeof topic.priority_score === 'number' && topic.priority_score > 0;
  const provEntries = topic.metric_provenance && typeof topic.metric_provenance === 'object'
    ? Object.entries(topic.metric_provenance).filter(([, lvl]) => lvl)
    : [];
  if (!hasAio && !hasPrio && provEntries.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {hasAio && (
        <span className={`text-[10px] font-medium ${aioColor(topic.aio_risk)}`} title="AI Overview risk">AIO:{topic.aio_risk}</span>
      )}
      {hasPrio && (
        <span className="text-[10px] text-gray-400" title="Priority score">P:{topic.priority_score}</span>
      )}
      {provEntries.length > 0 && (
        <span className="inline-flex items-center gap-1" title="Metric provenance: measured (tool) / estimated (model) / unresolved">
          {provEntries.map(([field, level]) => (
            <span key={field} className={`text-[10px] ${provenanceStyle[level] || provenanceStyle.unresolved}`}>
              {metricAbbr[field] || field}{provenanceMark[level] || provenanceMark.unresolved}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

// Content-brief preview: fetches the deterministic brief (the same projection the
// outline generator receives) so the user sees exactly what a topic hands the
// writer before generating. Read-only; the server omits empty fields (honesty).
function BriefPanel({ topic, token }) {
  const [state, setState] = useState({ loading: true, error: null, brief: null });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: null, brief: null });
    fetch(`/api/admin/topical-map/topics/${topic.id}/brief`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
        if (alive) setState({ loading: false, error: null, brief: data.brief || {} });
      })
      .catch((err) => { if (alive) setState({ loading: false, error: err.message, brief: null }); });
    return () => { alive = false; };
  }, [topic.id, token]);

  const { loading, error, brief } = state;
  const card = 'mt-2 p-3 rounded-lg border border-amber-600/30 bg-amber-900/10 text-xs';

  if (loading) return <div className={`${card} text-gray-400`}>Loading brief…</div>;
  if (error) return <div className={`${card} text-red-300`}>Brief unavailable: {error}</div>;

  const Row = ({ label, children }) => (
    <div className="flex gap-2 py-0.5">
      <span className="text-amber-300/70 font-medium shrink-0 w-28">{label}</span>
      <span className="text-gray-300 min-w-0">{children}</span>
    </div>
  );

  // Build only the production-directive rows. Emptiness is decided by what
  // ACTUALLY renders — buildContentBrief always carries identity.raw_topic /
  // priority_score, which aren't shown here, so counting brief keys would falsely
  // treat a title-only topic as "has a brief" and render a blank card.
  const b = brief || {};
  const rows = [];
  if (b.production?.content_format) rows.push(<Row key="fmt" label="Target format">{b.production.content_format}{b.production.format_code ? ` (${b.production.format_code})` : ''}</Row>);
  if (b.production?.schema_type) rows.push(<Row key="schema" label="Schema">{b.production.schema_type}</Row>);
  if (b.placement) rows.push(<Row key="place" label="Map placement">{[b.placement.node_function && `function ${b.placement.node_function}`, b.placement.node_type && `node ${b.placement.node_type}`, b.placement.page_role && `role ${b.placement.page_role}`, b.placement.section].filter(Boolean).join(' · ')}{b.placement.parent ? ` — under “${b.placement.parent}”` : ''}</Row>);
  if (b.entity) rows.push(<Row key="entity" label="Primary entity">{b.entity.name} <span className="text-gray-500">({b.entity.type})</span>{b.entity.wikidata_qid ? <span className="text-emerald-400/80"> · {b.entity.wikidata_qid}</span> : null}</Row>);
  if (b.targeting?.search_intent) rows.push(<Row key="intent" label="Search intent">{b.targeting.search_intent}</Row>);
  if (b.targeting?.secondary_keywords) rows.push(<Row key="kw" label="Secondary kw">{b.targeting.secondary_keywords.join(', ')}</Row>);
  if (b.heading_seeds) rows.push(<Row key="paa" label="Must cover (PAA)">{b.heading_seeds.join(' · ')}</Row>);
  if (b.aio_directive) rows.push(<Row key="aio" label="AIO">{b.aio_directive}</Row>);
  if (b.internal_link_targets) rows.push(<Row key="links" label="Internal links">{b.internal_link_targets.join(', ')}</Row>);
  if (b.identity?.url_path) rows.push(<Row key="url" label="URL path">{b.identity.url_path}</Row>);

  if (rows.length === 0) {
    return <div className={`${card} text-gray-500`}>No map metadata on this topic yet — nothing to brief. Regenerate the map to populate production fields.</div>;
  }

  return (
    <div className={card}>
      <p className="text-amber-300 font-semibold mb-1.5">Map directives — sent to the outline generator</p>
      {rows}
    </div>
  );
}

// Override option lists (mirror the server taxonomies in lib/topical-map/*).
const NODE_FUNCTION_OPTIONS = ['authority', 'reinforcement', 'retrieval', 'entity', 'commercial'];
const CONTENT_FORMAT_OPTIONS = ['Evergreen Article', 'Comparison Table', 'Step-by-step Guide', 'FAQ Hub', 'Listicle', 'Calculator / Interactive Tool', 'Landing Page (Commercial)', 'News / Update'];
const SCHEMA_TYPE_OPTIONS = ['Article', 'FAQPage', 'HowTo', 'ItemList', 'Review', 'NewsArticle', 'WebApplication'];
const SEARCH_INTENT_OPTIONS = ['informational', 'commercial', 'transactional', 'navigational'];

function ProgressRing({ percent, size = 48, stroke = 4, color = '#ef4444' }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

// ─── Full 12-section Content Brief + Sullivan Gate (SC-098) ───
// The skill treats a failed gate as a HARD STOP. Here it is a recoverable block:
// the form shows exactly which forcing inputs are missing and why. It NEVER
// pre-fills one — inventing evidence to pass the gate is, per the skill, as severe
// as inventing a PMID. Uses the same validator as the server, so no drift.
function SullivanField({ spec, value, onChange }) {
  const base = 'search-input w-full text-xs';
  if (spec.kind === 'enum') {
    return (
      <select className={base} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— select —</option>
        {spec.values.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }
  if (spec.kind === 'list_min') {
    const text = Array.isArray(value) ? value.join('\n') : (value || '');
    return (
      <textarea
        className={`${base} min-h-[56px] font-mono`}
        value={text}
        placeholder={`One per line — at least ${spec.min}`}
        onChange={(e) => onChange(e.target.value.split('\n'))}
      />
    );
  }
  if (spec.kind === 'int_min') {
    return <input type="number" className={base} value={value ?? ''} placeholder={`≥ ${spec.min}`} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  }
  if (spec.kind === 'date') {
    return <input type="date" className={base} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  }
  if (spec.kind === 'qid') {
    return <input type="text" className={base} value={value || ''} placeholder="Q12345" onChange={(e) => onChange(e.target.value)} />;
  }
  return <textarea className={`${base} min-h-[40px]`} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
}

function ContentBriefPanel({ topic, token }) {
  const [state, setState] = useState({ loading: true, error: null, row: null });
  const [contentType, setContentType] = useState('');
  // Inputs are held PER content type. Switching types must not destroy what the
  // author already wrote for another type — forcing inputs are hard-won evidence,
  // not scratch text, and there is no undo once a save overwrites them.
  const [inputsByType, setInputsByType] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputs = inputsByType[contentType] || {};
  const setInput = (field, v) =>
    setInputsByType((prev) => ({ ...prev, [contentType]: { ...(prev[contentType] || {}), [field]: v } }));

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: null, row: null });
    fetch(`/api/admin/topical-map/topics/${topic.id}/content-brief`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
        if (!alive) return;
        setState({ loading: false, error: null, row: data.brief_row || null });
        const savedType = data.brief_row?.content_type || '';
        setContentType(savedType);
        setInputsByType(savedType ? { [savedType]: data.brief_row?.forcing_inputs || {} } : {});
      })
      .catch((err) => { if (alive) setState({ loading: false, error: err.message, row: null }); });
    return () => { alive = false; };
  }, [topic.id, token]);

  // Live gate verdict using the SAME module the server validates with.
  const gate = useMemo(
    () => validateSullivanGate({ content_type: contentType || null, forcing_inputs: inputs }),
    [contentType, inputs]
  );

  const save = async () => {
    setSaving(true); setSaveError('');
    try {
      const res = await fetch(`/api/admin/topical-map/topics/${topic.id}/content-brief`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content_type: contentType || null, forcing_inputs: inputs }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      setState((s) => ({ ...s, row: data.brief_row || null }));
      if (data.demoted_from) {
        setSaveError(`Brief regenerated — status reset from "${data.demoted_from}" to draft, since the approval covered the previous content.`);
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const enrich = async () => {
    setEnriching(true); setSaveError(''); setEnrichResult(null);
    try {
      const res = await fetch(`/api/admin/topical-map/topics/${topic.id}/content-brief/enrich`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Enrichment failed');
      setState((s) => ({ ...s, row: data.brief_row || null }));
      setEnrichResult({ enriched: data.enriched || [], rejected: data.rejected || [], model: data.model });
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setEnriching(false);
    }
  };

  const setStatus = async (status) => {
    setStatusBusy(true); setSaveError('');
    try {
      const res = await fetch(`/api/admin/topical-map/topics/${topic.id}/content-brief`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Status change failed');
      setState((s) => ({ ...s, row: data.brief_row || null }));
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setStatusBusy(false);
    }
  };

  const yamlUrl = `/api/admin/topical-map/topics/${topic.id}/content-brief/yaml`;

  const fetchYaml = async () => {
    const res = await fetch(yamlUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d?.error || 'Export failed');
    }
    return res.text();
  };

  const copyYaml = async () => {
    setSaveError('');
    try {
      await navigator.clipboard.writeText(await fetchYaml());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setSaveError(e.message);
    }
  };

  // Authorized fetch then blob download — a plain link cannot carry the bearer token.
  const downloadYaml = async () => {
    setSaveError('');
    try {
      const text = await fetchYaml();
      const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.row?.brief_id || 'content-brief'}.yaml`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setSaveError(e.message);
    }
  };

  const card = 'mt-2 p-3 rounded-lg border text-xs';
  if (state.loading) return <div className={`${card} border-gray-700/60 bg-gray-900/60 text-gray-400`}>Loading content brief…</div>;
  if (state.error) return <div className={`${card} border-red-700/40 bg-red-900/10 text-red-300`}>Content brief unavailable: {state.error}</div>;

  const { row } = state;
  const savedType = row?.content_type || '';
  const specs = contentType ? (FORCING_INPUT_SPECS[contentType] || []) : [];
  const missingByField = new Map(gate.missing.map((m) => [m.field, m]));

  return (
    <div className={`${card} ${gate.ok ? 'border-emerald-700/40 bg-emerald-900/10' : 'border-amber-600/30 bg-amber-900/10'}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className={`font-semibold ${gate.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
          Content Brief — Sullivan Gate (SC-098)
        </p>
        {row?.status && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-gray-600/40 text-gray-400">{row.status}</span>}
      </div>

      <p className="text-gray-400 mb-2">
        A brief may only be generated for <span className="text-gray-200">non-commodity</span> content. Declare a content type and supply
        its forcing inputs — these come from you, the team, or the dataset. They are never inferred.
      </p>

      <label className="block text-[11px] text-gray-500 mb-2">
        Content type
        <select
          className="search-input w-full text-xs mt-0.5"
          value={contentType}
          onChange={(e) => setContentType(e.target.value)}
        >
          <option value="">— select —</option>
          {CONTENT_TYPES.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>)}
        </select>
      </label>

      {!contentType && (
        <p className="text-amber-300/80">
          If none of the five types fit, the piece is commodity content and SC-098 rejects it — that is a signal to change the angle, not to force it through.
        </p>
      )}

      {specs.length > 0 && (
        <div className="space-y-2">
          {specs.map((spec) => {
            const miss = missingByField.get(spec.field);
            return (
              <div key={spec.field}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-gray-400">{spec.label}</span>
                  {miss && <span className="text-[10px] text-amber-400 shrink-0">{miss.reason}</span>}
                </div>
                <SullivanField spec={spec} value={inputs[spec.field]} onChange={(v) => setInput(spec.field, v)} />
              </div>
            );
          })}
        </div>
      )}

      {savedType && contentType && contentType !== savedType && (
        <p className="mt-2 text-amber-300/90">
          ⚠ This topic already has saved <span className="font-medium">{savedType}</span> evidence. Saving as{' '}
          <span className="font-medium">{contentType}</span> will replace it. Switch back to{' '}
          <button type="button" className="underline hover:text-amber-200" onClick={() => setContentType(savedType)}>{savedType}</button>{' '}
          to keep it — your entries for each type are preserved until you save.
        </p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={save} disabled={saving} className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
          {saving ? 'Saving…' : gate.ok ? 'Save & generate brief' : 'Save progress'}
        </button>
        {gate.ok
          ? <span className="text-emerald-400 text-[11px]">Gate passes — saving generates the 12-section brief.</span>
          : <span className="text-amber-400/80 text-[11px]">{gate.missing.length || gate.errors.length} item(s) outstanding — progress is still saved.</span>}
      </div>
      {saveError && <p className="text-red-300 mt-1.5">{saveError}</p>}

      {row?.brief && (
        <div className="mt-3 pt-2 border-t border-gray-700/40">
          <p className="text-emerald-300/90 font-medium mb-1">Generated brief · {row.brief_id}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
            <span>Format: <span className="text-gray-300">{row.brief.content_format}</span></span>
            <span>Schema: <span className="text-gray-300">{row.brief.schema_type}</span></span>
            <span>Intent: <span className="text-gray-300">{row.brief.search_intent}</span></span>
            <span>Words: <span className="text-gray-300">{row.brief.word_count_target}</span></span>
            <span>Passage indep.: <span className="text-gray-300">{row.brief.passage_independence}</span></span>
            <span>Headings: <span className="text-gray-300">{Array.isArray(row.brief.heading_structure) ? row.brief.heading_structure.length : 0}</span></span>
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">
            Fields marked [PENDING…] are filled by LLM enrichment; [NO DATA…]/[UNVERIFIED…] mean the data could not be verified — never guessed.
          </p>

          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={enrich} disabled={enriching}
              className="text-[11px] px-2 py-1 rounded-md border border-blue-500/30 text-blue-300 hover:text-white hover:border-blue-400/50 transition disabled:opacity-50">
              {enriching ? 'Enriching…' : 'Enrich creative sections (Sonnet)'}
            </button>
            <span className="text-[10px] text-gray-600">Measured + human-supplied fields stay locked.</span>
          </div>

          <div className="flex items-center flex-wrap gap-2 mt-2 pt-2 border-t border-gray-700/40">
            <button type="button" onClick={downloadYaml}
              className="text-[11px] px-2 py-1 rounded-md border border-emerald-500/30 text-emerald-300 hover:text-white hover:border-emerald-400/50 transition">
              Download YAML
            </button>
            <button type="button" onClick={copyYaml}
              className="text-[11px] px-2 py-1 rounded-md border border-gray-700/60 text-gray-400 hover:text-white hover:border-gray-500 transition">
              {copied ? 'Copied' : 'Copy YAML'}
            </button>
            <span className="text-[10px] text-gray-600">→ seo-blog-generator</span>
            <span className="flex-1" />
            <label className="text-[10px] text-gray-500 flex items-center gap-1">
              Status
              <select
                className="search-input text-[11px] py-0.5"
                value={row.status || 'draft'}
                disabled={statusBusy}
                onChange={(e) => setStatus(e.target.value)}
              >
                {['draft', 'approved', 'in-production', 'published'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          {enrichResult && (
            <div className="mt-2 text-[11px]">
              <p className="text-blue-300/90">
                Enriched {enrichResult.enriched.length} section(s){enrichResult.model ? ` via ${enrichResult.model}` : ''}.
              </p>
              {enrichResult.rejected.length > 0 && (
                <details className="mt-1">
                  <summary className="text-amber-400/80 cursor-pointer">
                    {enrichResult.rejected.length} model output(s) blocked by the honesty guard
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-gray-500 max-h-32 overflow-y-auto">
                    {enrichResult.rejected.map((r, i) => (
                      <li key={i}><span className="text-gray-400">{r.field}</span> — {r.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Publication Plan (Step 22) ───
// Computed entirely from the already-loaded topics array — no API round-trip.
// startDate is passed explicitly so the plan module never reads a clock.
function PublicationPlanPanel({ topics }) {
  const [open, setOpen] = useState(false);
  const [cadence, setCadence] = useState(DEFAULT_CADENCE);
  const [startDate] = useState(() => new Date().toISOString().slice(0, 10));

  const plan = useMemo(
    () => buildPublicationPlan(topics, { cadence, startDate }),
    [topics, cadence, startDate]
  );

  // Always render the header — hiding the panel when nothing is left to schedule
  // would make the "all caught up" state unreachable after a reload (no toggle to
  // click), which is exactly the kind of dead-end this dashboard must not have.
  return (
    <div className="rounded-xl border border-gray-800/60 bg-gray-900/40">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left flex-1 min-w-0">
          <ChevronToggle expanded={open} size="sm" />
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Publication Plan</span>
          <span className="text-sm text-gray-300">
            {plan.total === 0
              ? 'All caught up — every topic is published'
              : `${plan.total} unpublished · ${plan.weeks.length} week${plan.weeks.length === 1 ? '' : 's'}`}
          </span>
        </button>
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="search-input text-xs py-1"
          title="Site maturity — sets the publishing cadence (skill Step 22)"
        >
          {Object.values(CADENCES).map((c) => (
            <option key={c.key} value={c.key}>{c.label} — {c.rangeLabel}</option>
          ))}
        </select>
      </div>

      {open && (
        <div className="border-t border-gray-800/40 px-4 py-3 space-y-2 max-h-96 overflow-y-auto">
          {plan.cadence.note && <p className="text-[11px] text-amber-300/70">{plan.cadence.note}</p>}
          {plan.cadence.refreshesPerWeek > 0 && (
            <p className="text-[11px] text-gray-500">
              Cadence also budgets {plan.cadence.refreshesPerWeek} refresh{plan.cadence.refreshesPerWeek === 1 ? '' : 'es'}/week of existing content.
            </p>
          )}
          {plan.weeks.length === 0 && <p className="text-xs text-gray-500">Nothing left to schedule — every topic is published.</p>}
          {plan.weeks.map((w) => (
            <div key={w.week} className="flex gap-3 py-1 border-b border-gray-800/30 last:border-0">
              <div className="shrink-0 w-28">
                <span className="text-xs text-gray-300 font-medium">Week {w.week}</span>
                {w.target_date && <span className="block text-[10px] text-gray-600 tabular-nums">{w.target_date}</span>}
              </div>
              <div className="min-w-0 flex-1 flex flex-wrap gap-1.5">
                {w.topics.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 text-[11px] text-gray-400" title={t.target_keyword || t.title}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDot[t.content_status] || statusDot.planned}`} />
                    <span className="truncate max-w-[16rem]">{t.title}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Topic Editor (inline) ───

function TopicEditor({ topic, token, onCancel, onSaved }) {
  const [title, setTitle] = useState(topic.title || '');
  const [keyword, setKeyword] = useState(topic.target_keyword || '');
  const [priority, setPriority] = useState(String(topic.priority_score ?? 0));
  const [notes, setNotes] = useState(topic.notes || '');
  const [nodeFunction, setNodeFunction] = useState(topic.node_function || '');
  const [contentFormat, setContentFormat] = useState(topic.content_format || '');
  const [schemaType, setSchemaType] = useState(topic.schema_type || '');
  const [searchIntent, setSearchIntent] = useState(topic.search_intent || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Preserve an existing value that isn't one of the known options (so an
  // override never silently drops an LLM-produced value the UI doesn't list).
  const withCurrent = (options, current) => (current && !options.includes(current) ? [current, ...options] : options);

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/topical-map/topics/${topic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          target_keyword: keyword || null,
          priority_score: parseInt(priority, 10) || 0,
          notes: notes || null,
          node_function: nodeFunction || null,
          content_format: contentFormat || null,
          schema_type: schemaType || null,
          search_intent: searchIntent || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Save failed');
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 p-4 rounded-lg border border-gray-700/60 bg-gray-900/80 space-y-3">
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <input className="search-input w-full text-sm col-span-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <input className="search-input w-full text-sm" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Target keyword" />
        <input className="search-input w-full text-sm" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="Priority" type="number" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[11px] text-gray-500">Node function
          <select className="search-input w-full text-sm mt-0.5" value={nodeFunction} onChange={(e) => setNodeFunction(e.target.value)}>
            <option value="">— unset —</option>
            {withCurrent(NODE_FUNCTION_OPTIONS, nodeFunction).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-gray-500">Search intent
          <select className="search-input w-full text-sm mt-0.5" value={searchIntent} onChange={(e) => setSearchIntent(e.target.value)}>
            <option value="">— unset —</option>
            {withCurrent(SEARCH_INTENT_OPTIONS, searchIntent).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-gray-500">Content format
          <select className="search-input w-full text-sm mt-0.5" value={contentFormat} onChange={(e) => setContentFormat(e.target.value)}>
            <option value="">— unset —</option>
            {withCurrent(CONTENT_FORMAT_OPTIONS, contentFormat).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-gray-500">Schema type
          <select className="search-input w-full text-sm mt-0.5" value={schemaType} onChange={(e) => setSchemaType(e.target.value)}>
            <option value="">— unset —</option>
            {withCurrent(SCHEMA_TYPE_OPTIONS, schemaType).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </div>
      <textarea className="search-input w-full text-sm min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving} className="btn btn-primary text-sm px-3 py-1.5">
          {saving ? 'Saving\u2026' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-300">Cancel</button>
      </div>
    </div>
  );
}

// ─── Topic Row (leaf or nested) ───

function TopicRow({ topic, depth, byParent, token, onPatch, onDelete, onWriteArticle, writingId, editingId, setEditingId, descendantCountById, statusFilter, readinessTopics }) {
  const children = byParent.get(topic.id) || [];
  const isLeaf = children.length === 0;
  const editing = editingId === topic.id;
  const descendants = descendantCountById.get(topic.id) || 0;
  const [expanded, setExpanded] = useState(depth < 1); // only auto-expand first level
  const [briefOpen, setBriefOpen] = useState(false);
  const [cbOpen, setCbOpen] = useState(false);

  // Filter children if status filter is active
  const filteredChildren = useMemo(() => {
    if (!statusFilter) return children;
    return children.filter(ch => {
      if (ch.content_status === statusFilter) return true;
      // Keep parent if any descendant matches
      const desc = collectDescendants(ch.id, byParent);
      return desc.some(d => d.content_status === statusFilter);
    });
  }, [children, statusFilter, byParent]);

  // Status filter: hide this topic if it doesn't match and has no matching descendants
  // (only applied at depth > 0, roots are always shown if they have matching descendants)

  const isPillar = topic.content_type === 'pillar_page';
  const isCluster = !isPillar && !isLeaf;

  // Pillar-level rendering: prominent card
  if (isPillar && depth === 0) {
    const childStatuses = collectDescendants(topic.id, byParent);
    const pubCount = childStatuses.filter(d => d.content_status === 'published').length + (topic.content_status === 'published' ? 1 : 0);
    const totalCount = childStatuses.length + 1;
    const pubPercent = totalCount > 0 ? Math.round((pubCount / totalCount) * 100) : 0;

    return (
      <div className="rounded-2xl border border-gray-700/50 bg-gradient-to-b from-gray-900/80 to-gray-900/40 overflow-hidden">
        {/* Pillar header */}
        <div
          className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="relative flex-shrink-0">
            <ProgressRing percent={pubPercent} size={44} stroke={3.5} color="#a855f7" />
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-purple-300">
              {pubPercent}%
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="text-white font-semibold text-base truncate">{topic.title}</span>
              <TypeBadge contentType={topic.content_type} />
              <RoleBadge role={topic.content_role} expandsSlug={topic.expands_content_slug} />
              <MetaBadges topic={topic} />
              <StatusBadge status={topic.content_status} />
            </div>
            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
              {topic.target_keyword && <span className="text-gray-400">{topic.target_keyword}</span>}
              <span>{totalCount} topics</span>
              <span className="text-green-400/70">{pubCount} published</span>
              {typeof topic.search_volume === 'number' && <span>vol: {topic.search_volume.toLocaleString()}</span>}
              <MetricChips topic={topic} />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <TopicActions
              topic={topic}
              descendants={descendants}
              editingId={editingId}
              setEditingId={setEditingId}
              onDelete={onDelete}
              onWriteArticle={onWriteArticle}
              writingId={writingId}
              briefOpen={briefOpen}
              onToggleBrief={() => setBriefOpen(o => !o)}
              cbOpen={cbOpen}
              onToggleContentBrief={() => setCbOpen(o => !o)}
            />
            <ChevronToggle expanded={expanded} />
          </div>
        </div>

        {editing && (
          <div className="px-5 pb-4">
            <TopicEditor topic={topic} token={token} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onPatch(); }} />
          </div>
        )}

        {briefOpen && (
          <div className="px-5 pb-4">
            <BriefPanel topic={topic} token={token} />
          </div>
        )}

        {cbOpen && (
          <div className="px-5 pb-4">
            <ContentBriefPanel topic={topic} token={token} />
          </div>
        )}

        {/* Children */}
        {expanded && filteredChildren.length > 0 && (
          <div className="border-t border-gray-800/40">
            {filteredChildren.map(ch => (
              <TopicRow
                key={ch.id} topic={ch} depth={depth + 1}
                byParent={byParent} token={token} onPatch={onPatch} onDelete={onDelete}
                onWriteArticle={onWriteArticle} writingId={writingId} editingId={editingId}
                setEditingId={setEditingId} descendantCountById={descendantCountById}
                statusFilter={statusFilter} readinessTopics={readinessTopics}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Cluster-level rendering: collapsible group with count badge
  if (isCluster) {
    return (
      <div className={`${depth > 1 ? 'ml-4' : ''}`}>
        <div
          className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.02] transition border-b border-gray-800/30"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronToggle expanded={expanded} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white text-sm font-medium truncate">{topic.title}</span>
              <TypeBadge contentType={topic.content_type} />
              <RoleBadge role={topic.content_role} expandsSlug={topic.expands_content_slug} />
              <MetaBadges topic={topic} />
              <StatusBadge status={topic.content_status} />
              <span className="text-[10px] text-gray-600 tabular-nums">{children.length} sub</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 flex-wrap">
              {topic.target_keyword && <span className="text-[11px] text-gray-500 truncate">{topic.target_keyword}</span>}
              <MetricChips topic={topic} />
            </div>
          </div>
          <TopicActions
            topic={topic}
            descendants={descendants}
            editingId={editingId}
            setEditingId={setEditingId}
            onDelete={onDelete}
            onWriteArticle={onWriteArticle}
            writingId={writingId}
            briefOpen={briefOpen}
            onToggleBrief={() => setBriefOpen(o => !o)}
            cbOpen={cbOpen}
            onToggleContentBrief={() => setCbOpen(o => !o)}
          />
        </div>

        {editing && (
          <div className="px-4 pb-3">
            <TopicEditor topic={topic} token={token} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onPatch(); }} />
          </div>
        )}

        {briefOpen && (
          <div className="px-4 pb-2">
            <BriefPanel topic={topic} token={token} />
          </div>
        )}

        {cbOpen && (
          <div className="px-4 pb-2">
            <ContentBriefPanel topic={topic} token={token} />
          </div>
        )}

        {expanded && (
          <div className="ml-3 border-l border-gray-800/40">
            {filteredChildren.map(ch => (
              <TopicRow
                key={ch.id} topic={ch} depth={depth + 1}
                byParent={byParent} token={token} onPatch={onPatch} onDelete={onDelete}
                onWriteArticle={onWriteArticle} writingId={writingId} editingId={editingId}
                setEditingId={setEditingId} descendantCountById={descendantCountById}
                statusFilter={statusFilter} readinessTopics={readinessTopics}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Leaf-level rendering: compact single row
  return (
    <div className={`${depth > 1 ? 'ml-4' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.02] transition border-b border-gray-800/20">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot[topic.content_status] || statusDot.planned}`} title={topic.content_status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-gray-200 text-sm truncate">{topic.title}</span>
            <TypeBadge contentType={topic.content_type} />
            <RoleBadge role={topic.content_role} expandsSlug={topic.expands_content_slug} />
            <MetaBadges topic={topic} />
            <EvidenceBadge outcome={readinessTopics?.[topic.id]?.outcome} />
          </div>
          {(topic.target_keyword && topic.target_keyword !== topic.title) || hasMetricChips(topic) ? (
            <div className="mt-0.5 flex items-center gap-2 flex-wrap">
              {topic.target_keyword && topic.target_keyword !== topic.title && <span className="text-[11px] text-gray-600 truncate">{topic.target_keyword}</span>}
              <MetricChips topic={topic} />
            </div>
          ) : null}
        </div>
        <TopicActions
          topic={topic}
          descendants={0}
          editingId={editingId}
          setEditingId={setEditingId}
          onDelete={onDelete}
          onWriteArticle={onWriteArticle}
          writingId={writingId}
          compact
          briefOpen={briefOpen}
          onToggleBrief={() => setBriefOpen(o => !o)}
          cbOpen={cbOpen}
          onToggleContentBrief={() => setCbOpen(o => !o)}
        />
      </div>

      {editing && (
        <div className="px-4 pb-3">
          <TopicEditor topic={topic} token={token} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onPatch(); }} />
        </div>
      )}

      {briefOpen && (
        <div className="px-4 pb-2">
          <BriefPanel topic={topic} token={token} />
        </div>
      )}

      {cbOpen && (
        <div className="px-4 pb-2">
          <ContentBriefPanel topic={topic} token={token} />
        </div>
      )}
    </div>
  );
}

// ─── Action Buttons ───

function TopicActions({ topic, descendants, editingId, setEditingId, onDelete, onWriteArticle, writingId, compact, briefOpen, onToggleBrief, cbOpen, onToggleContentBrief }) {
  const editing = editingId === topic.id;
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
      <button
        type="button" title={briefOpen ? 'Hide map directives' : 'Map directives sent to the outline generator'}
        className={`p-1 transition ${briefOpen ? 'text-amber-300' : 'text-gray-600 hover:text-white'}`}
        onClick={() => onToggleBrief && onToggleBrief()}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </button>
      <button
        type="button" title={cbOpen ? 'Hide content brief' : 'Content brief (12-section) + Sullivan Gate'}
        className={`p-1 transition ${cbOpen ? 'text-emerald-300' : 'text-gray-600 hover:text-white'}`}
        onClick={() => onToggleContentBrief && onToggleContentBrief()}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      </button>
      <button
        type="button" title="Edit"
        className="text-gray-600 hover:text-white p-1 transition"
        onClick={() => setEditingId(editing ? null : topic.id)}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L7.5 21H3v-4.5L14.732 3.732z" />
        </svg>
      </button>
      {!compact && (
        <button
          type="button" title={descendants > 0 ? `Delete (${descendants} subtopics)` : 'Delete'}
          className="text-gray-600 hover:text-red-400 p-1 transition"
          onClick={() => onDelete(topic, descendants)}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8" />
          </svg>
        </button>
      )}
      {topic.content_type === 'brand_review' ? (
        <Link
          href="/admin/brands"
          className="text-[11px] px-2 py-1 rounded-md border border-gray-700/60 text-gray-400 hover:text-white hover:border-gray-500 transition"
        >
          Review
        </Link>
      ) : topic.content_id ? (
        <Link
          href={`/admin/content/${topic.content_id}`}
          className="text-[11px] px-2 py-1 rounded-md border border-blue-500/30 text-blue-300 hover:text-white hover:border-blue-400/50 transition"
        >
          Edit
        </Link>
      ) : isWritableContentTopic(topic) ? (
        <button
          type="button"
          onClick={() => onWriteArticle(topic)}
          disabled={writingId === topic.id}
          className="text-[11px] px-2 py-1 rounded-md border border-green-500/30 text-green-300 hover:text-white hover:border-green-400/50 transition disabled:opacity-50"
        >
          {writingId === topic.id ? '\u2026' : 'Write'}
        </button>
      ) : (
        <span
          className="text-[10px] px-2 py-1 rounded-md border border-gray-800 text-gray-600"
          title={
            topic.topic_type === 'cluster'
              ? 'Cluster folder — expand and Write a supporting page'
              : 'Structural hub — not a sheet keyword page'
          }
        >
          {topic.topic_type === 'cluster' ? 'Folder' : 'Hub'}
        </span>
      )}
    </div>
  );
}

// ─── Checkpoint A: editable keyword pool review ───

const aioColor = (risk) =>
  risk === 'critical' ? 'text-red-400' : risk === 'high' ? 'text-orange-400' : risk === 'medium' ? 'text-amber-400' : 'text-green-400';

function PoolReviewCard({ checkpoint, onApprove, onCancel }) {
  const [removedClusters, setRemovedClusters] = useState(() => new Set());
  const [removedKeywords, setRemovedKeywords] = useState(() => new Set());
  const [promoted, setPromoted] = useState(() => new Set());
  const [expandedKey, setExpandedKey] = useState(null);
  const [addText, setAddText] = useState('');
  const [showUnclustered, setShowUnclustered] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleSet = (setter) => (value) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  const toggleCluster = toggleSet(setRemovedClusters);
  const toggleKeyword = toggleSet(setRemovedKeywords);
  const togglePromoted = toggleSet(setPromoted);

  const addedList = addText
    .split('\n')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const editCount = removedClusters.size + removedKeywords.size + promoted.size + addedList.length;

  const submit = async () => {
    setSubmitting(true);
    try {
      await onApprove({
        removed_cluster_keys: [...removedClusters],
        removed_keywords: [...removedKeywords],
        promoted_keywords: [...promoted],
        added_keywords: addedList,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 p-3 rounded-lg border border-amber-600/30 bg-amber-900/10">
      <p className="text-amber-300 text-sm font-medium">Keyword pool review</p>
      <p className="text-xs text-gray-400 mt-1">
        {checkpoint.pool_size} keywords → {checkpoint.clusters?.length || 0} SERP clusters
        ({checkpoint.unclustered_count} unclustered). Click a cluster to expand its keywords;
        remove what you don't want, add what's missing.
      </p>

      {/* Clusters */}
      <div className="mt-2 max-h-64 overflow-y-auto space-y-0.5 pr-1">
        {(checkpoint.clusters || []).map((c) => {
          const clusterRemoved = removedClusters.has(c.cluster_key);
          const isExpanded = expandedKey === c.cluster_key;
          return (
            <div key={c.cluster_key} className={`rounded-md ${clusterRemoved ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2 text-[11px] text-gray-400 py-0.5">
                <button
                  type="button"
                  className="text-gray-500 hover:text-white flex-shrink-0 w-4"
                  onClick={() => setExpandedKey(isExpanded ? null : c.cluster_key)}
                  title="Show keywords"
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
                <span className={`text-gray-200 truncate flex-1 ${clusterRemoved ? 'line-through' : ''}`}>{c.head_keyword}</span>
                <span className="tabular-nums">{c.keyword_count} kw</span>
                <span className="tabular-nums">vol {c.total_volume?.toLocaleString?.() ?? c.total_volume}</span>
                {c.covered_count > 0 && (
                  <span className="text-blue-400" title={`${c.covered_count} keyword(s) already covered by live pages — new nodes will expand them, not duplicate`}>
                    {c.covered_count} live
                  </span>
                )}
                {c.authority?.dr_min != null && (
                  <span className={c.authority.dr_min < 30 ? 'text-green-400' : c.authority.dr_min < 50 ? 'text-amber-400' : 'text-gray-500'} title="Weakest DR in top 10 — lower is easier to win">
                    DR≥{c.authority.dr_min}
                  </span>
                )}
                <span className={aioColor(c.aio_risk)}>AIO:{c.aio_risk}</span>
                <button
                  type="button"
                  className={`flex-shrink-0 px-1 ${clusterRemoved ? 'text-green-400 hover:text-green-300' : 'text-gray-600 hover:text-red-400'}`}
                  title={clusterRemoved ? 'Restore cluster' : 'Remove cluster'}
                  onClick={() => toggleCluster(c.cluster_key)}
                >
                  {clusterRemoved ? '↺' : '✕'}
                </button>
              </div>
              {isExpanded && !clusterRemoved && (
                <div className="ml-6 mb-1 flex flex-wrap gap-1">
                  {(c.keywords || []).map((k) => {
                    const kwRemoved = removedKeywords.has(k.keyword);
                    return (
                      <button
                        key={k.keyword}
                        type="button"
                        onClick={() => toggleKeyword(k.keyword)}
                        title={kwRemoved ? 'Restore keyword' : 'Remove keyword'}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
                          kwRemoved
                            ? 'border-red-500/40 text-red-400 line-through'
                            : k.covered_by
                              ? 'border-blue-500/40 text-blue-300 hover:border-red-400/50 hover:text-red-300'
                              : 'border-gray-700/60 text-gray-300 hover:border-red-400/50 hover:text-red-300'
                        }`}
                      >
                        {k.covered_by ? '◉ ' : ''}{k.keyword}
                        {k.search_volume != null && <span className="text-gray-500"> {k.search_volume}</span>}
                        <span className="ml-1">{kwRemoved ? '↺' : '✕'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unclustered */}
      {(checkpoint.unclustered || []).length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            className="text-[11px] text-gray-400 hover:text-white"
            onClick={() => setShowUnclustered(!showUnclustered)}
          >
            {showUnclustered ? '▾' : '▸'} Unclustered keywords ({checkpoint.unclustered_count}) — click + to include as standalone topics
          </button>
          {showUnclustered && (
            <div className="mt-1 flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1">
              {checkpoint.unclustered.map((u) => {
                const isPromoted = promoted.has(u.keyword);
                const isRemoved = removedKeywords.has(u.keyword);
                if (isRemoved) return null;
                return (
                  <button
                    key={u.keyword}
                    type="button"
                    onClick={() => togglePromoted(u.keyword)}
                    title={isPromoted ? 'Undo include' : 'Include as its own topic'}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
                      isPromoted
                        ? 'border-green-500/50 text-green-300 bg-green-900/20'
                        : 'border-gray-700/60 text-gray-400 hover:border-green-400/50 hover:text-green-300'
                    }`}
                  >
                    {isPromoted ? '✓ ' : '+ '}{u.keyword}
                    {u.search_volume != null && <span className="text-gray-500"> {u.search_volume}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add keywords */}
      <label className="block text-[11px] text-gray-400 mt-3 mb-1">
        Add keywords (one per line, max 50) — grounded with real DataForSEO/Ahrefs metrics on approve
      </label>
      <textarea
        className="search-input w-full text-xs min-h-[52px]"
        value={addText}
        onChange={(e) => setAddText(e.target.value)}
        placeholder={'crypto scam recovery uk\nhow to report a crypto scammer'}
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={submitting}
          className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm text-white disabled:opacity-50"
          onClick={submit}
        >
          {submitting ? 'Applying…' : editCount > 0 ? `Approve with ${editCount} edit${editCount === 1 ? '' : 's'} & continue` : 'Approve pool & continue'}
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-400"
          onClick={onCancel}
          title="Cancel this run"
        >
          Cancel run
        </button>
      </div>
    </div>
  );
}

function ChevronToggle({ expanded, size = 'md' }) {
  const cls = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <svg
      className={`${cls} text-gray-500 transition-transform duration-200 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ─── Main Page ───

export default function TopicalMapPage() {
  const { token } = useAdmin();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [maps, setMaps] = useState([]);
  const [mapId, setMapId] = useState(searchParams.get('map_id') || '');
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  // v2 staged-pipeline run state
  const [runOpen, setRunOpen] = useState(false);
  const [run, setRun] = useState(null); // { id, status, current_stage, map_id }
  const [stages, setStages] = useState([]);
  const [stageResults, setStageResults] = useState({}); // stageKey → { summary, ms }
  const [checkpoint, setCheckpoint] = useState(null); // checkpoint_data from GET run
  const [runError, setRunError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [writingId, setWritingId] = useState(null);
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedKeyword, setSeedKeyword] = useState('');
  const [seedError, setSeedError] = useState('');

  // Sheet import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState('upload'); // upload | url
  const [importName, setImportName] = useState('');
  const [importSheetUrl, setImportSheetUrl] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importReplace, setImportReplace] = useState(false);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importDetailErrors, setImportDetailErrors] = useState(null);
  const [enriching, setEnriching] = useState(false);
  const [readinessRunning, setReadinessRunning] = useState(false);

  // Phase 4 — free-form topic / content creation modal state
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContentType, setNewContentType] = useState('blog_post');
  const [newTopicType, setNewTopicType] = useState('supporting');
  const [newKeyword, setNewKeyword] = useState('');
  const [newAttachToMap, setNewAttachToMap] = useState(false);
  const [newError, setNewError] = useState('');
  const [newCreating, setNewCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  const loadMaps = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/admin/topical-map/maps', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) { const data = await res.json(); setMaps(data.maps || []); }
  }, [token]);

  const loadTopicsForMap = useCallback(async (id) => {
    if (!token || !id) { setTopics([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/topical-map/topics?map_id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const data = await res.json(); setTopics(data.topics || []); }
    } finally { setLoading(false); }
  }, [token]);

  const loadTopics = useCallback(() => loadTopicsForMap(mapId), [loadTopicsForMap, mapId]);

  useEffect(() => { loadMaps(); }, [loadMaps]);
  useEffect(() => { loadTopics(); }, [loadTopics]);

  const byParent = useMemo(() => groupChildrenByParent(topics), [topics]);
  const roots = byParent.get('root') || [];
  const descendantCountById = useMemo(() => {
    const helper = buildDescendantCountMap(byParent);
    const m = new Map();
    for (const t of topics) m.set(t.id, helper.count(t.id));
    return m;
  }, [byParent, topics]);

  // Search + status filter
  const filteredRoots = useMemo(() => {
    let result = roots;

    // Text search — keep root if it or any descendant matches
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchesTopic = (t) =>
        t.title?.toLowerCase().includes(q) ||
        t.target_keyword?.toLowerCase().includes(q) ||
        t.content_type?.toLowerCase().includes(q);
      const matchesTree = (id) => {
        const children = byParent.get(id) || [];
        for (const ch of children) {
          if (matchesTopic(ch) || matchesTree(ch.id)) return true;
        }
        return false;
      };
      result = result.filter((r) => matchesTopic(r) || matchesTree(r.id));
    }

    // Status filter — keep root if it or any descendant has that status
    if (statusFilter) {
      result = result.filter(r => {
        if (r.content_status === statusFilter) return true;
        const desc = collectDescendants(r.id, byParent);
        return desc.some(d => d.content_status === statusFilter);
      });
    }

    return result;
  }, [roots, byParent, search, statusFilter]);

  // Stats
  const statusCounts = useMemo(() => {
    const c = { planned: 0, in_progress: 0, draft: 0, review: 0, published: 0 };
    for (const t of topics) { if (c[t.content_status] !== undefined) c[t.content_status] += 1; }
    return c;
  }, [topics]);

  const contentTypeCounts = useMemo(() => {
    const c = {};
    for (const t of topics) {
      const ct = t.content_type || 'unknown';
      c[ct] = (c[ct] || 0) + 1;
    }
    return c;
  }, [topics]);

  const publishedPercent = topics.length > 0 ? Math.round((statusCounts.published / topics.length) * 100) : 0;
  const withContent = topics.filter(t => t.content_id).length;

  const showToast = (msg, type = 'error') => {
    setToast({ msg, type });
    if (type !== 'error') setTimeout(() => setToast(null), 3000);
  };

  const handleMapChange = (id) => {
    setMapId(id);
    setEditingId(null);
    setStatusFilter('');
    setSearch('');
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('map_id', id); else params.delete('map_id');
    router.replace(`/admin/topical-map?${params.toString()}`);
  };

  // \u2500\u2500 v2 staged-pipeline run driver \u2500\u2500
  // create run \u2192 loop /advance \u2192 pause at checkpoints \u2192 /approve \u2192 continue.
  // Failed stages are resumable (advance retries the current stage).

  const selectGeneratedMap = useCallback((newId) => {
    setMapId(newId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('map_id', newId);
    router.replace(`/admin/topical-map?${params.toString()}`);
    loadMaps();
    loadTopicsForMap(newId);
  }, [searchParams, router, loadMaps, loadTopicsForMap]);

  const fetchCheckpoint = async (runId) => {
    const res = await fetch(`/api/admin/topical-map/runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    setCheckpoint(data.run?.checkpoint_data || null);
  };

  const driveRun = async (runId) => {
    setGenerating(true);
    setRunError(null);
    try {
      // Hard bound: more iterations than stages can ever need.
      for (let i = 0; i < 15; i++) {
        const res = await fetch(`/api/admin/topical-map/runs/${runId}/advance`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (Array.isArray(data.stages) && data.stages.length) setStages(data.stages);
        setStageResults((prev) => ({
          ...prev,
          [data.executed_stage]: { summary: data.summary, ms: data.ms, ok: true },
        }));
        setRun((prev) => ({
          ...(prev || {}),
          id: runId,
          status: data.status,
          current_stage: data.current_stage,
          map_id: data.map_id || prev?.map_id || null,
        }));
        if (data.status === 'awaiting_approval') {
          await fetchCheckpoint(runId);
          return;
        }
        if (data.done) {
          if (data.map_id) selectGeneratedMap(data.map_id);
          return;
        }
      }
      throw new Error('Run did not complete within the expected number of stages');
    } catch (e) {
      setRunError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const startRun = async (topicKeyword) => {
    if (!token) return;
    const keyword = String(topicKeyword || '').trim();
    if (!keyword) { setSeedError('Topic / keyword is required'); return; }

    setSeedOpen(false);
    setSeedError('');
    setRunOpen(true);
    setRun(null);
    setStageResults({});
    setCheckpoint(null);
    setRunError(null);
    setGenerating(true);

    try {
      const res = await fetch('/api/admin/topical-map/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ seed_keyword: keyword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStages(data.stages || []);
      setRun(data.run);
      await driveRun(data.run.id);
    } catch (e) {
      setRunError(e.message);
      setGenerating(false);
    }
  };

  const approveCheckpoint = async (edits = {}) => {
    if (!run?.id) return;
    setCheckpoint(null);
    try {
      const res = await fetch(`/api/admin/topical-map/runs/${run.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(edits),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Approve failed');
      }
      await driveRun(run.id);
    } catch (e) {
      setRunError(e.message);
    }
  };

  const resumeRun = async () => {
    if (run?.id) {
      setRunError(null);
      await driveRun(run.id);
    }
  };

  const defaultImportName = () => {
    const d = new Date().toISOString().slice(0, 10);
    return `Imported: CryptoKiller Topical Map (${d})`;
  };

  const openImportModal = () => {
    setImportError('');
    setImportDetailErrors(null);
    setImportResult(null);
    setImportFile(null);
    setImportSheetUrl('');
    setImportTab('upload');
    setImportName(defaultImportName());
    setImportReplace(Boolean(mapId));
    setImportOpen(true);
  };

  const runImport = async () => {
    if (!token) return;
    setImportError('');
    setImportDetailErrors(null);
    setImportResult(null);
    const replaceId = importReplace && mapId ? mapId : null;
    if (replaceId) {
      const ok = window.confirm(
        'Replace the currently selected map? The old map is deleted only after the new import succeeds. Slugs from the old map are freed so the new tree can use clean URLs.',
      );
      if (!ok) return;
    }
    setImporting(true);
    try {
      let res;
      if (importTab === 'url') {
        const url = importSheetUrl.trim();
        if (!url) throw new Error('Paste a Google Sheet URL');
        res = await fetch('/api/admin/topical-map/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            sheet_url: url,
            map_name: importName.trim() || undefined,
            ...(replaceId ? { replace_map_id: replaceId } : {}),
          }),
        });
      } else {
        if (!importFile) throw new Error('Choose a .xlsx or .csv file');
        const fd = new FormData();
        fd.append('file', importFile);
        if (importName.trim()) fd.append('map_name', importName.trim());
        if (replaceId) fd.append('replace_map_id', replaceId);
        res = await fetch('/api/admin/topical-map/import', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 422 && (data.validation_errors || data.coverage_errors)) {
          setImportDetailErrors({
            validation_errors: data.validation_errors || null,
            coverage_errors: data.coverage_errors || null,
            missing_titles: data.missing_titles || null,
          });
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setImportResult(data);
      if (data.map_id) selectGeneratedMap(data.map_id);
      const c = data.counts || {};
      const readinessNote = data.readiness?.started ? ' - evidence readiness running in background' : '';
      showToast(
        `Imported ${c.pillars || 0} pillars, ${c.clusters || 0} clusters, ${c.supporting || 0} pages${readinessNote}`,
        'success',
      );
    } catch (e) {
      setImportError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const runEnrichMetrics = async () => {
    const id = importResult?.map_id || mapId;
    if (!token || !id) return;
    setEnriching(true);
    setImportError('');
    try {
      const res = await fetch(`/api/admin/topical-map/maps/${encodeURIComponent(id)}/enrich-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast(`Enriched ${data.updated || 0} topics (${data.failed || 0} failed)`, 'success');
      loadTopicsForMap(id);
    } catch (e) {
      setImportError(e.message);
      showToast(e.message);
    } finally {
      setEnriching(false);
    }
  };

  const runReadiness = async () => {
    if (!token || !mapId) return;
    setReadinessRunning(true);
    try {
      const res = await fetch(`/api/admin/topical-map/${encodeURIComponent(mapId)}/readiness`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast(
        `Readiness: ${data.sullivan_ok || 0} ok, ${data.needs_evidence || 0} need evidence, ${data.skipped || 0} skipped`,
        'success',
      );
      await loadMaps();
    } catch (e) {
      showToast(`Readiness failed: ${e.message}`);
    } finally {
      setReadinessRunning(false);
    }
  };

  const cancelRun = async () => {
    if (!run?.id) return;
    if (!window.confirm('Cancel this run? It will stop here and cannot be resumed.')) return;
    try {
      await fetch(`/api/admin/topical-map/runs/${run.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* best-effort */ }
    setCheckpoint(null);
    setRunOpen(false);
    setRun(null);
    setRunError(null);
  };

  // Phase 4 — create a free-form topic + draft content via the dual-mode
  // /api/admin/content/create endpoint, then navigate to the editor.
  const createFreeForm = async () => {
    if (!token) return;
    const title = newTitle.trim();
    if (!title) { setNewError('Title is required'); return; }
    if (!newContentType) { setNewError('Content type is required'); return; }
    setNewCreating(true);
    setNewError('');
    try {
      const payload = {
        title,
        content_type: newContentType,
        topic_type: newTopicType,
        target_keyword: newKeyword.trim() || title,
      };
      // Optional: attach to currently selected map. Default off — user
      // chose "free-form, default to standalone" in scoping.
      if (newAttachToMap && mapId) payload.map_id = mapId;

      const res = await fetch('/api/admin/content/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to create content');
      }
      const data = await res.json();
      // Reset modal + navigate
      setNewOpen(false);
      setNewTitle('');
      setNewKeyword('');
      setNewContentType('blog_post');
      setNewTopicType('supporting');
      setNewAttachToMap(false);
      router.push(`/admin/content/${data.id}`);
    } catch (e) {
      setNewError(e.message);
    } finally {
      setNewCreating(false);
    }
  };

  const writeArticle = async (topic) => {
    if (!token || !topic?.id) return;
    if (!isWritableContentTopic(topic)) {
      showToast(
        topic.topic_type === 'cluster'
          ? 'Clusters are folders — open a supporting page to Write'
          : 'This hub is structural (not a sheet page) — Write a supporting topic instead'
      );
      return;
    }
    setWritingId(topic.id);
    try {
      const res = await fetch('/api/admin/content/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ topic_id: topic.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to create content');
      }
      const data = await res.json();
      router.push(`/admin/content/${data.id}`);
    } catch (e) { showToast(e.message); } finally { setWritingId(null); }
  };

  const deleteTopic = async (topic, descendants = 0) => {
    if (!token || !topic?.id) return;
    const hasChildren = descendants > 0;
    const shouldDelete = window.confirm(
      hasChildren
        ? `"${topic.title}" has ${descendants} subtopic(s).\n\nOK = delete topic + all subtopics\nCancel = abort`
        : `Delete "${topic.title}"?`
    );
    if (!shouldDelete) return;
    try {
      const res = await fetch(`/api/admin/topical-map/topics/${topic.id}?cascade=${hasChildren ? 'true' : 'false'}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Delete failed');
      }
      if (editingId === topic.id) setEditingId(null);
      await loadTopics();
      await loadMaps();
    } catch (e) { showToast(`Delete failed: ${e.message}`); }
  };

  if (!token) return <div className="text-gray-500 text-sm">Loading\u2026</div>;

  const selectedMap = maps.find(m => m.id === mapId);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Topical Map</h1>
          <p className="text-gray-500 text-sm mt-1">
            Pillars, clusters & supporting topics for topical authority.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setNewError(''); setNewOpen(true); }}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition"
          >
            + New Content
          </button>
          <button
            type="button"
            onClick={openImportModal}
            disabled={generating || importing}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 transition disabled:opacity-50"
          >
            Import Map
          </button>
          <button
            type="button"
            onClick={() => { setSeedError(''); setSeedOpen(true); }}
            disabled={generating}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition disabled:opacity-50"
          >
            {generating ? 'Generating\u2026' : '+ New Map'}
          </button>
        </div>
      </div>

      {/* ── Map Selector ── */}
      <div className="flex items-center gap-3">
        <select
          className="search-input text-sm min-w-[240px]"
          value={mapId}
          onChange={(e) => handleMapChange(e.target.value)}
        >
          <option value="">Select a map\u2026</option>
          {maps.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {selectedMap && (
          <span className="text-xs text-gray-600">{topics.length} topics</span>
        )}
        {selectedMap && (
          <button
            type="button"
            onClick={runReadiness}
            disabled={readinessRunning}
            title="Re-run Sullivan evidence readiness for all supporting topics"
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-600/40 text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/60 bg-emerald-900/10 transition disabled:opacity-50"
          >
            {readinessRunning ? 'Running...' : 'Re-run readiness'}
          </button>
        )}
        {selectedMap?.stats?.readiness?.ran_at && (
          <span className="text-[10px] text-gray-600" title={`Last readiness: ${selectedMap.stats.readiness.ran_at}`}>
            {selectedMap.stats.readiness.sullivan_ok || 0} ok / {selectedMap.stats.readiness.needs_evidence || 0} need evidence
          </span>
        )}
      </div>

      {/* ── Stats Dashboard ── */}
      {mapId && topics.length > 0 && (
        <div className="grid grid-cols-12 gap-3">
          {/* Progress ring + key numbers */}
          <div className="col-span-12 sm:col-span-4 lg:col-span-3 rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <ProgressRing percent={publishedPercent} size={64} stroke={5} color="#22c55e" />
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-green-300">
                {publishedPercent}%
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Progress</p>
              <p className="text-sm text-gray-300">
                <span className="text-white font-semibold">{statusCounts.published}</span> / {topics.length} published
              </p>
              <p className="text-xs text-gray-500">{withContent} with content</p>
            </div>
          </div>

          {/* Status breakdown */}
          <div className="col-span-12 sm:col-span-8 lg:col-span-5 rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2.5">By Status</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(statusCounts).map(([status, count]) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition border ${
                    statusFilter === status
                      ? 'border-white/20 bg-white/10 text-white'
                      : 'border-gray-800/60 hover:border-gray-600 text-gray-400 hover:text-white'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${statusDot[status]}`} />
                  <span className="capitalize">{status.replace(/_/g, ' ')}</span>
                  <span className="font-semibold text-gray-300 tabular-nums">{count}</span>
                </button>
              ))}
              {statusFilter && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('')}
                  className="text-[11px] text-gray-500 hover:text-red-400 px-2 py-1.5 transition"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Content type breakdown */}
          <div className="col-span-12 lg:col-span-4 rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2.5">By Type</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(contentTypeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <span key={type} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border ${typeColors[type] || typeColors.educational}`}>
                    {type.replace(/_/g, ' ')}
                    <span className="font-semibold">{count}</span>
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Publication plan (Step 22) ── */}
      {mapId && topics.length > 0 && <PublicationPlanPanel topics={topics} />}

      {/* ── Search ── */}
      {mapId && topics.length > 0 && (
        <div className="relative">
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search topics, keywords, types\u2026"
            className="search-input w-full pl-9 text-sm"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Loading / Empty States ── */}
      {loading && <div className="text-gray-500 text-sm">Loading topics\u2026</div>}

      {!loading && mapId && roots.length === 0 && (
        <div className="text-gray-500 text-sm rounded-xl border border-gray-800/60 bg-gray-900/30 p-6 text-center">
          <p className="text-lg mb-1">{'\ud83c\udf31'}</p>
          <p className="text-white font-medium mb-1">No topics yet</p>
          <p>Click "+ New Map" above to create a topical map from a seed keyword.</p>
        </div>
      )}

      {!loading && !mapId && maps.length > 0 && (
        <div className="text-gray-500 text-sm rounded-xl border border-gray-800/60 bg-gray-900/30 p-6 text-center">
          <p className="text-lg mb-1">{'\ud83d\udccd'}</p>
          <p className="text-white font-medium mb-1">Select a map</p>
          <p>Choose an existing map from the dropdown, or generate a new one.</p>
        </div>
      )}

      {!loading && mapId && filteredRoots.length === 0 && roots.length > 0 && (
        <div className="text-gray-500 text-sm rounded-xl border border-gray-800/60 bg-gray-900/30 p-4">
          No topics match your filters.{' '}
          <button type="button" onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-red-400 hover:text-red-300 underline">
            Clear all
          </button>
        </div>
      )}

      {/* ── Topic Tree ── */}
      {!loading && mapId && filteredRoots.length > 0 && (
        <div className="space-y-4">
          {filteredRoots.map(r => (
            <TopicRow
              key={r.id} topic={r} depth={0}
              byParent={byParent} token={token} onPatch={loadTopics} onDelete={deleteTopic}
              onWriteArticle={writeArticle} writingId={writingId} editingId={editingId}
              setEditingId={setEditingId} descendantCountById={descendantCountById}
              statusFilter={statusFilter} readinessTopics={selectedMap?.stats?.readiness?.topics}
            />
          ))}
        </div>
      )}

      {/* ── Modals ── */}

      {/* v2 staged pipeline run panel */}
      {runOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl max-h-[85vh] overflow-y-auto">
            <h3 className="text-white font-semibold text-lg">
              {runError ? 'Pipeline stage failed' : run?.status === 'completed' ? 'Map ready' : checkpoint ? 'Checkpoint — your review needed' : 'Building topical map (v2 pipeline)'}
            </h3>
            {run?.seed_keyword && <p className="text-gray-500 text-sm mt-0.5">Seed: {run.seed_keyword}</p>}

            {/* Stage timeline */}
            <div className="mt-4 space-y-1.5">
              {stages.map((s) => {
                const result = stageResults[s.key];
                const isCurrent = run?.current_stage === s.key && run?.status !== 'completed';
                const failed = isCurrent && !!runError;
                return (
                  <div key={s.key} className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border text-sm ${
                    failed ? 'border-red-600/40 bg-red-900/20'
                      : result ? 'border-green-700/30 bg-green-900/10'
                      : isCurrent ? 'border-blue-600/40 bg-blue-900/10'
                      : 'border-gray-800/50'
                  }`}>
                    <span className="mt-0.5 flex-shrink-0">
                      {failed ? <span className="text-red-400">✕</span>
                        : result ? <span className="text-green-400">✓</span>
                        : isCurrent && generating ? <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        : <span className="text-gray-600">○</span>}
                    </span>
                    <div className="min-w-0">
                      <p className={result || isCurrent ? 'text-gray-200' : 'text-gray-500'}>{s.label}</p>
                      {result?.summary && <p className="text-[11px] text-gray-500 mt-0.5">{result.summary}{result.ms ? ` · ${(result.ms / 1000).toFixed(1)}s` : ''}</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Checkpoint A: editable pool + cluster review */}
            {checkpoint?.checkpoint === 'pool_review' && (
              <PoolReviewCard checkpoint={checkpoint} onApprove={approveCheckpoint} onCancel={cancelRun} />
            )}

            {/* Checkpoint: cannibalization review (Phase 5, before the map builds) */}
            {checkpoint?.checkpoint === 'cannibalization_review' && (
              <div className="mt-4 p-3 rounded-lg border border-amber-600/30 bg-amber-900/10">
                <p className="text-amber-300 text-sm font-medium">Cannibalization review</p>
                {checkpoint.guard_kept_all ? (
                  <p className="text-xs text-amber-300/90 mt-1">
                    Every cluster was flagged — nothing was dropped (guard kept them all). Review before building.
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">
                    {checkpoint.kept} clusters kept · {checkpoint.dropped} dropped · {checkpoint.pruned.length} pruned.
                    These are removed before the map is built. Approve to build, or cancel to adjust.
                  </p>
                )}
                {checkpoint.dropped_detail.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                    <p className="text-[11px] text-gray-500 uppercase tracking-wide">Dropped clusters</p>
                    {checkpoint.dropped_detail.slice(0, 40).map((d, i) => (
                      <p key={i} className="text-[11px] text-gray-400">
                        <span className="text-gray-200 font-mono">{d.cluster_key}</span> — {String(d.reason || '').replace(/_/g, ' ')}
                        {Array.isArray(d.removed_keywords) && d.removed_keywords.length > 0 ? ` (${d.removed_keywords.join(', ')})` : ''}
                      </p>
                    ))}
                  </div>
                )}
                {checkpoint.pruned.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                    <p className="text-[11px] text-gray-500 uppercase tracking-wide">Pruned keywords (cluster kept, colliding keyword removed)</p>
                    {checkpoint.pruned.slice(0, 40).map((p, i) => (
                      <p key={i} className="text-[11px] text-gray-400">
                        <span className="text-gray-200 font-mono">{p.cluster_key}</span> — removed {(p.removed_keywords || []).join(', ')}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button type="button" className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm text-white" onClick={() => approveCheckpoint()}>
                    Approve & build map
                  </button>
                  <button type="button" className="px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white text-sm" onClick={cancelRun}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Checkpoint B: QA report review */}
            {checkpoint?.checkpoint === 'qa_review' && (
              <div className="mt-4 p-3 rounded-lg border border-amber-600/30 bg-amber-900/10">
                <p className="text-amber-300 text-sm font-medium">QA report</p>
                <p className="text-xs text-gray-400 mt-1">
                  {checkpoint.qa_report?.clean_nodes}/{checkpoint.qa_report?.total_nodes} nodes clean.
                </p>
                {checkpoint.qa_report?.counts && Object.keys(checkpoint.qa_report.counts).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {Object.entries(checkpoint.qa_report.counts).map(([type, count]) => (
                      <span key={type} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        {type.replace(/_/g, ' ')}: {count}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                  {(checkpoint.qa_report?.flags || []).slice(0, 30).map((f, i) => (
                    <p key={i} className="text-[11px] text-gray-400"><span className="text-gray-200">{f.title}</span> — {f.detail}</p>
                  ))}
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Flags are saved onto each topic (qa_flags) — you can resolve them after the map is created.</p>
                <button type="button" className="mt-3 w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm text-white" onClick={() => approveCheckpoint()}>
                  Approve & save map
                </button>
              </div>
            )}

            {runError && (
              <div className="mt-4 p-3 rounded-lg border border-red-600/30 bg-red-900/10">
                <p className="text-red-300 text-sm">{runError}</p>
                {run?.id && (
                  <button type="button" className="mt-2 w-full py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm text-white" onClick={resumeRun}>
                    Resume from failed stage
                  </button>
                )}
              </div>
            )}

            {!generating && !checkpoint && (
              <button type="button" className="mt-4 w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white" onClick={() => { setRunOpen(false); setRunError(null); }}>
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {/* Seed keyword modal */}
      {/* Phase 4 — free-form Create Content modal */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <h3 className="text-white font-semibold text-lg">Create new content</h3>
            <p className="text-gray-500 text-sm mt-1">Write a blog post or page on any topic — no topical map required.</p>

            <label className="block text-xs text-gray-400 mt-4 mb-1">Title</label>
            <input
              type="text" autoFocus value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. How to Spot a Crypto Recovery Scam in 2026"
              className="search-input w-full"
            />

            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Content type</label>
                <select
                  className="search-input w-full text-sm"
                  value={newContentType}
                  onChange={(e) => setNewContentType(e.target.value)}
                >
                  <optgroup label="Blog">
                    <option value="blog_post">Blog post</option>
                    <option value="listicle">Listicle</option>
                    <option value="comparison">Comparison</option>
                    <option value="guide">Guide</option>
                    <option value="educational">Educational</option>
                    <option value="prevention">Prevention</option>
                    <option value="recovery_guide">Recovery guide</option>
                    <option value="glossary">Glossary</option>
                  </optgroup>
                  <optgroup label="Page">
                    <option value="informational_page">Informational page</option>
                    <option value="landing_page">Landing page</option>
                    <option value="pillar_page">Pillar page</option>
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Topic role</label>
                <select
                  className="search-input w-full text-sm"
                  value={newTopicType}
                  onChange={(e) => setNewTopicType(e.target.value)}
                >
                  <option value="supporting">Supporting</option>
                  <option value="cluster">Cluster</option>
                  <option value="pillar">Pillar</option>
                </select>
              </div>
            </div>

            <label className="block text-xs text-gray-400 mt-3 mb-1">Target keyword (optional, defaults to title)</label>
            <input
              type="text" value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="e.g. crypto recovery scam"
              className="search-input w-full"
            />

            {mapId && (
              <label className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                <input
                  type="checkbox" checked={newAttachToMap}
                  onChange={(e) => setNewAttachToMap(e.target.checked)}
                />
                Attach to currently selected map
              </label>
            )}

            {newError && <p className="text-red-400 text-sm mt-3">{newError}</p>}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={newCreating}
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm text-white disabled:opacity-50"
                onClick={createFreeForm}
              >
                {newCreating ? 'Creating\u2026' : 'Create draft'}
              </button>
              <button
                type="button"
                className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white"
                onClick={() => { setNewOpen(false); setNewError(''); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {seedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-white font-semibold text-lg">Seed Topic</h3>
            <p className="text-gray-500 text-sm mt-1">Enter the topic/keyword to build this topical map around.</p>
            <input
              type="text" autoFocus value={seedKeyword}
              onChange={(e) => setSeedKeyword(e.target.value)}
              placeholder="e.g. pig butchering scam"
              className="search-input w-full mt-4"
              onKeyDown={(e) => { if (e.key === 'Enter') startRun(seedKeyword); }}
            />
            {seedError && <p className="text-red-400 text-sm mt-2">{seedError}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm text-white" onClick={() => startRun(seedKeyword)}>Generate</button>
              <button type="button" className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white" onClick={() => { setSeedOpen(false); setSeedError(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <h3 className="text-white font-semibold text-lg">Import Map</h3>
            <p className="text-gray-500 text-sm mt-1">
              Create a new topical map from a Koray-style page-map sheet (.xlsx / .csv or Google Sheet URL).
            </p>

            <label className="block text-xs text-gray-400 mt-4 mb-1">Map name</label>
            <input
              type="text"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              className="search-input w-full"
            />

            <div className="mt-4 flex gap-1 p-1 rounded-lg bg-gray-950 border border-gray-800">
              <button
                type="button"
                onClick={() => { setImportTab('upload'); setImportError(''); }}
                className={`flex-1 py-1.5 rounded-md text-sm ${importTab === 'upload' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Upload file
              </button>
              <button
                type="button"
                onClick={() => { setImportTab('url'); setImportError(''); }}
                className={`flex-1 py-1.5 rounded-md text-sm ${importTab === 'url' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Google Sheet URL
              </button>
            </div>

            {importTab === 'upload' ? (
              <div className="mt-4">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-gray-800 file:text-gray-200"
                />
                {importFile && <p className="text-xs text-gray-500 mt-2">{importFile.name}</p>}
              </div>
            ) : (
              <div className="mt-4">
                <input
                  type="url"
                  value={importSheetUrl}
                  onChange={(e) => setImportSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="search-input w-full"
                />
              </div>
            )}

            {mapId && (
              <label className="mt-4 flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={importReplace}
                  onChange={(e) => setImportReplace(e.target.checked)}
                />
                <span>
                  Replace current map after a successful import
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Frees the old map&apos;s slugs first, then deletes it only when the new tree persists. Leave unchecked to stack another map (slugs get -2/-3 suffixes).
                  </span>
                </span>
              </label>
            )}

            {importResult && (
              <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 p-3 text-sm text-gray-300">
                <p>
                  Map created:{' '}
                  <span className="text-white font-medium">
                    {importResult.counts?.pillars ?? 0} pillars · {importResult.counts?.clusters ?? 0} clusters · {importResult.counts?.supporting ?? 0} pages
                  </span>
                </p>
                {Array.isArray(importResult.warnings) && importResult.warnings.length > 0 && (
                  <ul className="mt-2 text-xs text-amber-300/90 list-disc pl-4 space-y-0.5 max-h-24 overflow-y-auto">
                    {importResult.warnings.slice(0, 8).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {importError && <p className="text-red-400 text-sm mt-3">{importError}</p>}
            <ImportErrorList detailErrors={importDetailErrors} />

            {importResult?.readiness?.started && (
              <p className="text-xs text-emerald-400/80 mt-2">
                Evidence readiness check started in the background. Reload the map or click Re-run readiness to refresh per-topic badges.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {!importResult ? (
                <>
                  <button
                    type="button"
                    disabled={importing}
                    className="flex-1 min-w-[8rem] py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm text-white disabled:opacity-50"
                    onClick={runImport}
                  >
                    {importing ? 'Importing\u2026' : 'Import'}
                  </button>
                  <button
                    type="button"
                    className="flex-1 min-w-[8rem] py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white"
                    onClick={() => { setImportOpen(false); setImportError(''); setImportDetailErrors(null); setImportResult(null); }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {importResult.enrich_available !== false && (
                    <button
                      type="button"
                      disabled={enriching}
                      className="flex-1 min-w-[8rem] py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-sm text-white disabled:opacity-50"
                      onClick={runEnrichMetrics}
                    >
                      {enriching ? 'Enriching\u2026' : 'Enrich metrics'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="flex-1 min-w-[8rem] py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white"
                    onClick={() => { setImportOpen(false); setImportError(''); setImportDetailErrors(null); setImportResult(null); }}
                  >
                    Done
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-40 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm ${
          toast.type === 'error' ? 'bg-red-900/90 border-red-600/40 text-red-200' : 'bg-green-900/90 border-green-600/40 text-green-200'
        }`}>
          <span>{toast.msg}</span>
          <button type="button" onClick={() => setToast(null)} className="text-current opacity-60 hover:opacity-100">{'\u2715'}</button>
        </div>
      )}
    </div>
  );
}
