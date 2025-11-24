import { FormEvent, useCallback, useMemo, useRef, useState } from 'react';
import type {
  WritingEntryPayload,
  WritingSettings
} from '@shared/types';
import RichBodyEditor, {
  createInitialBodyValue,
  valueToMarkdownBlocks,
  valueToPlainText
} from './RichBodyEditor';

interface Props {
  settings: WritingSettings | null;
  onCreate(payload: WritingEntryPayload): Promise<void>;
}

const DEFAULT_STATUS = 'draft';

const WritingWidget = ({ settings, onCreate }: Props) => {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState('');
  const bodyValueRef = useRef(createInitialBodyValue());
  const [editorResetSignal, setEditorResetSignal] = useState(0);
  const [status, setStatus] = useState<'draft' | 'published'>(DEFAULT_STATUS);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resolvedDraftStatus = settings?.draftStatus;
  const resolvedPublishedStatus = settings?.publishedStatus;

  const statusLabel = useMemo(() => {
    if (!settings?.statusProperty) return null;
    return settings.statusProperty;
  }, [settings]);

  const parseTags = useCallback(() => {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }, [tags]);

  const resetForm = useCallback(() => {
    setTitle('');
    setSummary('');
    setTags('');
    setStatus(DEFAULT_STATUS);
    bodyValueRef.current = createInitialBodyValue();
    setEditorResetSignal((count) => count + 1);
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const safeTitle = title.trim();
    const safeContent = valueToPlainText(bodyValueRef.current);
    if (!safeTitle || !safeContent) {
      setFeedback({
        kind: 'error',
        message: 'Title and content are required'
      });
      return;
    }
    const blocks = valueToMarkdownBlocks(bodyValueRef.current);
    const payload: WritingEntryPayload = {
      title: safeTitle,
      summary: summary.trim() || undefined,
      content: safeContent,
      tags: parseTags(),
      status:
        status === 'published'
          ? resolvedPublishedStatus ?? undefined
          : resolvedDraftStatus ?? undefined,
      contentBlocks: blocks
    };
    try {
      setSubmitting(true);
      setFeedback(null);
      await onCreate(payload);
      setFeedback({
        kind: 'success',
        message: 'Writing entry captured in Notion'
      });
      resetForm();
    } catch (err) {
      setFeedback({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Unable to save writing entry'
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="writing-widget log-surface">
      {feedback && (
        <header style={{ border: 'none', paddingBottom: 0 }}>
             <p className={`feedback ${feedback.kind}`}>{feedback.message}</p>
        </header>
      )}
      <form onSubmit={handleSubmit}>
        <div className="writing-title-field">
          <input
            type="text"
            className="writing-title-input"
            placeholder="Name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>
        <div className="writing-properties">
          <div className="property-row">
            <label className="property-label">Summary</label>
            <div className="property-input">
              <input
                type="text"
                placeholder={
                  settings?.summaryProperty
                    ? `Maps to "${settings.summaryProperty}"`
                    : 'Optional summary'
                }
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
            </div>
          </div>

          <div className="property-row">
            <label className="property-label">Tags</label>
            <div className="property-input">
              <input
                type="text"
                placeholder="Comma separated"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </div>
          </div>

          {statusLabel && (
            <div className="property-row">
              <label className="property-label">{statusLabel}</label>
              <div className="property-input">
                <div className="pill-toggle">
                  <button
                    type="button"
                    className={status === 'draft' ? 'active' : ''}
                    onClick={() => setStatus('draft')}
                  >
                    Draft
                  </button>
                  <button
                    type="button"
                    className={status === 'published' ? 'active' : ''}
                    onClick={() => setStatus('published')}
                  >
                    Publish
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="writing-body">
          <label className="content-label">Body</label>
          <RichBodyEditor
            onValueChange={(next) => {
              bodyValueRef.current = next;
            }}
            resetSignal={editorResetSignal}
            placeholder="Type with Markdown shortcuts..."
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={submitting} className="action-button">
            {submitting ? 'Sending…' : 'Send to Notion'}
          </button>
        </div>
      </form>
    </section>
  );
};

export default WritingWidget;
