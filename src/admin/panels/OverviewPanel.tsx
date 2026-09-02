/**
 * The Overview tab — what happened on the site, from the site's own records.
 *
 * There is no third-party analytics here and no cookie: every number comes
 * from rows this app wrote about itself. That buys honesty and costs
 * precision, and the panel says so rather than implying otherwise — the
 * visitor count is a **per-day** count, because the identifier behind it is
 * re-salted at midnight UTC and cannot be followed across days. The
 * disclosure line at the foot of the panel is part of the feature, not
 * decoration.
 *
 * Reddit is singled out in the referrer list on purpose: this dashboard exists
 * for a Reddit launch, and "did the post work" is the question it will be
 * asked most on day one. The emphasis carries a text badge as well as a
 * colour so it survives greyscale and colour-vision deficiency.
 */
import { useCallback, useEffect, useState } from 'react';
import { Activity, Globe, Loader2, MonitorSmartphone, RefreshCw, Route, Share2 } from 'lucide-react';
import { GlassPanel, Segmented, type SegmentOption } from '../../ui/Glass';
import type { Flags, OverviewResponse, Ranked } from '../../api/contracts';
import { DEFAULT_FLAGS } from '../../api/contracts';
import { adminGet, flagsOf, isDatabaseAsleep } from '../api';
import { SectionHeader } from './primitives';
import {
  BarList,
  ChartCard,
  KpiTile,
  LineChart,
  VIZ,
  formatCompact,
  formatDay,
  relativeTime,
  type BarDatum,
} from './charts';

type Range = '14' | '30';

const RANGE_OPTIONS: SegmentOption<Range>[] = [
  { value: '14', label: '14 d' },
  { value: '30', label: '30 d' },
];

/** Hosts the launch post can arrive from — including Reddit's own app. */
const REDDIT_HOST = /(^|\.)(reddit\.com|redd\.it)$/i;
const isReddit = (key: string) => REDDIT_HOST.test(key) || key === 'com.reddit.frontpage';

/** A blank referrer is a direct hit; the table stores '' and means it. */
function referrerLabel(key: string): string {
  if (!key) return 'Direct / none';
  if (key === 'com.reddit.frontpage') return 'Reddit app (Android)';
  return key;
}

function toBars(rows: Ranked[], label: (key: string) => string = (k) => k || '—'): BarDatum[] {
  return rows.map((row) => ({
    key: row.key || '(none)',
    label: label(row.key),
    value: row.hits,
    detail: `${formatCompact(row.hits)} events · ${formatCompact(row.sessions)} sessions`,
  }));
}

const DEVICE_LABEL: Record<string, string> = {
  mobile: 'Phone',
  tablet: 'Tablet',
  desktop: 'Desktop',
  bot: 'Bot',
  unknown: 'Unknown',
};

export default function OverviewPanel() {
  const [range, setRange] = useState<Range>('14');
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [cap, setCap] = useState<number>(DEFAULT_FLAGS.ai.dailyCap);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; asleep: boolean } | null>(null);

  const load = useCallback(async (days: Range) => {
    setLoading(true);
    setError(null);
    try {
      // The cap lives in settings, not in the overview aggregate — but "AI
      // calls today" is meaningless without the ceiling it is running at, so
      // the two are read together and a missing cap degrades to the default
      // rather than blanking the tile.
      const [overview, settings] = await Promise.all([
        adminGet<OverviewResponse>('overview', { days }),
        adminGet('settings').then(flagsOf<Partial<Flags>>).catch(() => null),
      ]);
      setData(overview);
      const dailyCap = settings?.ai?.dailyCap;
      if (typeof dailyCap === 'number' && Number.isFinite(dailyCap)) setCap(dailyCap);
    } catch (err) {
      setError({
        message:
          err instanceof Error ? err.message : 'Could not load the overview.',
        asleep: isDatabaseAsleep(err),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const header = (
    <SectionHeader
      icon={<Activity size={15} />}
      accent="#22D3EE"
      title="Overview"
      sub="First-party and cookieless — every number here was written by this site about itself."
      right={
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented<Range>
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            layoutId="overview-range"
            size="sm"
            paint
          />
          <button
            type="button"
            onClick={() => void load(range)}
            disabled={loading}
            className="tap glass glass-sheen inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-bold text-white/65 hover:text-white disabled:opacity-60"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      }
    />
  );

  if (!data) {
    return (
      <section className="mt-10" data-testid="admin-overview">
        {header}
        {error ? (
          <GlassPanel className="p-5">
            <p className="text-[13px] font-bold text-[#FFB020]">
              {error.asleep ? 'Database not reachable yet' : 'Could not load the overview'}
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">
              {error.asleep
                ? 'Database not reachable yet — it wakes on first use; try again in a moment.'
                : error.message}
            </p>
            <button
              type="button"
              onClick={() => void load(range)}
              className="tap mt-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-[11.5px] font-semibold text-white/70 hover:text-white"
            >
              <RefreshCw size={12} /> Try again
            </button>
          </GlassPanel>
        ) : (
          <GlassPanel className="flex items-center gap-3 p-5 text-[12px] text-white/50">
            <Loader2 size={15} className="animate-spin" /> Reading the last {range} days…
          </GlassPanel>
        )}
      </section>
    );
  }

  const points = data.daily.map((day) => ({
    label: formatDay(day.day),
    values: [day.visitors, day.rooms],
  }));

  const referrerBars: BarDatum[] = data.referrers.map((row) => ({
    key: row.key || '(direct)',
    label: referrerLabel(row.key),
    value: row.hits,
    detail: `${formatCompact(row.hits)} events · ${formatCompact(row.sessions)} sessions`,
    ...(isReddit(row.key) ? { color: VIZ.emphasis, badge: 'Reddit' } : {}),
  }));

  const newFeedback = data.feedbackCounts?.new ?? 0;

  return (
    <section className="mt-10" data-testid="admin-overview">
      {header}

      {/* A refetch holds the previous render at reduced opacity: a skeleton
          here would throw the whole page away every time the range changes. */}
      <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiTile
            label="Visitors today"
            value={formatCompact(data.today.visitors)}
            accent={VIZ.series1}
            hint="Distinct, per day"
          />
          <KpiTile label="Page views today" value={formatCompact(data.today.views)} />
          <KpiTile label="Rooms today" value={formatCompact(data.today.rooms)} />
          <KpiTile
            label="New feedback"
            value={formatCompact(newFeedback)}
            accent={newFeedback > 0 ? '#FFB020' : undefined}
            hint={newFeedback > 0 ? 'Waiting on the Feedback tab' : 'Nothing unread'}
          />
          <KpiTile
            label="AI calls today"
            value={`${formatCompact(data.aiCallsToday)} / ${formatCompact(cap)}`}
            hint="Daily cap from Settings"
          />
          <KpiTile
            label="Errors today"
            value={formatCompact(data.today.errors)}
            accent={data.today.errors > 0 ? '#FF4D1C' : undefined}
            hint="Reported by visitors' browsers"
          />
        </div>

        <div className="mt-4">
          <ChartCard
            title="Daily visitors & rooms"
            sub={`Last ${data.days} days, UTC. One scale — both are counts of things that happened in a day.`}
          >
            <LineChart
              points={points}
              series={[
                { label: 'Visitors', color: VIZ.series1 },
                { label: 'Rooms', color: VIZ.series2 },
              ]}
              ariaLabel={`Daily visitors and rooms over the last ${data.days} days`}
            />
          </ChartCard>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="Top referrers"
            sub="Where the visit came from, resolved to a host on the server."
            right={<Share2 size={14} className="shrink-0 text-white/25" />}
          >
            <BarList rows={referrerBars} empty="No referrers recorded yet." />
          </ChartCard>

          <ChartCard
            title="Top pages"
            sub="Room codes are normalised away before a path is stored."
            right={<Route size={14} className="shrink-0 text-white/25" />}
          >
            <BarList rows={toBars(data.pages, (key) => key || '/')} empty="No page views yet." />
          </ChartCard>

          <ChartCard
            title="Devices"
            sub="From the user-agent string, which is never stored with an event."
            right={<MonitorSmartphone size={14} className="shrink-0 text-white/25" />}
          >
            <BarList
              rows={toBars(data.devices, (key) => DEVICE_LABEL[key] ?? key ?? 'Unknown')}
              empty="No devices recorded yet."
            />
          </ChartCard>

          <ChartCard
            title="Countries"
            sub="Two-letter code from the edge, not from an IP lookup we keep."
            right={<Globe size={14} className="shrink-0 text-white/25" />}
          >
            <BarList
              rows={toBars(data.countries, (key) => key.toUpperCase() || 'Unknown')}
              empty="No countries recorded yet."
            />
          </ChartCard>
        </div>

        <div className="mt-4">
          <ChartCard title="Recent events" sub="The last few rows, newest first.">
            {data.recent.length === 0 ? (
              <p className="py-6 text-center text-[11.5px] text-white/35">Nothing recorded yet.</p>
            ) : (
              <div className="-mx-1 max-h-80 overflow-auto">
                <table className="w-full min-w-[520px] font-mono text-[10.5px]">
                  <thead className="sticky top-0 bg-[#0e0e16]/95 text-white/40 backdrop-blur">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold">When</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Event</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Path</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Where</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Props</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((row, index) => {
                      const props = row.props && Object.keys(row.props).length ? JSON.stringify(row.props) : '';
                      return (
                        <tr key={`${row.occurred_at}-${index}`} className="border-t border-white/6">
                          <td className="whitespace-nowrap px-2 py-1 text-white/45">
                            {relativeTime(row.occurred_at)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-white/85">{row.name}</td>
                          <td className="max-w-[180px] truncate px-2 py-1 text-white/55" title={row.path}>
                            {row.path || '—'}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-white/45">
                            {[row.country?.toUpperCase(), row.device].filter(Boolean).join(' · ') || '—'}
                          </td>
                          <td className="max-w-[220px] truncate px-2 py-1 text-white/35" title={props}>
                            {props ? props.slice(0, 60) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </div>
      </div>

      <p className="mt-4 text-[10.5px] leading-relaxed text-white/35">
        Visitors are counted per day. A visitor who returns tomorrow counts twice — the identifier
        is re-salted at midnight UTC so it cannot be followed across days.
      </p>

      {error && (
        <p className="mt-2 text-[11px] text-[#FFB020]">
          {error.asleep
            ? 'Database not reachable yet — it wakes on first use; try again in a moment.'
            : error.message}{' '}
          Showing the last numbers that arrived.
        </p>
      )}
    </section>
  );
}
