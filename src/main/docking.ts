import { BrowserWindow, screen } from 'electron';
import type { DockEdge, DockState } from '../shared/types';

const EDGE_THRESHOLD = 80;
const COLLAPSED_VISIBLE_RATIO = 0.06;
const COLLAPSED_THIN_RATIO = 0.016;
const CAPTURE_HEIGHT_RATIO = 0.28; // Increased to fit Quick Add form + bottom controls
const TOP_EDGE_HORIZONTAL_OFFSET_RATIO = 0.35;
const HANDLE_THICKNESS = 12;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class DockingController {
  private state: DockState = { edge: 'right', collapsed: true };
  private expandedBounds: Bounds;
  private isAdjusting = false;
  private isThin = false;
  private isCapture = false;

  constructor(private window: BrowserWindow) {
    this.expandedBounds = window.getBounds();
    this.attachListeners();
  }

  getState() {
    return this.state;
  }

  setThin(thin: boolean) {
    if (this.isThin === thin) return;
    this.isThin = thin;
    if (this.state.collapsed) {
      // Re-apply collapse to update bounds
      const collapsedBounds = this.getCollapsedBounds(this.expandedBounds);
      this.applyBounds(collapsedBounds);
    }
  }

  setCapture(capture: boolean) {
    if (this.isCapture === capture) return;
    this.isCapture = capture;
    // If entering capture mode, we treat it as a special expanded state
    if (this.isCapture) {
      const bounds = this.window.getBounds();
      const workArea = this.getWorkArea(bounds);
      const captureHeight = Math.round(workArea.height * CAPTURE_HEIGHT_RATIO);
      
      // Determine Y position based on docking edge or default behavior
      // If docked at TOP, we should anchor to top.
      // If docked at BOTTOM (not currently supported by edge logic but good to handle), anchor bottom.
      // The widget usually snaps to Left/Right/Top.
      
      let nextY = workArea.y + workArea.height - captureHeight; // Default: anchor bottom
      
      // If current edge is TOP, we might want to anchor top instead?
      // User complaint: "it goes to the very bottom... instead of staying up top"
      // If the user has the widget at the top of the screen, capture mode should probably stay at the top.
      
      if (this.state.edge === 'top') {
        nextY = workArea.y;
      } else {
        // For side edges, check if the window is closer to top or bottom
        const centerY = bounds.y + bounds.height / 2;
        const screenCenterY = workArea.y + workArea.height / 2;
        if (centerY < screenCenterY) {
           nextY = bounds.y; // Keep current Y if possible, or anchor top
        }
      }
      
      const nextBounds = {
        ...this.expandedBounds, // Use expanded width/x
        height: captureHeight,
        y: nextY
      };
      
      this.applyBounds(nextBounds);
    } else {
      // Exiting capture mode - restore expanded bounds if not collapsed
      if (!this.state.collapsed) {
        this.applyBounds(this.expandedBounds);
      }
    }
  }

  collapse() {
    if (this.state.collapsed) {
      console.log('Already collapsed, skipping');
      return;
    }
    
    // Reset special modes when collapsing
    this.isCapture = false;
    this.isThin = false;
    
    console.log('Collapsing widget...');
    // Ensure we use the full expanded bounds for calculation, not the current (possibly capture) bounds
    // If we were in capture mode, expandedBounds should still hold the full size.
    // If we use window.getBounds() here, and we are in capture mode, we get the small bounds!
    // FIX: Always use this.expandedBounds to calculate collapsed state, NOT window.getBounds()
    
    // Check if expandedBounds is valid (has height). If not, fallback to window bounds (risky if captured)
    let sourceBounds = this.expandedBounds;
    if (!sourceBounds || sourceBounds.height < 100) { // Sanity check
       sourceBounds = this.window.getBounds();
    }

    // Recalculate where collapsed bounds should be based on the FULL expanded size
    const collapsedBounds = this.getCollapsedBounds(sourceBounds);
    
    console.log('Applying collapsed bounds:', collapsedBounds, 'from source:', sourceBounds);
    this.applyBounds(collapsedBounds);
    this.updateState({ collapsed: true });
    console.log('Widget collapsed successfully');
  }

  expand() {
    if (!this.state.collapsed) return;
    this.applyBounds(this.expandedBounds);
    this.updateState({ collapsed: false });
  }

  snapToEdge(edge?: DockEdge) {
    const targetEdge = edge ?? this.state.edge;
    // If we are in capture mode, use the current bounds as base but reset height logic if needed
    // Actually, if we snap, we should probably exit capture mode or re-calc
    const bounds = this.window.getBounds();
    const workArea = this.getWorkArea(bounds);

    const nextBounds = { ...bounds };
    // Reset to standard width/height if not collapsed/capture?
    // For now, let's trust the current bounds unless we want to reset dimensions
    
    switch (targetEdge) {
      case 'left':
        nextBounds.x = workArea.x;
        break;
      case 'right':
        nextBounds.x = workArea.x + workArea.width - bounds.width;
        break;
      case 'top': {
        const offset =
          workArea.x +
          Math.round(workArea.width * TOP_EDGE_HORIZONTAL_OFFSET_RATIO);
        nextBounds.x = Math.min(
          Math.max(workArea.x, offset),
          workArea.x + workArea.width - bounds.width
        );
        nextBounds.y = workArea.y;
        break;
      }
    }

    if (!this.isCapture) {
      this.expandedBounds = nextBounds;
    }
    this.applyBounds(nextBounds);
    this.updateState({ edge: targetEdge, collapsed: false });
  }

  private attachListeners() {
    this.window.on('moved', () => this.handleMove());
    this.window.on('resized', () => {
      // Only update expandedBounds if we are in a "normal" state
      // i.e., not collapsed, not thin, and not in capture mode
      if (!this.state.collapsed && !this.isThin && !this.isCapture) {
        this.expandedBounds = this.window.getBounds();
      }
    });
  }

  private handleMove() {
    if (this.isAdjusting) return;
    const bounds = this.window.getBounds();

    if (this.isCapture || this.state.collapsed || this.isThin) {
      // When collapsed/capture we only want to cache position changes
      this.mergeExpandedBounds({
        x: bounds.x,
        y: bounds.y
      });
    } else {
      this.expandedBounds = bounds;
    }

    const workArea = this.getWorkArea(bounds);
    const distances = this.calculateDistances(bounds, workArea);

    const prioritized = (Object.entries(distances) as [DockEdge, number][])
      .sort((a, b) => a[1] - b[1])
      .filter(([, distance]) => distance <= EDGE_THRESHOLD);

    if (!prioritized.length) return;

    const [targetEdge] = prioritized[0];
    if (this.state.edge !== targetEdge) {
      this.updateState({ edge: targetEdge });
      this.snapToEdge(targetEdge);
    }
  }

  private calculateDistances(bounds: Bounds, workArea: Electron.Rectangle) {
    return {
      left: Math.abs(bounds.x - workArea.x),
      right: Math.abs(
        workArea.x + workArea.width - (bounds.x + bounds.width)
      ),
      top: Math.abs(bounds.y - workArea.y)
    } as Record<DockEdge, number>;
  }

  private getCollapsedBounds(bounds: Bounds): Bounds {
    const workArea = this.getWorkArea(bounds);
    const ratio = this.isThin ? COLLAPSED_THIN_RATIO : COLLAPSED_VISIBLE_RATIO;

    switch (this.state.edge) {
      case 'left':
        return {
          ...bounds,
          x: workArea.x - (bounds.width - HANDLE_THICKNESS)
        };
      case 'right':
        return {
          ...bounds,
          x: workArea.x + workArea.width - HANDLE_THICKNESS
        };
      case 'top': {
        const hiddenPortion = Math.round(
          bounds.height * (1 - ratio)
        );
        return {
          ...bounds,
          y: workArea.y - hiddenPortion
        };
      }
      default:
        return bounds;
    }
  }

  private getWorkArea(bounds: Bounds) {
    return screen.getDisplayMatching(bounds).workArea;
  }

  private applyBounds(bounds: Bounds) {
    this.isAdjusting = true;
    this.window.setBounds(bounds);
    setTimeout(() => {
      this.isAdjusting = false;
    }, 50);
  }

  private updateState(patch: Partial<DockState>) {
    this.state = { ...this.state, ...patch };
    this.window.webContents.send('dock-state:update', this.state);
  }

  private mergeExpandedBounds(partial: Partial<Bounds>) {
    this.expandedBounds = { ...this.expandedBounds, ...partial };
  }
}





