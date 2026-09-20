import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const decks = [
  {
    id: 'A',
    title: 'Deck A',
    track: 'Sunset Signals',
    artist: 'Nova Harbor',
    bpm: 118,
    key: 'Bmin',
    cue: '01:42',
    progress: 62,
    accent: 'from-violet-500 via-fuchsia-500 to-pink-500',
  },
  {
    id: 'B',
    title: 'Deck B',
    track: 'Afterglow Avenue',
    artist: 'Mara Kline',
    bpm: 118,
    key: 'Dmaj',
    cue: '00:58',
    progress: 38,
    accent: 'from-cyan-500 via-sky-500 to-indigo-500',
  },
];

const skillTriggers = [
  { name: 'EQ Swap', key: 'F1', tone: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  { name: 'Loop Roll', key: 'F2', tone: 'bg-violet-500/15 text-violet-200 border-violet-400/30' },
  { name: 'Cutin', key: 'F3', tone: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30' },
];

const mixerLevels = [
  { label: 'High', value: 72 },
  { label: 'Mid', value: 56 },
  { label: 'Low', value: 78 },
  { label: 'Gain', value: 64 },
];

function StudioPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(110,67,126,0.38),_transparent_45%),linear-gradient(180deg,#1d1027_0%,#120c1d_100%)] text-white">
      <header className="border-b border-white/10 bg-slate-950/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-violet-600 text-sm font-black shadow-lg shadow-violet-500/20">
              DJ
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-violet-200/70">Session</p>
              <h1 className="text-lg font-semibold">Night Drive</h1>
            </div>
          </div>

          <nav className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" className="text-slate-200 hover:bg-white/5">
              <Link to="/">Library</Link>
            </Button>
            <Button variant="ghost" className="text-slate-200 hover:bg-white/5">
              <Link to="/studio">Studio</Link>
            </Button>
            <Button variant="ghost" className="text-slate-200 hover:bg-white/5">Skills</Button>
          </nav>

          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="border-emerald-400/30 bg-emerald-500/10 text-emerald-200">
              Live</Badge>
            <Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
              Save mix
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-violet-200/70">Mix desk</p>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight text-white">Two-deck performance</h2>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1.5">
            <Button variant="ghost" className="rounded-full text-white hover:bg-white/10">Preview</Button>
            <Button className="rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white shadow-lg shadow-violet-500/30 hover:brightness-110">
              Start deck
            </Button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
          <div className="grid gap-5 lg:grid-cols-2">
            {decks.map((deck) => (
              <Card key={deck.id} className="overflow-hidden border-white/10 bg-slate-900/70 shadow-2xl shadow-slate-950/40">
                <CardHeader className="border-b border-white/10 bg-gradient-to-r from-white/5 to-transparent p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{deck.title}</p>
                      <CardTitle className="mt-2 text-xl font-semibold text-white">{deck.track}</CardTitle>
                    </div>
                    <Badge variant="secondary" className="border-white/15 bg-white/5 text-slate-200">
                      {deck.key}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 p-4 sm:p-5">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>{deck.artist}</span>
                    <span>{deck.bpm} BPM</span>
                  </div>

                  <div className="relative flex items-center justify-center rounded-full border border-white/10 bg-slate-950/80 p-6">
                    <div className={`absolute inset-4 rounded-full bg-gradient-to-br ${deck.accent} opacity-90 blur-[2px]`} />
                    <div className="absolute inset-9 rounded-full border border-white/15 bg-slate-950/90" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="relative h-36 w-36 rounded-full border-[10px] border-slate-100/80 bg-slate-950 shadow-[inset_0_0_28px_rgba(255,255,255,0.1)]">
                        <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.7)]" />
                        <div className="absolute inset-[30%] rounded-full border border-white/15" />
                      </div>
                    </div>
                    <div className="absolute inset-x-0 bottom-4 flex items-center justify-center text-xs uppercase tracking-[0.2em] text-slate-300">
                      Cue {deck.cue}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
                      <span>Position</span>
                      <span>{deck.progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${deck.accent}`}
                        style={{ width: `${deck.progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <Button variant="outline" className="flex-1 border-white/15 bg-white/5 text-white hover:bg-white/10">
                      Cue set
                    </Button>
                    <Button variant="outline" className="flex-1 border-white/15 bg-white/5 text-white hover:bg-white/10">
                      Sync
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-5">
            <Card className="border-white/10 bg-slate-900/70">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-base font-semibold text-white">Skill tray</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                {skillTriggers.map((skill) => (
                  <div key={skill.name} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${skill.tone}`}>
                    <span className="font-medium">{skill.name}</span>
                    <span className="rounded-md border border-white/10 bg-black/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]">
                      {skill.key}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-slate-900/70">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-base font-semibold text-white">Mixer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-4 pt-0">
                {mixerLevels.map((level) => (
                  <div key={level.label} className="space-y-2">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.15em] text-slate-400">
                      <span>{level.label}</span>
                      <span>{level.value}%</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-pink-400 via-violet-400 to-cyan-400"
                        style={{ width: `${level.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

export default StudioPage;
