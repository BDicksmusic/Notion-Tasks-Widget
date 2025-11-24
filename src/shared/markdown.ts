import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type {
  BlockContent,
  DefinitionContent,
  Heading,
  List,
  ListItem,
  Paragraph,
  Root
} from 'mdast';
import type { PhrasingContent } from 'mdast';
import type {
  MarkdownAnnotations,
  MarkdownBlock,
  MarkdownRichText
} from './types';

export interface MarkdownConversion {
  html: string;
  blocks: MarkdownBlock[];
}

const htmlProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize)
  .use(rehypeStringify);

const mdProcessor = unified().use(remarkParse).use(remarkGfm);

export async function convertMarkdown(
  markdown: string
): Promise<MarkdownConversion> {
  const [htmlResult, tree] = await Promise.all([
    htmlProcessor.process(markdown),
    mdProcessor
      .run(mdProcessor.parse(markdown) as Root)
      .then((processed) => processed as Root)
  ]);

  return {
    html: String(htmlResult),
    blocks: mdastToBlocks(tree)
  };
}

function mdastToBlocks(tree: Root): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];

  for (const node of tree.children) {
    switch (node.type) {
      case 'heading':
        blocks.push(headingToBlock(node));
        break;
      case 'paragraph':
        blocks.push({
          type: 'paragraph',
          richText: phrasingToRichText(node.children ?? [])
        });
        break;
      case 'list':
        blocks.push(...listToBlocks(node));
        break;
      case 'code':
        blocks.push({
          type: 'code',
          language: node.lang ?? 'plain text',
          richText: [
            {
              text: node.value,
              annotations: {}
            }
          ]
        });
        break;
      case 'blockquote':
        blocks.push(...blockquoteToBlocks(node.children ?? []));
        break;
      case 'thematicBreak':
        blocks.push({ type: 'divider' });
        break;
      default:
        break;
    }
  }

  if (!blocks.length) {
    blocks.push({
      type: 'paragraph',
      richText: [{ text: '', annotations: {} }]
    });
  }

  return blocks;
}

function headingToBlock(node: Heading): MarkdownBlock {
  const level = Math.min(Math.max(node.depth ?? 1, 1), 3);
  const type = `heading_${level}` as 'heading_1' | 'heading_2' | 'heading_3';
  return {
    type,
    richText: phrasingToRichText(node.children ?? [])
  };
}

function blockquoteToBlocks(
  children: Array<BlockContent | DefinitionContent>
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  for (const child of children) {
    if (child.type === 'paragraph') {
      blocks.push({
        type: 'quote',
        richText: phrasingToRichText(child.children ?? [])
      });
    }
  }
  return blocks;
}

function listToBlocks(node: List): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  for (const item of node.children) {
    blocks.push(...listItemToBlocks(item, node));
  }
  return blocks;
}

function listItemToBlocks(item: ListItem, list: List): MarkdownBlock[] {
  const results: MarkdownBlock[] = [];
  const firstParagraph = item.children.find(
    (child): child is Paragraph => child.type === 'paragraph'
  );
  const richText = phrasingToRichText(firstParagraph?.children ?? []);
  if (typeof item.checked === 'boolean') {
    results.push({
      type: 'to_do',
      checked: item.checked,
      richText
    });
  } else {
    results.push({
      type: list.ordered ? 'numbered_list_item' : 'bulleted_list_item',
      richText
    });
  }

  // Append any nested paragraphs as standalone paragraphs to avoid losing text.
  const extraParagraphs = item.children.filter(
    (child) => child.type === 'paragraph' && child !== firstParagraph
  ) as Paragraph[];
  for (const paragraph of extraParagraphs) {
    results.push({
      type: 'paragraph',
      richText: phrasingToRichText(paragraph.children ?? [])
    });
  }

  // Support nested lists (one level deep) by recursing.
  const nestedLists = item.children.filter(
    (child): child is List => child.type === 'list'
  );
  for (const nested of nestedLists) {
    results.push(...listToBlocks(nested));
  }

  return results;
}

function phrasingToRichText(nodes: PhrasingContent[]): MarkdownRichText[] {
  const richText: MarkdownRichText[] = [];
  for (const node of nodes) {
    richText.push(...convertPhrasingNode(node, {}));
  }
  return richText.length
    ? richText
    : [
        {
          text: '',
          annotations: {}
        }
      ];
}

function convertPhrasingNode(
  node: PhrasingContent,
  annotations: MarkdownAnnotations
): MarkdownRichText[] {
  switch (node.type) {
    case 'text':
      return node.value
        ? [
            {
              text: node.value,
              annotations: { ...annotations }
            }
          ]
        : [];
    case 'strong':
      return aggregateRichText(node.children, {
        ...annotations,
        bold: true
      });
    case 'emphasis':
      return aggregateRichText(node.children, {
        ...annotations,
        italic: true
      });
    case 'delete':
      return aggregateRichText(node.children, {
        ...annotations,
        strikethrough: true
      });
    case 'inlineCode':
      return [
        {
          text: node.value,
          annotations: { ...annotations, code: true }
        }
      ];
    case 'break':
      return [
        {
          text: '\n',
          annotations: { ...annotations }
        }
      ];
    case 'link':
      return aggregateRichText(node.children, annotations).map((segment) => ({
        ...segment,
        href: node.url
      }));
    default:
      return 'children' in node && Array.isArray(node.children)
        ? aggregateRichText(node.children as PhrasingContent[], annotations)
        : [];
  }
}

function aggregateRichText(
  nodes: PhrasingContent[] | undefined,
  annotations: MarkdownAnnotations
): MarkdownRichText[] {
  if (!nodes || !nodes.length) {
    return [];
  }
  return nodes.flatMap((child) => convertPhrasingNode(child, annotations));
}

