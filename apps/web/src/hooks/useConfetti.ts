import confetti from 'canvas-confetti';

export function useConfetti() {
  const fire = (options?: {
    particleCount?: number;
    spread?: number;
    origin?: { x: number; y: number };
    colors?: string[];
  }) => {
    const defaults = {
      particleCount: 100,
      spread: 70,
      origin: { x: 0.5, y: 0.6 },
      colors: ['#00e7a0', '#3b82f6', '#f59e0b', '#6366f1', '#10b981'],
      disableForReducedMotion: true,
    };

    confetti({
      ...defaults,
      ...options,
    });
  };

  const fireSuccess = () => {
    // Left side
    confetti({
      particleCount: 50,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ['#00e7a0', '#3b82f6', '#f59e0b'],
      disableForReducedMotion: true,
    });
    // Right side
    confetti({
      particleCount: 50,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ['#6366f1', '#10b981', '#f59e0b'],
      disableForReducedMotion: true,
    });
  };

  const fireCelebration = () => {
    const duration = 2000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#00e7a0', '#3b82f6', '#f59e0b'],
        disableForReducedMotion: true,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#6366f1', '#10b981', '#f59e0b'],
        disableForReducedMotion: true,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    frame();
  };

  return { fire, fireSuccess, fireCelebration };
}
