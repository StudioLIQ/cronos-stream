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
      colors: ['#00f889', '#5cbffb', '#f2da00', '#00ffa3', '#027f80'],
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
      colors: ['#00f889', '#5cbffb', '#f2da00'],
      disableForReducedMotion: true,
    });
    // Right side
    confetti({
      particleCount: 50,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ['#00ffa3', '#027f80', '#f2da00'],
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
        colors: ['#00f889', '#5cbffb', '#f2da00'],
        disableForReducedMotion: true,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#00ffa3', '#027f80', '#f2da00'],
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
