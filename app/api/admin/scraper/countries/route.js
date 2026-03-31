import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';

async function supaFetch(path) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
  };
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

async function fetchAllBrands(pageSize = 1000) {
  const allRows = [];
  let offset = 0;
  while (true) {
    const data = await supaFetch(
      `/scam_brands?select=id,name,slug,geo_list,celebrity_list,language_list,velocity_7d,velocity_trend,scam_score,total_creatives,total_geos,total_celebrities,first_seen_at,last_seen_at,created_at&limit=${pageSize}&offset=${offset}`
    );
    if (!Array.isArray(data) || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return allRows;
}

const COUNTRY_NAMES = {
  AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AD:'Andorra',AO:'Angola',AR:'Argentina',AM:'Armenia',AU:'Australia',
  AT:'Austria',AZ:'Azerbaijan',BH:'Bahrain',BD:'Bangladesh',BY:'Belarus',BE:'Belgium',BZ:'Belize',BJ:'Benin',
  BT:'Bhutan',BO:'Bolivia',BA:'Bosnia & Herzegovina',BW:'Botswana',BR:'Brazil',BN:'Brunei',BG:'Bulgaria',
  BF:'Burkina Faso',BI:'Burundi',KH:'Cambodia',CM:'Cameroon',CA:'Canada',CL:'Chile',CN:'China',CO:'Colombia',
  CR:'Costa Rica',HR:'Croatia',CU:'Cuba',CY:'Cyprus',CZ:'Czechia',DK:'Denmark',DO:'Dominican Republic',
  EC:'Ecuador',EG:'Egypt',SV:'El Salvador',EE:'Estonia',ET:'Ethiopia',FI:'Finland',FR:'France',GE:'Georgia',
  DE:'Germany',GH:'Ghana',GR:'Greece',GT:'Guatemala',HN:'Honduras',HK:'Hong Kong',HU:'Hungary',IS:'Iceland',
  IN:'India',ID:'Indonesia',IR:'Iran',IQ:'Iraq',IE:'Ireland',IL:'Israel',IT:'Italy',JM:'Jamaica',JP:'Japan',
  JO:'Jordan',KZ:'Kazakhstan',KE:'Kenya',KW:'Kuwait',KG:'Kyrgyzstan',LA:'Laos',LV:'Latvia',LB:'Lebanon',
  LY:'Libya',LT:'Lithuania',LU:'Luxembourg',MO:'Macau',MG:'Madagascar',MY:'Malaysia',MV:'Maldives',ML:'Mali',
  MT:'Malta',MX:'Mexico',MD:'Moldova',MN:'Mongolia',ME:'Montenegro',MA:'Morocco',MZ:'Mozambique',MM:'Myanmar',
  NA:'Namibia',NP:'Nepal',NL:'Netherlands',NZ:'New Zealand',NI:'Nicaragua',NG:'Nigeria',MK:'North Macedonia',
  NO:'Norway',OM:'Oman',PK:'Pakistan',PA:'Panama',PY:'Paraguay',PE:'Peru',PH:'Philippines',PL:'Poland',
  PT:'Portugal',QA:'Qatar',RO:'Romania',RU:'Russia',RW:'Rwanda',SA:'Saudi Arabia',SN:'Senegal',RS:'Serbia',
  SG:'Singapore',SK:'Slovakia',SI:'Slovenia',ZA:'South Africa',KR:'South Korea',ES:'Spain',LK:'Sri Lanka',
  SD:'Sudan',SE:'Sweden',CH:'Switzerland',TW:'Taiwan',TZ:'Tanzania',TH:'Thailand',TN:'Tunisia',TR:'Turkey',
  UG:'Uganda',UA:'Ukraine',AE:'UAE',GB:'United Kingdom',US:'United States',UY:'Uruguay',UZ:'Uzbekistan',
  VE:'Venezuela',VN:'Vietnam',YE:'Yemen',ZM:'Zambia',ZW:'Zimbabwe',
};

function getCountryName(code) {
  return COUNTRY_NAMES[code] || code;
}

function getCountryFlag(code) {
  if (!code || code.length !== 2) return '';
  const base = 0x1F1E6;
  return String.fromCodePoint(base + code.charCodeAt(0) - 65, base + code.charCodeAt(1) - 65);
}

export async function GET(request) {
  try {
    verifyAdmin(request);
    const brands = await fetchAllBrands();
    const countryMap = {};

    for (const brand of brands) {
      if (!brand.geo_list || brand.geo_list.length === 0) continue;
      for (const code of brand.geo_list) {
        if (!countryMap[code]) {
          countryMap[code] = {
            code,
            name: getCountryName(code),
            flag: getCountryFlag(code),
            total_funnels: 0,
            active_funnels: 0,
            total_velocity: 0,
            avg_scam_score: 0,
            score_sum: 0,
            score_count: 0,
            total_celeb_mentions: 0,
            celeb_set: new Set(),
            language_set: new Set(),
            earliest_campaign: null,
            latest_activity: null,
            top_funnels: [],
          };
        }
        const c = countryMap[code];
        c.total_funnels++;
        if (brand.velocity_7d > 0) {
          c.active_funnels++;
          c.total_velocity += brand.velocity_7d;
        }
        if (brand.scam_score && brand.scam_score > 0) {
          c.score_sum += brand.scam_score;
          c.score_count++;
        }
        c.total_celeb_mentions += brand.total_celebrities || 0;
        if (brand.celebrity_list) {
          for (const celeb of brand.celebrity_list) {
            const trimmed = celeb.trim();
            if (trimmed) c.celeb_set.add(trimmed);
          }
        }
        if (brand.language_list) {
          for (const lang of brand.language_list) {
            if (lang) c.language_set.add(lang);
          }
        }
        if (brand.first_seen_at) {
          if (!c.earliest_campaign || new Date(brand.first_seen_at) < new Date(c.earliest_campaign)) {
            c.earliest_campaign = brand.first_seen_at;
          }
        }
        if (brand.last_seen_at) {
          if (!c.latest_activity || new Date(brand.last_seen_at) > new Date(c.latest_activity)) {
            c.latest_activity = brand.last_seen_at;
          }
        }
        c.top_funnels.push({
          id: brand.id,
          name: brand.name,
          velocity_7d: brand.velocity_7d || 0,
          scam_score: brand.scam_score || 0,
          total_creatives: brand.total_creatives || 0,
          total_celebrities: brand.total_celebrities || 0,
        });
      }
    }

    const countries = Object.values(countryMap).map(c => {
      c.avg_scam_score = c.score_count > 0 ? Math.round((c.score_sum / c.score_count) * 10) / 10 : 0;
      c.unique_celebrities = c.celeb_set.size;
      c.languages = Array.from(c.language_set);
      c.campaign_duration_days = c.earliest_campaign && c.latest_activity
        ? Math.max(1, Math.round((new Date(c.latest_activity) - new Date(c.earliest_campaign)) / 86400000))
        : 0;
      c.top_funnels = c.top_funnels
        .sort((a, b) => b.velocity_7d - a.velocity_7d)
        .slice(0, 5);
      delete c.celeb_set;
      delete c.language_set;
      delete c.score_sum;
      delete c.score_count;
      return c;
    });
    countries.sort((a, b) => b.total_funnels - a.total_funnels);

    const topByCelebs = [...countries].sort((a, b) => b.unique_celebrities - a.unique_celebrities).slice(0, 10);
    const topByVelocity = [...countries].sort((a, b) => b.total_velocity - a.total_velocity).slice(0, 10);
    const topByThreat = [...countries].sort((a, b) => b.avg_scam_score - a.avg_scam_score).slice(0, 10);

    return Response.json({
      total_countries: countries.length,
      countries,
      rankings: {
        by_celebrities: topByCelebs.map(c => ({ code: c.code, name: c.name, flag: c.flag, value: c.unique_celebrities })),
        by_velocity: topByVelocity.map(c => ({ code: c.code, name: c.name, flag: c.flag, value: c.total_velocity })),
        by_threat: topByThreat.map(c => ({ code: c.code, name: c.name, flag: c.flag, value: c.avg_scam_score })),
      },
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}
