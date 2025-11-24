import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import type {
  NotionCreatePayload,
  TaskStatusOption
} from '@shared/types';
import {
  matrixOptions,
  getMatrixClass,
  findMatrixOptionById,
  findMatrixOptionFromFlags,
  type MatrixOptionId
} from '../constants/matrix';
import DateField from './DateField';
import { getStatusColorClass } from '../utils/statusColors';

interface Props {
  onAdd(payload: NotionCreatePayload): Promise<void>;
  statusOptions: TaskStatusOption[];
  manualStatuses?: string[];
  completedStatus?: string;
  isCollapsed?: boolean;
  onCollapseToggle?: () => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const DEFAULT_MATRIX =
  matrixOptions.find((option) => !option.urgent && !option.important) ??
  matrixOptions[matrixOptions.length - 1];

const QuickAdd = ({
  onAdd,
  statusOptions,
  manualStatuses,
  completedStatus,
  isCollapsed = false,
  onCollapseToggle
}: Props) => {
  const [value, setValue] = useState('');
  const [date, setDate] = useState(() => todayISO());
  const [dateEnd, setDateEnd] = useState<string | null>(null);
  const [hardDeadline, setHardDeadline] = useState(true);
  const [matrixSelection, setMatrixSelection] = useState<MatrixOptionId>(
    DEFAULT_MATRIX.id
  );
  const [status, setStatus] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableStatuses = useMemo(() => {
    if (statusOptions.length) {
      return statusOptions
        .map((option) => option.name)
        .filter((name) => name !== completedStatus);
    }
    return (manualStatuses ?? [])
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((name) => name !== completedStatus);
  }, [statusOptions, manualStatuses, completedStatus]);

  useEffect(() => {
    setStatus((current) =>
      current && availableStatuses.includes(current)
        ? current
        : availableStatuses[0] ?? ''
    );
  }, [availableStatuses]);

  const selectedMatrix = useMemo(
    () => findMatrixOptionById(matrixSelection) ?? DEFAULT_MATRIX,
    [matrixSelection]
  );

  const matrixClass = useMemo(
    () => getMatrixClass(selectedMatrix.urgent, selectedMatrix.important),
    [selectedMatrix]
  );

  const defaultStatusChoice = availableStatuses[0] ?? '';
  const isComplete =
    Boolean(completedStatus) && status === (completedStatus ?? '');
  const statusMissing =
    Boolean(status) && !availableStatuses.includes(status);

  const titleInputId = useId();
  const statusSelectId = useId();
  const matrixSelectId = useId();
  const urgentToggleId = useId();
  const importantToggleId = useId();
  const notesFieldId = useId();
  const notesPanelId = `${notesFieldId}-panel`;

  const applyMatrixChoice = (optionId: MatrixOptionId) => {
    setMatrixSelection(optionId);
  };

  const applyFlags = (nextUrgent: boolean, nextImportant: boolean) => {
    const target =
      findMatrixOptionFromFlags(nextUrgent, nextImportant) ?? DEFAULT_MATRIX;
    setMatrixSelection(target.id);
  };

  const handleCompleteToggle = () => {
    if (!completedStatus) return;
    setStatus((current) =>
      current === completedStatus ? defaultStatusChoice : completedStatus
    );
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim() || pending) return;

    try {
      setPending(true);
      await onAdd({
        title: value.trim(),
        date: date || undefined,
        dateEnd: dateEnd || undefined,
        hardDeadline,
        urgent: selectedMatrix.urgent,
        important: selectedMatrix.important,
        status: status || undefined,
        mainEntry: notes.trim() || undefined
      });
      setValue('');
      setDate(todayISO());
      setDateEnd(null);
      applyMatrixChoice(DEFAULT_MATRIX.id);
      setHardDeadline(true);
      setStatus(availableStatuses[0] ?? '');
      setNotes('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create task');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="quick-add-wrapper">
      <form className={`quick-add ${isCollapsed ? 'is-collapsed' : ''}`} onSubmit={handleSubmit}>
        <article
          className={`task-row capture-task-row ${isComplete ? 'is-complete' : ''}`}
        >
        <div className="task-row-header">
          <div className="task-header-left">
            <button
              type="button"
              className={`complete-toggle capture-complete ${
                isComplete ? 'is-complete' : ''
              }`}
              data-state={isComplete ? 'complete' : 'idle'}
              onClick={handleCompleteToggle}
              disabled={!completedStatus || pending}
              aria-pressed={isComplete}
              title={
                completedStatus
                  ? isComplete
                    ? 'Mark as to-do before saving'
                    : 'Mark as complete when saving'
                  : 'Set a completed status in settings to enable'
              }
            />
            <div className="capture-title-wrapper">
              <label htmlFor={titleInputId} className="sr-only">
                Task title
              </label>
              <input
                id={titleInputId}
                type="text"
                placeholder="Add a New Task…"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={pending}
                className="task-title-input capture-title-input"
              />
            </div>
          </div>
          <div className="task-header-right">
            <button
              type="button"
              className={`chip deadline-chip capture-deadline-toggle ${
                hardDeadline ? 'chip-hard' : 'chip-soft'
              }`}
              onClick={() => setHardDeadline((prev) => !prev)}
              disabled={pending}
              aria-label="Toggle hard deadline"
            >
              {hardDeadline ? 'Hard deadline' : 'Soft deadline'}
            </button>
          </div>
        </div>

        <div className="task-properties-row capture-task-properties">
          <div className="property-group-left capture-property-group-left">
            <div className="date-stack">
              <DateField
                inputClassName="pill-input"
                value={date || null}
                endValue={dateEnd}
                allowRange
                allowTime
                onChange={(nextStart, nextEnd) => {
                  setDate(nextStart ?? '');
                  setDateEnd(nextEnd ?? null);
                }}
                disabled={pending}
                ariaLabel="Due date"
                placeholder="Due date"
              />
              <button
                type="button"
                className="task-notes-toggle"
                onClick={() => setShowNotes((prev) => !prev)}
                aria-expanded={showNotes}
                aria-controls={showNotes ? notesPanelId : undefined}
                disabled={pending}
              >
                {showNotes ? 'Hide notes' : 'Add notes…'}
              </button>
            </div>
            <div className="property-item status-item">
              <label htmlFor={statusSelectId} className="sr-only">
                Status
              </label>
              <select
                id={statusSelectId}
                className={`pill-select status-pill ${getStatusColorClass(status)}`}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                disabled={pending || !availableStatuses.length}
              >
                {statusMissing && status && (
                  <option value={status}>{status}</option>
                )}
                {availableStatuses.length ? (
                  availableStatuses.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))
                ) : (
                  <option value="">📝</option>
                )}
              </select>
            </div>
            <div className="capture-matrix-inline">
              <label htmlFor={matrixSelectId} className="sr-only">
                Eisenhower Matrix selection
              </label>
              <select
                id={matrixSelectId}
                className={`matrix-select capture-matrix-select ${matrixClass}`}
                value={matrixSelection}
                onChange={(event) =>
                  applyMatrixChoice(event.target.value as MatrixOptionId)
                }
                disabled={pending}
              >
                {matrixOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="property-group-flags capture-property-group-flags">
            <div className="capture-flags">
              <label
                htmlFor={urgentToggleId}
                className={`flag urgent ${
                  selectedMatrix.urgent ? 'is-active' : ''
                }`}
              >
                <input
                  id={urgentToggleId}
                  type="checkbox"
                  checked={selectedMatrix.urgent}
                  onChange={(event) => {
                    applyFlags(event.target.checked, selectedMatrix.important);
                  }}
                  disabled={pending}
                />
                <span className="flag-label">Urgent</span>
              </label>

              <label
                htmlFor={importantToggleId}
                className={`flag important ${
                  selectedMatrix.important ? 'is-active' : ''
                }`}
              >
                <input
                  id={importantToggleId}
                  type="checkbox"
                  checked={selectedMatrix.important}
                  onChange={(event) => {
                    applyFlags(selectedMatrix.urgent, event.target.checked);
                  }}
                  disabled={pending}
                />
                <span className="flag-label">Important</span>
              </label>
            </div>
          </div>
        </div>

        <div
          className={`task-notes capture-task-notes ${
            showNotes ? 'is-open' : 'is-closing'
          }`}
          data-state={showNotes ? 'open' : 'closed'}
          id={notesPanelId}
          aria-hidden={!showNotes}
        >
          {showNotes && (
            <>
              <label htmlFor={notesFieldId} className="sr-only">
                Notes
              </label>
              <textarea
                id={notesFieldId}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Write extra detail (maps to “Main Entry”)"
                disabled={pending}
              />
              <p className="task-notes-hint">Maps to “Main Entry”</p>
              <button
                type="button"
                className="task-notes-collapse"
                onClick={() => setShowNotes(false)}
                title="Collapse notes"
              >
                ↖
              </button>
            </>
          )}
        </div>

          <div className="capture-actions">
            <button
              type="submit"
              className="capture-submit"
              disabled={pending || !value.trim()}
            >
              {pending ? 'Adding…' : 'Add Task'}
            </button>
          </div>
        </article>

        {error && <p className="inline-error">{error}</p>}
      </form>
    </div>
  );
};

export default QuickAdd;
