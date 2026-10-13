import { useEffect, useRef, useState } from 'react';

const COLS = 9;
const ROWS = 6;
type Point = { x: number; y: number };
type ChaseState = { id: string; status: 'active' | 'completed'; catcherId: string; runnerId: string; positions: Record<string, Point>; winner: string | null; version: number };
type Props = { userId: string; partnerId: string | null; partnerName: string };

async function chaseApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/chase-games${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message ?? 'Oyun işlemi tamamlanamadı.');
  return result.data as T;
}

export default function ChaseGame({ userId, partnerId, partnerName }: Props) {
  const [game, setGame] = useState<ChaseState | null>(null);
  const [message, setMessage] = useState('Yeni tur başlat düğmesine basın.');
  const [starting, setStarting] = useState(false);
  const gameRef = useRef(game);
  const movingRef = useRef(false);
  gameRef.current = game;

  useEffect(() => {
    if (!partnerId) { setGame(null); return; }
    let stopped = false;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await chaseApi<{ game: ChaseState | null }>('/current');
        if (!stopped) {
          gameRef.current = result.game;
          setGame(result.game);
          if (result.game) setMessage('Oyun hazır. Hamleleriniz kaydediliyor.');
        }
      } catch (cause) {
        if (!stopped) setMessage(cause instanceof Error ? cause.message : 'Oyun yüklenemedi.');
      } finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [partnerId]);

  const move = async (dx: number, dy: number) => {
    const current = gameRef.current;
    if (!current || current.status !== 'active' || movingRef.current) return;
    const point = current.positions[userId];
    if (!point) return;
    const x = point.x + dx; const y = point.y + dy;
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    movingRef.current = true;
    try {
      const result = await chaseApi<{ game: ChaseState }>(`/${current.id}/move`, 'PATCH', { x, y });
      gameRef.current = result.game;
      setGame(result.game);
      setMessage(result.game.status === 'completed' ? 'Bu tur tamamlandı.' : 'Hamle kaydedildi.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Hamle yapılamadı.'); }
    finally { movingRef.current = false; }
  };

  useEffect(() => {
    const moves: Record<string, Point> = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const delta = moves[event.key];
      if (!delta || event.repeat || !gameRef.current || gameRef.current.status !== 'active') return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, button')) return;
      event.preventDefault(); void move(delta.x, delta.y);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [userId]);

  const start = async () => {
    setStarting(true);
    try {
      const result = await chaseApi<{ game: ChaseState }>('', 'POST', {});
      gameRef.current = result.game;
      setGame(result.game);
      setMessage('Oyun başladı! Karakterini hareket ettir.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Oyun başlatılamadı.'); }
    finally { setStarting(false); }
  };

  const isCatcher = game?.catcherId === userId;
  const finished = game?.status === 'completed';
  const statusText = !partnerId
    ? 'Önce davet koduyla partnerin bu alana katılmalı.'
    : !game
      ? message
      : finished
        ? game.winner === userId ? 'Yakaladın! Bu turu sen kazandın! 💖' : `${partnerName} seni yakaladı; bu turu partnerin kazandı.`
        : isCatcher ? `👦🏻 Sen kovalıyorsun; ${partnerName} kaçıyor!` : '👧🏻 Sen kaçıyorsun; yakalanmamaya çalış!';

  return <section className="rounded-3xl border border-rose-100 bg-white p-5 shadow-sm sm:p-7">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[.18em] text-rose-500">İki kişilik oyun</p><h2 className="mt-2 text-2xl font-semibold">Kalpten kalbe kaçış</h2><p className="mt-2 max-w-xl text-sm text-rose-900/60">Her biri kendi karakterini yönetsin. Aynı kareye geldiklerinde kovalayan kazanır. Hamleler kaydedilir; partnerin ekranı kısa süre içinde güncellenir.</p></div>
      {game && <span className={`rounded-full px-4 py-2 text-sm font-semibold ${finished ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{finished ? 'Oyun bitti' : 'Oyun açık'}</span>}
    </div>
    <div className="grid grid-cols-9 gap-1.5 rounded-2xl bg-gradient-to-br from-pink-50 to-rose-100 p-2 sm:gap-2 sm:p-3" role="img" aria-label="İki kişilik kovalama oyunu alanı">
      {Array.from({ length: COLS * ROWS }, (_, index) => {
        const x = index % COLS; const y = Math.floor(index / COLS);
        const catcher = game?.positions[game.catcherId]; const runner = game?.positions[game.runnerId];
        const isCatcherHere = catcher?.x === x && catcher.y === y; const isRunnerHere = runner?.x === x && runner.y === y;
        return <div key={index} className="grid aspect-square place-items-center rounded-xl bg-white/75 text-xl sm:rounded-2xl sm:text-3xl">{isCatcherHere && isRunnerHere ? '💞' : isCatcherHere ? '👦🏻' : isRunnerHere ? '👧🏻' : ((x * 3 + y * 5) % 17 === 0 ? '♡' : '')}</div>;
      })}
    </div>
    <p aria-live="polite" className="mt-4 min-h-10 rounded-2xl bg-rose-50 px-4 py-3 text-center text-sm font-medium text-rose-800">{statusText}</p>
    <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <p className="text-xs text-rose-900/50">Bilgisayar: yön tuşları veya W A S D · Telefon: aşağıdaki düğmeler</p>
      <button disabled={!partnerId || starting} onClick={() => void start()} className="rounded-xl bg-rose-500 px-5 py-3 font-semibold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50">{starting ? 'Başlatılıyor…' : game && !finished ? 'Yeni tur başlat' : 'Oyuna başla'}</button>
    </div>
    <div className="mx-auto mt-3 grid w-36 grid-cols-3 gap-2 sm:hidden">
      <span /> <button onClick={() => void move(0, -1)} aria-label="Yukarı git" className="rounded-xl bg-rose-100 py-3 text-lg text-rose-700">↑</button><span />
      <button onClick={() => void move(-1, 0)} aria-label="Sola git" className="rounded-xl bg-rose-100 py-3 text-lg text-rose-700">←</button><button onClick={() => void move(0, 1)} aria-label="Aşağı git" className="rounded-xl bg-rose-100 py-3 text-lg text-rose-700">↓</button><button onClick={() => void move(1, 0)} aria-label="Sağa git" className="rounded-xl bg-rose-100 py-3 text-lg text-rose-700">→</button>
    </div>
    <p className="mt-4 text-center text-xs text-rose-900/45">Oyun durumu veritabanından yenilenir; iki taraf aynı anda çevrimiçi olmak zorunda değil.</p>
  </section>;
}
