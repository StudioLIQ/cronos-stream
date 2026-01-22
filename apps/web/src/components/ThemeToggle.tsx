import { useTheme } from '../contexts/ThemeContext';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        padding: '8px 12px',
        borderRadius: '8px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '14px',
        color: 'var(--muted)',
      }}
    >
      {theme === 'dark' ? (
        <>
          <span style={{ fontSize: '16px' }}>&#9728;</span>
          <span>Light</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: '16px' }}>&#9790;</span>
          <span>Dark</span>
        </>
      )}
    </button>
  );
}
