import {
  Children,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import isHotkey from 'is-hotkey';
import {
  BaseEditor,
  Descendant,
  Editor,
  Element as SlateElement,
  Location,
  Node,
  NodeEntry,
  Path,
  Range,
  Text,
  Point,
  Transforms,
  createEditor
} from 'slate';
import {
  Editable,
  ReactEditor,
  RenderElementProps,
  RenderLeafProps,
  Slate,
  useSlateStatic,
  withReact
} from 'slate-react';
import { HistoryEditor, withHistory } from 'slate-history';
import type { MarkdownBlock, MarkdownRichText } from '@shared/types';

type CustomText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
};

type MarkFormat = Exclude<keyof CustomText, 'text'>;

type ParagraphElement = { type: 'paragraph'; children: Descendant[] };
type HeadingElement = {
  type: 'heading-one' | 'heading-two' | 'heading-three';
  children: Descendant[];
};
type ListElement = {
  type: 'bulleted-list' | 'numbered-list';
  children: Descendant[];
};
type ListItemElement = { type: 'list-item'; children: Descendant[] };
type TodoElementShape = { type: 'to-do'; checked: boolean; children: Descendant[] };
type QuoteElement = { type: 'block-quote'; children: Descendant[] };
type CodeElement = { type: 'code'; children: Descendant[] };
type DividerElement = { type: 'divider'; children: Descendant[] };
type ToggleElement = { type: 'toggle'; open?: boolean; children: Descendant[] };
type ToggleTitleElement = { type: 'toggle-title'; children: Descendant[] };

type CustomElement =
  | ParagraphElement
  | HeadingElement
  | ListElement
  | ListItemElement
  | TodoElementShape
  | QuoteElement
  | CodeElement
  | DividerElement
  | ToggleElement
  | ToggleTitleElement;

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}

const HOTKEYS: Record<string, MarkFormat> = {
  'mod+b': 'bold',
  'mod+i': 'italic',
  'mod+u': 'underline',
  'mod+shift+x': 'strikethrough',
  'mod+`': 'code'
};

const SHORTCUTS: Record<string, CustomElement['type']> = {
  '#': 'heading-one',
  '##': 'heading-two',
  '###': 'heading-three',
  '-': 'bulleted-list',
  '*': 'bulleted-list',
  '+': 'bulleted-list',
  '•': 'bulleted-list',
  '1.': 'numbered-list',
  '[]': 'to-do',
  '>>': 'toggle',
  '>': 'toggle'
};

const LIST_TYPES: CustomElement['type'][] = ['numbered-list', 'bulleted-list'];

interface Props {
  onValueChange(next: Descendant[]): void;
  placeholder?: string;
  resetSignal?: number;
}

export const createInitialBodyValue = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: '' }]
  }
];

export const valueToPlainText = (value: Descendant[]): string => {
  return value.map((node) => Node.string(node)).join('\n').trim();
};

export const valueToMarkdownBlocks = (value: Descendant[]): MarkdownBlock[] => {
  const blocks = nodesToBlocks(value);
  return blocks.length
    ? blocks
    : [
        {
          type: 'paragraph',
          richText: [{ text: '', annotations: {} }]
        }
      ];
};

const elementToBlocks = (element: SlateElement): MarkdownBlock[] => {
  switch (element.type) {
    case 'paragraph':
      return [
        {
          type: 'paragraph',
          richText: nodesToRichText(element.children)
        }
      ];
    case 'heading-one':
      return [
        {
          type: 'heading_1',
          richText: nodesToRichText(element.children)
        }
      ];
    case 'heading-two':
      return [
        {
          type: 'heading_2',
          richText: nodesToRichText(element.children)
        }
      ];
    case 'heading-three':
      return [
        {
          type: 'heading_3',
          richText: nodesToRichText(element.children)
        }
      ];
    case 'bulleted-list':
      return flattenListBlocks(element as ListElement, 'bulleted_list_item');
    case 'numbered-list':
      return flattenListBlocks(element as ListElement, 'numbered_list_item');
    case 'to-do':
      return [
        {
          type: 'to_do',
          checked: Boolean((element as TodoElementShape).checked),
          richText: nodesToRichText(element.children)
        }
      ];
    case 'block-quote':
      return [
        {
          type: 'quote',
          richText: nodesToRichText(element.children)
        }
      ];
    case 'code':
      return [
        {
          type: 'code',
          language: 'plain text',
          richText: nodesToRichText(element.children)
        }
      ];
    case 'divider':
      return [
        {
          type: 'divider'
        }
      ];
    case 'toggle': {
      const toggleElement = element as ToggleElement;
      const [titleNode] = toggleElement.children;
      const titleRichText = SlateElement.isElement(titleNode)
        ? nodesToRichText((titleNode as SlateElement).children)
        : nodesToRichText(toggleElement.children);
      const contentNodes =
        SlateElement.isElement(titleNode) && titleNode.type === 'toggle-title'
          ? toggleElement.children.slice(1)
          : toggleElement.children;
      return [
        {
          type: 'toggle',
          richText: titleRichText,
          children: nodesToBlocks(contentNodes)
        }
      ];
    }
    default:
      return [
        {
          type: 'paragraph',
          richText: nodesToRichText(element.children)
        }
      ];
  }
};

const flattenListBlocks = (
  element: ListElement,
  kind: 'bulleted_list_item' | 'numbered_list_item'
): MarkdownBlock[] => {
  const blocks: MarkdownBlock[] = [];
  element.children.forEach((child) => {
    if (SlateElement.isElement(child) && child.type === 'list-item') {
      blocks.push({
        type: kind,
        richText: nodesToRichText(child.children)
      });
    }
  });
  return blocks;
};

const nodesToRichText = (nodes: Descendant[]): MarkdownRichText[] => {
  const segments: MarkdownRichText[] = [];
  nodes.forEach((node) => {
    if (Text.isText(node)) {
      segments.push({
        text: node.text,
        annotations: {
          bold: node.bold,
          italic: node.italic,
          underline: node.underline,
          strikethrough: node.strikethrough,
          code: node.code
        }
      });
      return;
    }
    if (SlateElement.isElement(node)) {
      segments.push(...nodesToRichText(node.children));
    }
  });
  return segments.length
    ? segments
    : [
        {
          text: '',
          annotations: {}
        }
      ];
};

const nodesToBlocks = (nodes: Descendant[]): MarkdownBlock[] => {
  const blocks: MarkdownBlock[] = [];
  nodes.forEach((node) => {
    if (!SlateElement.isElement(node)) {
      return;
    }
    blocks.push(...elementToBlocks(node as SlateElement));
  });
  return blocks;
};

const RichBodyEditor = ({
  onValueChange,
  placeholder,
  resetSignal = 0
}: Props) => {
  const editor = useMemo(() => withHistory(withReact(createEditor())), []);
  const [value, setValue] = useState<Descendant[]>(() => {
    const val = createInitialBodyValue();
    if (!val) {
      console.error('RichBodyEditor: createInitialBodyValue returned undefined');
      return [{ type: 'paragraph', children: [{ text: '' }] }];
    }
    return val;
  });

  useEffect(() => {
    const initial = createInitialBodyValue();
    setValue(initial);
    onValueChange(initial);
  }, [resetSignal, onValueChange]);

  const renderElement = useCallback(
    (props: RenderElementProps) => <Element {...props} />,
    []
  );
  const renderLeaf = useCallback(
    (props: RenderLeafProps) => <Leaf {...props} />,
    []
  );

  const insertToggleAtSelection = useCallback(() => {
    const blockEntry = Editor.above(editor, {
      match: (n) => SlateElement.isElement(n),
      mode: 'lowest'
    });
    if (!blockEntry) return;
    const [, path] = blockEntry as [SlateElement, Path];
    replaceBlockWithToggle(editor, path);
  }, [editor]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Backspace') {
        const toggleEntry = Editor.above(editor, {
          match: (n) => SlateElement.isElement(n) && n.type === 'toggle',
          mode: 'lowest'
        });
        if (
          toggleEntry &&
          (!editor.selection || Range.isCollapsed(editor.selection)) &&
          !Node.string(toggleEntry[0]).trim()
        ) {
          event.preventDefault();
          const [, togglePath] = toggleEntry as [ToggleElement, Path];
          Transforms.removeNodes(editor, { at: togglePath });
          const paragraph: ParagraphElement = {
            type: 'paragraph',
            children: [{ text: '' }]
          };
          Transforms.insertNodes(editor, paragraph, { at: togglePath });
          Transforms.select(editor, Editor.start(editor, togglePath));
          return;
        }

        const listEntry = Editor.above(editor, {
          match: (n) => SlateElement.isElement(n) && n.type === 'list-item',
          mode: 'lowest'
        });
        if (
          listEntry &&
          editor.selection &&
          Range.isCollapsed(editor.selection) &&
          Point.equals(editor.selection.anchor, Editor.start(editor, listEntry[1]))
        ) {
          event.preventDefault();
          const [, listItemPath] = listEntry as [ListItemElement, Path];
          if (!outdentListItem(editor, listItemPath)) {
            Transforms.setNodes(editor, { type: 'paragraph' }, { at: listItemPath });
            unwrapLists(editor, listItemPath);
          }
          return;
        }
      }

      if (isHotkey('mod+shift+t', event)) {
        event.preventDefault();
        insertToggleAtSelection();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        const toggleAncestor = Editor.above(editor, {
          match: (n) => SlateElement.isElement(n) && n.type === 'toggle',
          mode: 'lowest'
        });
        if (toggleAncestor) {
          const [toggleNode, togglePath] = toggleAncestor as [ToggleElement, Path];
          if (!Node.string(toggleNode).trim()) {
            event.preventDefault();
            ensureToggleBody(editor, togglePath);
            const bodyPath = togglePath.concat(1);
            Transforms.setNodes(editor, { open: true }, { at: togglePath });
            Transforms.select(editor, Editor.start(editor, bodyPath));
            return;
          }
        }

        const toggleTitleEntry = Editor.above(editor, {
          match: (n) => SlateElement.isElement(n) && n.type === 'toggle-title',
          mode: 'lowest'
        });
        if (toggleTitleEntry) {
          event.preventDefault();
          const [, titlePath] = toggleTitleEntry as [SlateElement, Path];
          const togglePath = Path.parent(titlePath);
          const nextPath = Path.next(titlePath);
          let targetPath = nextPath;
          try {
            Node.get(editor, targetPath);
          } catch {
            const paragraph: ParagraphElement = {
              type: 'paragraph',
              children: [{ text: '' }]
            };
            Transforms.insertNodes(editor, paragraph, { at: targetPath });
          }
          Transforms.select(editor, Editor.start(editor, targetPath));
          const toggleNode = Node.get(editor, togglePath) as ToggleElement;
          if (toggleNode && toggleNode.open === false) {
            Transforms.setNodes(editor, { open: true }, { at: togglePath });
          }
          return;
        }

        const blockEntry = Editor.above(editor, {
          match: (n) => SlateElement.isElement(n),
          mode: 'lowest'
        });
        if (blockEntry) {
          const [block, path] = blockEntry as [SlateElement, Path];
          if (block.type === 'divider') {
            event.preventDefault();
            const nextPath = Path.next(path);
            const paragraph = {
              type: 'paragraph',
              children: [{ text: '' }]
            } as SlateElement;
            Transforms.insertNodes(editor, paragraph, { at: nextPath });
            Transforms.select(editor, Editor.start(editor, nextPath));
            return;
          }
          if (block.type === 'to-do') {
            event.preventDefault();
            const blockText = Editor.string(editor, path).trim();
            if (!blockText) {
              Transforms.setNodes(editor, { type: 'paragraph' }, { at: path });
              Transforms.unsetNodes(editor, 'checked', { at: path });
              return;
            }
            const nextPath = Path.next(path);
            const todo: TodoElementShape = {
              type: 'to-do',
              checked: false,
              children: [{ text: '' }]
            };
            Transforms.insertNodes(editor, todo, { at: nextPath });
            Transforms.select(editor, Editor.start(editor, nextPath));
            return;
          }
          if (
            block.type === 'heading-one' ||
            block.type === 'heading-two' ||
            block.type === 'heading-three'
          ) {
            event.preventDefault();
            const nextPath = Path.next(path);
            const paragraph = {
              type: 'paragraph',
              children: [{ text: '' }]
            } as SlateElement;
            Transforms.insertNodes(editor, paragraph, { at: nextPath });
            Transforms.select(editor, Editor.start(editor, nextPath));
            return;
          }
          if (block.type === 'list-item') {
            event.preventDefault();
            splitListItem(editor, path);
            return;
          }
        }
      }

      if (event.key === 'Tab') {
        const entries = getSelectedListItemEntries(editor);
        if (entries.length) {
          event.preventDefault();
          adjustListIndentation(
            editor,
            entries,
            event.shiftKey ? 'outdent' : 'indent'
          );
          return;
        }

        event.preventDefault();
        if (!event.shiftKey) {
          Editor.insertText(editor, '  ');
        } else {
          deleteIndent(editor);
        }
        return;
      }

      Object.keys(HOTKEYS).forEach((hotkey) => {
        if (isHotkey(hotkey, event)) {
          event.preventDefault();
          toggleMark(editor, HOTKEYS[hotkey]);
        }
      });

      const { selection } = editor;
      if (!selection || !Range.isCollapsed(selection)) {
        return;
      }

      const blockEntry = Editor.above(editor, {
        match: (n) => SlateElement.isElement(n),
        mode: 'lowest'
      });
      if (!blockEntry) return;
      const [block, path] = blockEntry as [SlateElement, Path];
      if (block.type !== 'paragraph') {
        return;
      }
      const start = Editor.start(editor, path);
      const range = { anchor: start, focus: selection.anchor };
      const beforeText = Editor.string(editor, range);
      const trimmed = beforeText.trim();
      const normalized = trimmed.toLowerCase();
      if (trimmed === '---' || trimmed === '___' || trimmed === '***') {
        event.preventDefault();
        Transforms.select(editor, range);
        Transforms.delete(editor);
        insertDividerBlock(editor, path);
        return;
      }

      if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      let shortcut =
        SHORTCUTS[beforeText] ??
        SHORTCUTS[trimmed] ??
        SHORTCUTS[normalized];
      if (!shortcut) {
        if (/^\d+\.$/.test(normalized)) {
          shortcut = 'numbered-list';
        } else if (/^[a-z]\.$/.test(normalized)) {
          shortcut = 'numbered-list';
        } else if (/^[ivxlcdm]+\.$/.test(normalized)) {
          shortcut = 'numbered-list';
        }
      }
      if (!shortcut) return;

      event.preventDefault();
      Transforms.select(editor, range);
      Transforms.delete(editor);
      applyShortcutBlock(editor, shortcut, path);
    },
    [editor]
  );

  const handleSlateChange = useCallback(
    (nextValue: Descendant[]) => {
      setValue(nextValue);
      const isAstChange = editor.operations.some(
        (op) => op.type !== 'set_selection'
      );
      if (isAstChange) {
        onValueChange(nextValue);
      }
    },
    [editor, onValueChange]
  );

  return (
    <Slate
      editor={editor}
      initialValue={value || createInitialBodyValue()}
      onChange={handleSlateChange}
    >
      <div className="editor-toolbar" contentEditable={false}>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            insertToggleAtSelection();
          }}
        >
          Toggle
        </button>
      </div>
      <Editable
        className="rich-body-editor"
        placeholder={placeholder}
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        spellCheck
        autoCorrect="on"
        autoCapitalize="sentences"
        onKeyDown={handleKeyDown}
      />
    </Slate>
  );
};

const Element = ({ attributes, children, element }: RenderElementProps) => {
  switch (element.type) {
    case 'heading-one':
      return (
        <h1 {...attributes} className="editor-heading heading-one">
          {children}
        </h1>
      );
    case 'heading-two':
      return (
        <h2 {...attributes} className="editor-heading heading-two">
          {children}
        </h2>
      );
    case 'heading-three':
      return (
        <h3 {...attributes} className="editor-heading heading-three">
          {children}
        </h3>
      );
    case 'numbered-list':
      return (
        <ol {...attributes} className="editor-list numbered">
          {children}
        </ol>
      );
    case 'bulleted-list':
      return (
        <ul {...attributes} className="editor-list bulleted">
          {children}
        </ul>
      );
    case 'list-item':
      return <li {...attributes}>{children}</li>;
    case 'block-quote':
      return (
        <blockquote {...attributes} className="editor-quote">
          {children}
        </blockquote>
      );
    case 'code':
      return (
        <pre {...attributes} className="editor-code">
          <code>{children}</code>
        </pre>
      );
    case 'to-do':
      return <TodoBlock {...{ attributes, children, element }} />;
    case 'toggle':
      return <ToggleBlock {...{ attributes, children, element }} />;
    case 'toggle-title':
      return (
        <div {...attributes} className="editor-toggle-title">
          {children}
        </div>
      );
    case 'divider':
      return (
        <div {...attributes} className="editor-divider">
          <hr />
          {children}
        </div>
      );
    default:
      return <p {...attributes}>{children}</p>;
  }
};

const TodoBlock = ({
  attributes,
  children,
  element
}: RenderElementProps) => {
  const editor = useSlateStatic();
  const checked = Boolean((element as TodoElementShape).checked);
  return (
    <div {...attributes} className="editor-todo">
      <span contentEditable={false}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            const path = ReactEditor.findPath(editor, element);
            Transforms.setNodes(
              editor,
              { checked: event.target.checked },
              { at: path }
            );
          }}
        />
      </span>
      <span>{children}</span>
    </div>
  );
};

const ToggleBlock = ({
  attributes,
  children,
  element
}: RenderElementProps) => {
  const editor = useSlateStatic();
  const open = (element as ToggleElement).open !== false;
  const nodes = Children.toArray(children);
  const titleNode = nodes[0];
  const bodyNodes = nodes.slice(1);

  return (
    <div
      {...attributes}
      className={`editor-toggle ${open ? 'is-open' : ''}`}
      data-open={open}
    >
      <div className="toggle-row">
        <span contentEditable={false}>
          <button
            type="button"
            className="toggle-button"
            onMouseDown={(event) => {
              event.preventDefault();
              const path = ReactEditor.findPath(editor, element);
              Transforms.setNodes(editor, { open: !open }, { at: path });
            }}
          >
            {open ? '▾' : '▸'}
          </button>
        </span>
        <div className="toggle-title-content">{titleNode}</div>
      </div>
      <div className="toggle-body" style={{ display: open ? 'block' : 'none' }}>
        {bodyNodes}
      </div>
    </div>
  );
};

const Leaf = ({ attributes, children, leaf }: RenderLeafProps) => {
  let next = children;
  if (leaf.bold) {
    next = <strong>{next}</strong>;
  }
  if (leaf.italic) {
    next = <em>{next}</em>;
  }
  if (leaf.underline) {
    next = <u>{next}</u>;
  }
  if (leaf.strikethrough) {
    next = <s>{next}</s>;
  }
  if (leaf.code) {
    next = <code>{next}</code>;
  }
  return <span {...attributes}>{next}</span>;
};

const toggleMark = (editor: Editor, format: MarkFormat) => {
  const isActive = isMarkActive(editor, format);
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

const isMarkActive = (editor: Editor, format: MarkFormat) => {
  const marks = Editor.marks(editor);
  return marks ? Boolean(marks[format]) : false;
};

const applyShortcutBlock = (
  editor: Editor,
  format: CustomElement['type'],
  at: Path
) => {
  unwrapLists(editor, at);
  if (format === 'toggle') {
    replaceBlockWithToggle(editor, at);
    return;
  }
  if (format === 'bulleted-list' || format === 'numbered-list') {
    Transforms.setNodes(
      editor,
      { type: 'list-item' },
      { at }
    );
    const block = { type: format, children: [] };
    Transforms.wrapNodes(editor, block, {
      at,
      match: (n) => SlateElement.isElement(n) && n.type === 'list-item'
    });
    return;
  }
  if (format === 'to-do') {
    Transforms.setNodes(editor, { type: 'to-do', checked: false }, { at });
    return;
  }
  if (format === 'divider') {
    Transforms.setNodes(
      editor,
      { type: 'divider', children: [{ text: '' }] },
      { at }
    );
    const nextPath = Path.next(at);
    const paragraph: ParagraphElement = {
      type: 'paragraph',
      children: [{ text: '' }]
    };
    Transforms.insertNodes(editor, paragraph, { at: nextPath });
    Transforms.select(editor, Editor.start(editor, nextPath));
    return;
  }
  const paragraphType =
    format === 'heading-one'
      ? 'heading-one'
      : format === 'heading-two'
        ? 'heading-two'
        : format === 'heading-three'
          ? 'heading-three'
          : 'paragraph';
  Transforms.setNodes(editor, { type: paragraphType }, { at });
};

const createToggleElement = (titleChildren?: Descendant[]): ToggleElement => ({
  type: 'toggle',
  open: true,
  children: [
    {
      type: 'toggle-title',
      children: titleChildren ?? [{ text: '' }]
    },
    {
      type: 'paragraph',
      children: [{ text: '' }]
    }
  ]
});

const replaceBlockWithToggle = (editor: Editor, at: Path) => {
  const existingNode = Node.get(editor, at);
  if (SlateElement.isElement(existingNode) && existingNode.type === 'toggle') {
    const titlePath = at.concat(0, 0);
    Transforms.select(editor, Editor.end(editor, titlePath));
    return;
  }

  const titleChildren =
    SlateElement.isElement(existingNode) && existingNode.children.length
      ? existingNode.children
      : [{ text: '' }];

  const toggle = createToggleElement(titleChildren as Descendant[]);
  Transforms.removeNodes(editor, { at });
  Transforms.insertNodes(editor, toggle, { at });
  const titlePath = at.concat(0, 0);
  Transforms.select(editor, Editor.end(editor, titlePath));
};

const ensureToggleBody = (editor: Editor, togglePath: Path) => {
  const bodyPath = togglePath.concat(1);
  try {
    Node.get(editor, bodyPath);
  } catch {
    const paragraph: ParagraphElement = {
      type: 'paragraph',
      children: [{ text: '' }]
    };
    Transforms.insertNodes(editor, paragraph, { at: bodyPath });
  }
};

const unwrapLists = (editor: Editor, at?: Location) => {
  Transforms.unwrapNodes(editor, {
    at,
    match: (n) =>
      SlateElement.isElement(n) && LIST_TYPES.includes(n.type as CustomElement['type']),
    split: true
  });
};

function indentListItem(editor: Editor, listItemPathOverride?: Path): boolean {
  let listItemPath = listItemPathOverride;
  if (!listItemPath) {
    const entry = getListItemEntry(editor);
    if (!entry) return false;
    listItemPath = entry[1];
  }
  const parentListPath = Path.parent(listItemPath);
  const parentList = Node.get(editor, parentListPath) as SlateElement;
  if (!isListElement(parentList)) return false;
  const index = listItemPath[listItemPath.length - 1];
  if (index === 0) return false;
  const prevSiblingPath = Path.previous(listItemPath);
  const prevSibling = Node.get(editor, prevSiblingPath) as SlateElement;
  const parentListPathRef = [...parentListPath];

  const selectionRef = captureSelectionRef(editor);
  const listItemRef = Editor.pathRef(editor, listItemPath);
  Editor.withoutNormalizing(editor, () => {
    const nestedListPath = getOrCreateNestedList(
      editor,
      prevSibling,
      prevSiblingPath,
      parentList.type as ListElement['type']
    );
    const nestedList = Node.get(editor, nestedListPath) as SlateElement;
    const destination = nestedListPath.concat(nestedList.children.length);
    Transforms.moveNodes(editor, { at: listItemPath, to: destination });
    removeEmptyList(editor, parentListPathRef);
  });

  const nextPath = listItemRef.current;
  listItemRef.unref();
  if (nextPath) {
    if (!restoreSelectionRef(editor, selectionRef)) {
      Transforms.select(editor, Editor.start(editor, nextPath));
    }
  }
  return true;
}

function outdentListItem(editor: Editor, listItemPathOverride?: Path): boolean {
  let listItemPath = listItemPathOverride;
  if (!listItemPath) {
    const entry = getListItemEntry(editor);
    if (!entry) return false;
    listItemPath = entry[1];
  }
  const parentListPath = Path.parent(listItemPath);
  const parentList = Node.get(editor, parentListPath) as SlateElement;
  if (!isListElement(parentList)) return false;
  const parentListPathRef = [...parentListPath];
  let grandParent: SlateElement | null = null;
  let grandParentPath: Path | null = null;
  if (parentListPath.length > 0) {
    grandParentPath = Path.parent(parentListPath);
    try {
      grandParent = Node.get(editor, grandParentPath) as SlateElement;
    } catch {
      grandParent = null;
    }
  }

  const selectionRef = captureSelectionRef(editor);
  const listItemRef = Editor.pathRef(editor, listItemPath);
  if (grandParent && grandParent.type === 'list-item') {
    Editor.withoutNormalizing(editor, () => {
      const destination = Path.next(grandParentPath!);
      Transforms.moveNodes(editor, { at: listItemPath, to: destination });
      removeEmptyList(editor, parentListPathRef);
    });
    const nextPath = listItemRef.current;
    listItemRef.unref();
    if (nextPath) {
      if (!restoreSelectionRef(editor, selectionRef)) {
        Transforms.select(editor, Editor.start(editor, nextPath));
      }
    }
    return true;
  }

  Editor.withoutNormalizing(editor, () => {
    Transforms.setNodes(editor, { type: 'paragraph' }, { at: listItemPath });
    unwrapLists(editor, listItemPath);
  });

  const nextPath = listItemRef.current;
  listItemRef.unref();
  if (nextPath) {
    if (!restoreSelectionRef(editor, selectionRef)) {
      Transforms.select(editor, Editor.start(editor, nextPath));
    }
  }
  return true;
}

function getOrCreateNestedList(
  editor: Editor,
  listItem: SlateElement,
  listItemPath: Path,
  listType: ListElement['type']
): Path {
  const lastIndex = listItem.children.length - 1;
  if (
    lastIndex >= 0 &&
    SlateElement.isElement(listItem.children[lastIndex]) &&
    isListElement(listItem.children[lastIndex] as SlateElement) &&
    (listItem.children[lastIndex] as SlateElement).type === listType
  ) {
    return listItemPath.concat(lastIndex);
  }
  const newListPath = listItemPath.concat(listItem.children.length);
  const newList: ListElement = { type: listType, children: [] };
  Transforms.insertNodes(editor, newList, { at: newListPath });
  return newListPath;
}

function getListItemEntry(editor: Editor): NodeEntry<ListItemElement> | null {
  if (!editor.selection) {
    return null;
  }
  const [entry] = Editor.nodes(editor, {
    at: editor.selection,
    match: (n) => SlateElement.isElement(n) && n.type === 'list-item',
    mode: 'lowest'
  }) as IterableIterator<NodeEntry<ListItemElement>>;
  return entry ?? null;
}

function isListElement(element: SlateElement): element is ListElement {
  return element.type === 'bulleted-list' || element.type === 'numbered-list';
}

function removeEmptyList(editor: Editor, at: Path) {
  try {
    const node = Node.get(editor, at);
    if (
      SlateElement.isElement(node) &&
      isListElement(node as SlateElement) &&
      node.children.length === 0
    ) {
      Transforms.removeNodes(editor, { at });
    }
  } catch {
    // path no longer valid; ignore
  }
}

function deleteIndent(editor: Editor) {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) {
    return;
  }
  const { anchor } = selection;
  const blockEntry = Editor.above(editor, {
    match: (n) => SlateElement.isElement(n),
    mode: 'lowest'
  });
  if (!blockEntry) return;
  const [, path] = blockEntry;
  const start = Editor.start(editor, path);
  const indentRange = {
    anchor: start,
    focus: anchor
  };
  const text = Editor.string(editor, indentRange);
  if (text.startsWith('  ')) {
    Transforms.delete(editor, {
      at: {
        anchor: start,
        focus: {
          path: start.path,
          offset: 2
        }
      }
    });
  }
}

const captureSelectionRef = (editor: Editor) => {
  if (!editor.selection || !Range.isCollapsed(editor.selection)) {
    return null;
  }
  const { anchor } = editor.selection;
  return {
    offset: anchor.offset,
    pathRef: Editor.pathRef(editor, anchor.path)
  };
};

const restoreSelectionRef = (
  editor: Editor,
  ref: ReturnType<typeof captureSelectionRef>
) => {
  if (!ref) return false;
  const path = ref.pathRef.current;
  ref.pathRef.unref();
  if (!path) return false;
  const node = Node.get(editor, path);
  const length = Text.isText(node) ? node.text.length : 0;
  const offset = Math.min(ref.offset, length);
  const point = { path, offset };
  Transforms.select(editor, { anchor: point, focus: point });
  return true;
};

function getSelectedListItemEntries(
  editor: Editor
): NodeEntry<ListItemElement>[] {
  if (!editor.selection) {
    return [];
  }
  const range = Range.isCollapsed(editor.selection)
    ? editor.selection
    : Editor.unhangRange(editor, editor.selection);
  const entries = Array.from(
    Editor.nodes(editor, {
      at: range,
      match: (n) => SlateElement.isElement(n) && n.type === 'list-item',
      mode: 'lowest'
    })
  ) as NodeEntry<ListItemElement>[];
  const seen = new Set<string>();
  return entries.filter(([, path]) => {
    const key = path.join(',');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function adjustListIndentation(
  editor: Editor,
  entries: NodeEntry<ListItemElement>[],
  direction: 'indent' | 'outdent'
) {
  if (!entries.length) return;
  const refs = entries.map(([, path]) => Editor.pathRef(editor, path));
  const handler = direction === 'indent' ? indentListItem : outdentListItem;
  refs.forEach((ref) => {
    const path = ref.current;
    if (!path) return;
    const point = Editor.start(editor, path);
    Transforms.select(editor, { anchor: point, focus: point });
    handler(editor, path);
  });
  const lastPath = refs[refs.length - 1]?.current;
  refs.forEach((ref) => ref.unref());
  if (lastPath) {
    const point = Editor.end(editor, lastPath);
    Transforms.select(editor, { anchor: point, focus: point });
  }
}

function splitListItem(editor: Editor, listItemPath: Path) {
  const text = Editor.string(editor, listItemPath);
  if (!text.trim()) {
    Transforms.setNodes(editor, { type: 'paragraph' }, { at: listItemPath });
    unwrapLists(editor, listItemPath);
    return;
  }
  Transforms.splitNodes(editor, {
    match: (n) => SlateElement.isElement(n) && n.type === 'list-item',
    always: true
  });
}

function insertDividerBlock(editor: Editor, at: Path) {
  Transforms.setNodes(
    editor,
    { type: 'divider', children: [{ text: '' }] },
    { at }
  );
  const nextPath = Path.next(at);
  const paragraph: ParagraphElement = {
    type: 'paragraph',
    children: [{ text: '' }]
  };
  Transforms.insertNodes(editor, paragraph, { at: nextPath });
  Transforms.select(editor, Editor.start(editor, nextPath));
}

export default RichBodyEditor;

