import type { DockState } from '@shared/types';

interface Props {
  onRefresh: () => void;
  onOpenDrawer: () => void;
  dockState: DockState;
}

const SettingsPanel = ({ onRefresh, onOpenDrawer, dockState }: Props) => {
  return (
    <div className="settings">
      <button className="pill ghost" type="button" onClick={onRefresh}>
        Refresh
      </button>
      <button
        className="pill ghost"
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open settings"
      >
        Settings
      </button>
      <span className="dock-indicator">Docked: {dockState.edge}</span>
    </div>
  );
};

export default SettingsPanel;

