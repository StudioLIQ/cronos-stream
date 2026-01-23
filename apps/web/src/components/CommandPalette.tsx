import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  action: () => void;
  category: 'navigation' | 'actions' | 'settings';
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  // Extract slug from current path
  const pathMatch = location.pathname.match(/\/(?:v|o|d|dashboard)\/([^/]+)/);
  const currentSlug = pathMatch ? pathMatch[1] : 'demo';

  const commands: Command[] = [
    // Navigation
    {
      id: 'home',
      label: 'Go to Home',
      shortcut: 'G H',
      action: () => navigate('/'),
      category: 'navigation',
    },
    {
      id: 'viewer',
      label: `Go to Viewer (${currentSlug})`,
      shortcut: 'G V',
      action: () => navigate(`/v/${currentSlug}`),
      category: 'navigation',
    },
	    {
	      id: 'dashboard',
	      label: 'Go to Dashboard',
	      shortcut: 'G D',
	      action: () => navigate('/dashboard'),
	      category: 'navigation',
	    },
		    // Settings
		    {
		      id: 'toggle-theme',
		      label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`,
      shortcut: 'T',
      action: toggleTheme,
      category: 'settings',
    },
    // Actions
    {
      id: 'copy-viewer-url',
      label: 'Copy Viewer URL',
      action: () => {
        navigator.clipboard.writeText(`${window.location.origin}/v/${currentSlug}`);
      },
      category: 'actions',
    },
  ];

  const filteredCommands = query
    ? commands.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(query.toLowerCase()) ||
          cmd.description?.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Open command palette with Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        setQuery('');
        setSelectedIndex(0);
        return;
      }

      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }

      if (e.key === 'Enter' && filteredCommands[selectedIndex]) {
        e.preventDefault();
        filteredCommands[selectedIndex].action();
        setIsOpen(false);
        return;
      }
    },
    [isOpen, filteredCommands, selectedIndex]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const groupedCommands = {
    navigation: filteredCommands.filter((c) => c.category === 'navigation'),
    actions: filteredCommands.filter((c) => c.category === 'actions'),
    settings: filteredCommands.filter((c) => c.category === 'settings'),
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        zIndex: 9999,
      }}
      onClick={() => setIsOpen(false)}
    >
      <div
        className="modal-content"
        style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '520px',
          maxHeight: '400px',
          overflow: 'hidden',
          border: '1px solid var(--border)',
          boxShadow: '0 20px 60px var(--shadow)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '16px',
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text)',
            }}
          />
        </div>

        {/* Command list */}
        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
          {filteredCommands.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
              No commands found
            </div>
          )}

          {groupedCommands.navigation.length > 0 && (
            <div>
              <div
                style={{
                  padding: '8px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Navigation
              </div>
              {groupedCommands.navigation.map((cmd) => {
                const globalIndex = filteredCommands.indexOf(cmd);
                return (
                  <CommandItem
                    key={cmd.id}
                    command={cmd}
                    isSelected={globalIndex === selectedIndex}
                    onSelect={() => {
                      cmd.action();
                      setIsOpen(false);
                    }}
                    onHover={() => setSelectedIndex(globalIndex)}
                  />
                );
              })}
            </div>
          )}

          {groupedCommands.actions.length > 0 && (
            <div>
              <div
                style={{
                  padding: '8px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Actions
              </div>
              {groupedCommands.actions.map((cmd) => {
                const globalIndex = filteredCommands.indexOf(cmd);
                return (
                  <CommandItem
                    key={cmd.id}
                    command={cmd}
                    isSelected={globalIndex === selectedIndex}
                    onSelect={() => {
                      cmd.action();
                      setIsOpen(false);
                    }}
                    onHover={() => setSelectedIndex(globalIndex)}
                  />
                );
              })}
            </div>
          )}

          {groupedCommands.settings.length > 0 && (
            <div>
              <div
                style={{
                  padding: '8px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Settings
              </div>
              {groupedCommands.settings.map((cmd) => {
                const globalIndex = filteredCommands.indexOf(cmd);
                return (
                  <CommandItem
                    key={cmd.id}
                    command={cmd}
                    isSelected={globalIndex === selectedIndex}
                    onSelect={() => {
                      cmd.action();
                      setIsOpen(false);
                    }}
                    onHover={() => setSelectedIndex(globalIndex)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: '16px',
            justifyContent: 'center',
            fontSize: '12px',
            color: 'var(--muted)',
          }}
        >
          <span><kbd style={kbdStyle}>↑↓</kbd> Navigate</span>
          <span><kbd style={kbdStyle}>↵</kbd> Select</span>
          <span><kbd style={kbdStyle}>esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '2px 6px',
  fontSize: '11px',
  fontFamily: 'monospace',
};

function CommandItem({
  command,
  isSelected,
  onSelect,
  onHover,
}: {
  command: Command;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      onMouseEnter={onHover}
      style={{
        padding: '10px 16px',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: isSelected ? 'rgba(0, 231, 160, 0.1)' : 'transparent',
        borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      <div>
        <div style={{ fontWeight: 500, color: 'var(--text)' }}>{command.label}</div>
        {command.description && (
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
            {command.description}
          </div>
        )}
      </div>
      {command.shortcut && (
        <div style={{ display: 'flex', gap: '4px' }}>
          {command.shortcut.split(' ').map((key, i) => (
            <kbd key={i} style={kbdStyle}>
              {key}
            </kbd>
          ))}
        </div>
      )}
    </div>
  );
}
