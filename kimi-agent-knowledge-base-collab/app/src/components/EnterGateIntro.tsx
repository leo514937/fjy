import { useEffect, useMemo, useState } from 'react';
import { Atom, BookOpen, Link2, Network, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

function getMotionPreference() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function EnterGateIntro() {
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'exiting'>('closed');
  const prefersReducedMotion = useMemo(() => getMotionPreference(), []);

  useEffect(() => {
    if (!visible) return;

    if (prefersReducedMotion) {
      setPhase('open');
      const timer = window.setTimeout(() => {
        setPhase('exiting');
        window.setTimeout(() => setVisible(false), 150);
      }, 350);
      return () => window.clearTimeout(timer);
    }

    const openTimer = window.setTimeout(() => setPhase('opening'), 120);
    const revealTimer = window.setTimeout(() => setPhase('open'), 1200);
    const exitTimer = window.setTimeout(() => setPhase('exiting'), 2350);
    const hideTimer = window.setTimeout(() => setVisible(false), 3050);

    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(revealTimer);
      window.clearTimeout(exitTimer);
      window.clearTimeout(hideTimer);
    };
  }, [prefersReducedMotion, visible]);

  const nodes = [
    { top: '14%', left: '18%', size: 14, delay: '0ms' },
    { top: '24%', left: '34%', size: 10, delay: '180ms' },
    { top: '36%', left: '22%', size: 12, delay: '360ms' },
    { top: '62%', left: '30%', size: 10, delay: '520ms' },
    { top: '18%', left: '68%', size: 12, delay: '140ms' },
    { top: '34%', left: '82%', size: 10, delay: '280ms' },
    { top: '56%', left: '74%', size: 14, delay: '440ms' },
    { top: '72%', left: '58%', size: 10, delay: '620ms' },
  ];

  const links = [
    { top: '20%', left: '26%', width: '18%', rotate: '-18deg' },
    { top: '28%', left: '40%', width: '20%', rotate: '22deg' },
    { top: '48%', left: '28%', width: '24%', rotate: '8deg' },
    { top: '34%', left: '60%', width: '18%', rotate: '-14deg' },
    { top: '58%', left: '50%', width: '26%', rotate: '16deg' },
  ];

  if (!visible) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[80] overflow-hidden bg-[#090b12] text-white',
        'transition-opacity duration-700',
        phase === 'exiting' ? 'opacity-0' : 'opacity-100',
      )}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(72,187,120,0.18),transparent_35%),radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.18),transparent_25%),radial-gradient(circle_at_80%_30%,rgba(168,85,247,0.16),transparent_26%),linear-gradient(180deg,rgba(9,11,18,0.96),rgba(9,11,18,0.88))]" />
      <div className="intro-grid absolute inset-0 opacity-[0.17]" />

      <div className="absolute inset-0">
        {links.map((link, index) => (
          <div
            key={`${link.top}-${index}`}
            className="intro-link absolute origin-left rounded-full bg-cyan-300/40 shadow-[0_0_18px_rgba(103,232,249,0.45)]"
            style={{
              top: link.top,
              left: link.left,
              width: link.width,
              height: '2px',
              transform: `rotate(${link.rotate}) scaleX(${phase === 'closed' ? 0.35 : phase === 'opening' ? 0.8 : 1})`,
            }}
          />
        ))}

        {nodes.map((node, index) => (
          <div
            key={`${node.top}-${index}`}
            className="absolute rounded-full border border-cyan-200/50 bg-cyan-100/70 shadow-[0_0_28px_rgba(103,232,249,0.45)]"
            style={{
              top: node.top,
              left: node.left,
              width: node.size,
              height: node.size,
              animationDelay: node.delay,
            }}
          >
            <div className="absolute inset-[-10px] rounded-full border border-cyan-300/20 animate-ping" />
          </div>
        ))}
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-[min(74vw,38rem)] w-[min(92vw,58rem)] items-center justify-center">
          <div className="absolute inset-x-[12%] top-1/2 h-px bg-gradient-to-r from-transparent via-cyan-200/35 to-transparent" />
          <div className="absolute inset-y-[10%] left-1/2 w-px bg-gradient-to-b from-transparent via-cyan-200/25 to-transparent" />

          <div
            className={cn(
              'intro-door intro-door-left absolute left-0 top-[8%] h-[84%] w-[50.5%] rounded-[2.25rem] border border-white/10',
              'bg-[linear-gradient(135deg,rgba(18,26,40,0.98),rgba(11,17,28,0.96)_50%,rgba(4,10,18,0.98))]',
              'shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-sm',
              phase === 'opening' || phase === 'open' || phase === 'exiting' ? '-translate-x-[94%]' : 'translate-x-0',
              phase === 'exiting' ? 'opacity-0' : 'opacity-100',
            )}
          >
            <div className="absolute inset-0 rounded-[2.25rem] border border-cyan-300/10" />
            <div className="absolute inset-y-5 right-3 w-px bg-gradient-to-b from-transparent via-cyan-200/40 to-transparent" />
            <div className="absolute inset-x-6 top-6 h-px bg-gradient-to-r from-cyan-300/0 via-cyan-200/35 to-cyan-300/0" />
            <div className="absolute bottom-6 left-6 flex items-center gap-3 text-cyan-100/80">
              <BookOpen className="h-5 w-5" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.35em]">Knowledge Vault</span>
            </div>
          </div>

          <div
            className={cn(
              'intro-door intro-door-right absolute right-0 top-[8%] h-[84%] w-[50.5%] rounded-[2.25rem] border border-white/10',
              'bg-[linear-gradient(225deg,rgba(18,26,40,0.98),rgba(11,17,28,0.96)_50%,rgba(4,10,18,0.98))]',
              'shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-sm',
              phase === 'opening' || phase === 'open' || phase === 'exiting' ? 'translate-x-[94%]' : 'translate-x-0',
              phase === 'exiting' ? 'opacity-0' : 'opacity-100',
            )}
          >
            <div className="absolute inset-0 rounded-[2.25rem] border border-cyan-300/10" />
            <div className="absolute inset-y-5 left-3 w-px bg-gradient-to-b from-transparent via-cyan-200/40 to-transparent" />
            <div className="absolute inset-x-6 top-6 h-px bg-gradient-to-r from-cyan-300/0 via-cyan-200/35 to-cyan-300/0" />
            <div className="absolute bottom-6 right-6 flex items-center gap-3 text-cyan-100/80">
              <Network className="h-5 w-5" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.35em]">Graph Forge</span>
            </div>
          </div>

          <div
            className={cn(
              'relative z-10 flex max-w-[38rem] flex-col items-center text-center transition-all duration-700',
              phase === 'opening' || phase === 'open' ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0',
              phase === 'exiting' ? 'scale-95 opacity-0' : 'scale-100',
            )}
          >
            <div className="mb-5 flex items-center gap-3 rounded-full border border-cyan-200/25 bg-white/5 px-4 py-2 backdrop-blur-md">
              <Sparkles className="h-4 w-4 text-cyan-200" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.45em] text-cyan-50/85">
                正在进入知识库工厂
              </span>
            </div>

            <h1 className="text-4xl font-black tracking-[-0.04em] text-white sm:text-6xl">
              Kimi Knowledge Base
            </h1>
            <p className="mt-4 max-w-[32rem] text-sm leading-7 text-slate-200/80 sm:text-base">
              大门开启时，知识会从实体、关系和图谱之间重新连线，像进入一座正在运转的知识工厂。
            </p>

            <div className="mt-8 grid grid-cols-3 gap-3 sm:gap-4">
              {[
                { icon: Atom, label: '实体解析' },
                { icon: Link2, label: '关联追踪' },
                { icon: Network, label: '图谱编织' },
              ].map((item, index) => (
                <div
                  key={item.label}
                  className="flex min-w-[4.5rem] flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-4 py-4 shadow-[0_0_30px_rgba(12,18,31,0.45)] backdrop-blur-sm"
                  style={{
                    animationDelay: `${index * 140}ms`,
                  }}
                >
                  <item.icon className="h-5 w-5 text-cyan-200" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-100/85">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
